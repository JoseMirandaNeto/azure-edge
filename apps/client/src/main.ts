import { ZONE, classById, skillById } from "@azure-edge/gamedata";
import {
  REMOTE_INTERP_BUFFER_MS,
  chainActiveRange,
  chainTotalFrames,
  decayCorrection,
  dodgeTotalFrames,
  hitStopFrames,
  interpolateRemote,
  isInCancelWindow,
  reconcilePrediction,
  stepMovement,
  type EventPayload,
  type RemoteSample,
  type EntityState,
  type InputPayload,
  type SimState,
  type SnapshotPayload,
  type WelcomePayload,
} from "@azure-edge/shared";
import { GameClient } from "./net.js";
import { WorldView } from "./render.js";

/**
 * M0 client: third-person movement + client-side prediction + reconciliation.
 * The client only sends inputs; positions come from server snapshots.
 */

const params = new URLSearchParams(window.location.search);
const simulatedLatencyMs = Number(params.get("latency") ?? 0) || 0;
// Deploy-ready: on an https:// page the browser blocks plain ws://
// (mixed content), so default to wss:// there. `?server=` still wins,
// then the build-time VITE_GAME_SERVER_URL (e.g. wss://…onrender.com).
const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
const serverUrl =
  params.get("server") ??
  import.meta.env.VITE_GAME_SERVER_URL ??
  `${wsProtocol}://${window.location.hostname || "localhost"}:3001`;
const playerName = params.get("name") ?? `Player-${crypto.randomUUID().slice(0, 4)}`;

const statusEl = document.getElementById("status") as HTMLElement;
const playerEl = document.getElementById("player") as HTMLElement;
const debugEl = document.getElementById("debug") as HTMLElement;
const appEl = document.getElementById("app") as HTMLElement;
const hpFillEl = document.getElementById("hp-fill") as HTMLElement;
const stFillEl = document.getElementById("st-fill") as HTMLElement;
const mpFillEl = document.getElementById("mp-fill") as HTMLElement;
const dmgLayerEl = document.getElementById("dmg-layer") as HTMLElement;

const view = new WorldView(appEl);

// --- Input state ---
const keys = new Set<string>();
let cameraYaw = 0;
let dragging = false;
let dragButton = -1;
let lastPointerX = 0;
let pointerDownX = 0;
let pointerDownY = 0;
/** Edge-triggered combat actions, consumed by the next 20 Hz input send. */
let pendingAttack = false;
let pendingDodge = false;
let pendingSkill = false;
let guardHeld = false;
/** Edges already consumed this send window (go into the next Input). */
let lastAttackSent = false;
let lastDodgeSent = false;
let lastSkillSent = false;

window.addEventListener("keydown", (e) => {
  if (e.code === "F3") {
    e.preventDefault();
    debugEl.classList.toggle("on");
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    if (!e.repeat) pendingDodge = true;
  }
  if (e.code === "KeyQ" && !e.repeat) pendingSkill = true;
  keys.add(e.code);
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
appEl.addEventListener("contextmenu", (e) => e.preventDefault());
appEl.addEventListener("pointerdown", (e) => {
  dragging = true;
  dragButton = e.button;
  lastPointerX = e.clientX;
  pointerDownX = e.clientX;
  pointerDownY = e.clientY;
  if (e.button === 2) guardHeld = true;
});
window.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  cameraYaw -= (e.clientX - lastPointerX) * 0.005;
  lastPointerX = e.clientX;
});
window.addEventListener("pointerup", (e) => {
  // LMB click (no drag) = attack; drag = camera.
  if (e.button === 0 && Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY) < 6) {
    pendingAttack = true;
  }
  if (e.button === 2) guardHeld = false;
  if (e.button === dragButton) dragging = false;
});

function readMove(): { moveX: number; moveY: number } {
  let x = 0;
  let y = 0;
  if (keys.has("KeyW") || keys.has("ArrowUp")) y += 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) y -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) x += 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) x -= 1;
  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  return { moveX: x, moveY: y };
}

// --- Local visual combat (prediction only — the server is authoritative) ---
// The client starts the swing/dodge/skill visuals immediately on input and
// rolls them back (80 ms fade) if the server rejects the action.
const ESPADACHIM_CHAIN = (classById("espadachim")?.basicChain ?? []);
const SKILL_NAME = skillById("espadachim_corte_crescente")?.name ?? "Corte Crescente";

interface LocalVisual {
  state: "idle" | "attack" | "dodge" | "guard" | "skill";
  frame: number;
  chain: number;
  dodgeDirX: number;
  dodgeDirY: number;
}
let localVisual: LocalVisual = { state: "idle", frame: 0, chain: 0, dodgeDirX: 0, dodgeDirY: 1 };

function startLocalAttack(): void {
  const chain = ESPADACHIM_CHAIN[localVisual.chain];
  if (localVisual.state === "attack" && chain && isInCancelWindow(chain, localVisual.frame)) {
    localVisual.chain = Math.min(localVisual.chain + 1, ESPADACHIM_CHAIN.length - 1);
    localVisual.frame = 0;
  } else if (localVisual.state === "idle") {
    localVisual.chain = 0;
    localVisual.state = "attack";
    localVisual.frame = 0;
  } else {
    return;
  }
  view.showSwingFor(playerId ?? -1, predicted.x, predicted.y, cameraYaw, 2.5, 140, 0x9fd8ff);
}

function startLocalDodge(): void {
  if (localVisual.state !== "idle" && localVisual.state !== "attack") return;
  const { moveX, moveY } = readMove();
  const len = Math.hypot(moveX, moveY);
  if (len > 0.01) {
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    localVisual.dodgeDirX = (moveX / len) * cos + (moveY / len) * sin;
    localVisual.dodgeDirY = -(moveX / len) * sin + (moveY / len) * cos;
  } else {
    localVisual.dodgeDirX = Math.sin(cameraYaw);
    localVisual.dodgeDirY = Math.cos(cameraYaw);
  }
  localVisual.state = "dodge";
  localVisual.frame = 0;
}

function startLocalSkill(): void {
  if (localVisual.state !== "idle") return;
  localVisual.state = "skill";
  localVisual.frame = 0;
  view.showSwingFor(playerId ?? -1, predicted.x, predicted.y, cameraYaw, 3.2, 140, 0x66aaff);
}

function cancelLocalVisual(): void {
  if (localVisual.state === "idle") return;
  localVisual.state = "idle";
  localVisual.frame = 0;
  if (playerId !== null) view.cancelSwing(playerId);
}

// --- Floating combat text (damage numbers, parry, skill names) ---
interface FloatText {
  el: HTMLDivElement;
  wx: number;
  wy: number;
  until: number;
  born: number;
}
const floatPool: FloatText[] = [];
const mobBars = new Map<number, HTMLDivElement>();

function spawnFloat(wx: number, wy: number, text: string, cls: string): void {
  const now = performance.now();
  let slot = floatPool.find((f) => now > f.until);
  if (!slot) {
    if (floatPool.length >= 24) return;
    const el = document.createElement("div");
    dmgLayerEl.appendChild(el);
    slot = { el, wx, wy, until: 0, born: 0 };
    floatPool.push(slot);
  }
  slot.el.textContent = text;
  slot.el.className = `dmg ${cls}`;
  slot.wx = wx;
  slot.wy = wy;
  slot.born = now;
  slot.until = now + 900;
}

function updateFloats(now: number): void {
  for (const f of floatPool) {
    if (now > f.until) {
      f.el.style.display = "none";
      continue;
    }
    const p = view.worldToScreen(f.wx, f.wy, 2.2);
    if (p.behind) {
      f.el.style.display = "none";
      continue;
    }
    const age = (now - f.born) / 900;
    f.el.style.display = "block";
    f.el.style.transform = `translate(${p.sx.toFixed(0)}px, ${(p.sy - age * 48).toFixed(0)}px) translate(-50%, -50%)`;
    f.el.style.opacity = (1 - age * age).toFixed(2);
  }
}

function updateMobBars(now: number, entities: EntityState[]): void {
  const seen = new Set<number>();
  for (const e of entities) {
    if (e.kind !== "mob") continue;
    seen.add(e.id);
    let bar = mobBars.get(e.id);
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "mob-bar";
      bar.innerHTML = `<div class="mob-bar-fill"></div><span>${e.name ?? "Mob"}</span>`;
      dmgLayerEl.appendChild(bar);
      mobBars.set(e.id, bar);
    }
    const p = view.worldToScreen(e.x, e.y, 1.6);
    const fill = bar.firstElementChild as HTMLElement | null;
    if (fill) fill.style.width = `${e.hpPct}%`;
    bar.style.display = p.behind ? "none" : "block";
    bar.style.transform = `translate(${p.sx.toFixed(0)}px, ${p.sy.toFixed(0)}px) translate(-50%, -100%)`;
  }
  for (const [id, bar] of [...mobBars.entries()]) {
    if (!seen.has(id)) {
      bar.remove();
      mobBars.delete(id);
    }
  }
  void now;
}

// --- Net + prediction state ---
let playerId: number | null = null;
let predicted: SimState = { x: ZONE.zone.spawn.x, y: ZONE.zone.spawn.y, yaw: 0, moving: false };
let seq = 0;
let tick = 0;
const unacked: Array<{ seq: number; input: InputPayload }> = [];
let lastSnapshot: SnapshotPayload | null = null;
let lastInput: InputPayload = {
  seq: 0, tick: 0, moveX: 0, moveY: 0, yaw: 0, buttons: 0, skillId: 0,
};
let rejects = 0;
/** Hit-stop freeze end (performance.now ms) after landing a hit. */
let hitStopUntil = 0;
/** Perfect-dodge slow-mo end (performance.now ms). */
let slowMoUntil = 0;
/** Entity ids currently rendered (for removing entities that left the zone). */
const knownEntities = new Set<number>();
/** Correction offset: the part of a reconciliation error not yet glided away.
 *  Display position = predicted + correction, so a snapshot never jumps the
 *  capsule on screen; the offset decays to zero in ~120 ms. */
let corrX = 0;
let corrY = 0;
/** Received snapshot samples per remote entity (local receipt timestamps). */
const remoteHistory = new Map<number, RemoteSample[]>();

const client = new GameClient(serverUrl, simulatedLatencyMs, {
  onWelcome(w: WelcomePayload) {
    playerId = w.playerId;
    corrX = 0;
    corrY = 0;
    remoteHistory.clear();
    statusEl.textContent = `Conectado — zona ${w.zoneId} · tick ${w.tickRate} Hz`;
    playerEl.textContent = `Você é o jogador #${w.playerId} · backend: ${view.backend}`;
    const me = w.entities.find((e) => e.id === w.playerId);
    if (me) {
      predicted = { x: me.x, y: me.y, yaw: me.yaw, moving: false };
      cameraYaw = me.yaw;
    }
  },
  onSnapshot(snap: SnapshotPayload) {
    lastSnapshot = snap;
    if (playerId === null) return;
    // Record receipt times for the remote interpolation buffer.
    const nowMs = performance.now();
    for (const e of snap.entities) {
      if (e.id === playerId) continue;
      const history = remoteHistory.get(e.id) ?? [];
      history.push({ tMs: nowMs, x: e.x, y: e.y, yaw: e.yaw, animState: e.animState });
      if (history.length > 8) history.splice(0, history.length - 8);
      remoteHistory.set(e.id, history);
    }
    const me = snap.entities.find((e) => e.id === playerId);
    if (!me) return;
    // Smooth reconciliation: rewind to the authoritative state and re-apply
    // unacked inputs; the remaining error glides away instead of teleporting
    // (only errors > 2 m snap — respawn / hard desync).
    const authoritative: SimState = { x: me.x, y: me.y, yaw: me.yaw, moving: me.animState === 1 };
    const result = reconcilePrediction(
      predicted,
      authoritative,
      unacked,
      snap.ackSeq,
      ZONE.player.walkSpeedMps,
    );
    if (result.teleport) {
      predicted = result.corrected;
      corrX = 0;
      corrY = 0;
      unacked.length = 0;
    } else {
      // Keep the on-screen position continuous: fold the error into the
      // correction offset instead of moving the capsule.
      corrX -= result.deltaX;
      corrY -= result.deltaY;
      predicted = result.corrected;
      unacked.length = 0;
      unacked.push(...result.stillPending);
    }
  },
  onEvent(e: EventPayload) {
    if (e.type === "hit") {
      if (e.sourceId === playerId) {
        // We dealt the hit: hit-stop + juice.
        hitStopUntil = performance.now() + hitStopFrames(e.crit, e.finisher === true) * (1000 / 60);
        view.addShake(e.crit ? 0.06 : 0.03);
        view.addFovPulse(e.crit || e.finisher === true ? 2 : 1);
      } else if (e.targetId === playerId) {
        view.addShake(0.08);
      }
      spawnFloat(e.x, e.y, String(e.amount), e.crit ? "dmg-crit" : e.finisher === true ? "dmg-finisher" : "dmg-hit");
    } else if (e.type === "kill") {
      spawnFloat(e.x, e.y, "Abate!", "dmg-kill");
    } else if (e.type === "parry") {
      spawnFloat(e.x, e.y, "PARRY!", "dmg-parry");
      view.addShake(0.05);
    } else if (e.type === "perfect") {
      spawnFloat(e.x, e.y, "ESQUIVA PERFEITA!", "dmg-perfect");
      slowMoUntil = performance.now() + 120;
    } else if (e.type === "skill") {
      if (e.sourceId === playerId) spawnFloat(e.x, e.y, `${SKILL_NAME}!`, "dmg-skill");
    } else if (e.type === "heal") {
      spawnFloat(e.x, e.y, `+${e.amount}`, "dmg-heal");
    }
  },
  onReject(_seq: number, reason: string) {
    rejects += 1;
    console.warn("input rejected:", reason);
    // Combat reject = the server refused the action: roll the visual back
    // (the swing arc fades out over 80 ms).
    if (["state", "stamina", "mana", "cooldown", "skill"].includes(reason)) {
      cancelLocalVisual();
    }
  },
  onClose() {
    statusEl.textContent = "Desconectado do servidor — recarregue a página.";
  },
});

// --- Main loop ---
let lastFrame = performance.now();
let acc = 0;
let fpsEma = 60;
let frameMsEma = 16;
let lastSend = 0;
let lastDebugUpdate = 0;

function frame(now: number): void {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  fpsEma = fpsEma * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;
  frameMsEma = frameMsEma * 0.95 + dt * 1000 * 0.05;
  // Perfect-dodge slow-mo: everything local runs at 0.35x for 120 ms.
  const effDt = now < slowMoUntil ? dt * 0.35 : dt;

  // Fixed 60 Hz logical update for local prediction (frozen during hit-stop).
  if (now >= hitStopUntil) {
    acc += effDt;
    const step = 1 / 60;
    let guard = 0;
    while (acc >= step && guard < 8) {
      acc -= step;
      guard += 1;
      tick += 1;
      const { moveX, moveY } = readMove();
      // Combat-aware prediction: the server moves the player the same way
      // (dodge dash, attack lunge, guard stationary), so predict it too.
      localVisual.frame += 1;
      if (localVisual.state === "dodge") {
        const perFrame = 4 / dodgeTotalFrames();
        predicted.x += localVisual.dodgeDirX * perFrame;
        predicted.y += localVisual.dodgeDirY * perFrame;
        if (localVisual.frame >= dodgeTotalFrames()) {
          localVisual.state = "idle";
          localVisual.frame = 0;
        }
      } else if (localVisual.state === "attack") {
        const hit = ESPADACHIM_CHAIN[localVisual.chain];
        if (hit) {
          const [a0, a1] = chainActiveRange(hit);
          if (localVisual.frame >= a0 && localVisual.frame < a1) {
            const perFrame = hit.advanceM / hit.active;
            predicted.x += Math.sin(cameraYaw) * perFrame;
            predicted.y += Math.cos(cameraYaw) * perFrame;
          }
          if (localVisual.frame >= chainTotalFrames(hit)) {
            localVisual.state = "idle";
            localVisual.frame = 0;
            localVisual.chain = 0;
          }
        } else {
          localVisual.state = "idle";
          localVisual.frame = 0;
        }
      } else if (localVisual.state === "skill") {
        if (localVisual.frame >= 36) {
          localVisual.state = "idle";
          localVisual.frame = 0;
        }
      } else if (localVisual.state === "guard") {
        // Guard is stationary; no walk prediction while held.
      } else {
        predicted = stepMovement(predicted, { moveX, moveY, yaw: cameraYaw }, step, ZONE.player.walkSpeedMps);
      }
      lastInput = { seq, tick, moveX, moveY, yaw: cameraYaw, buttons: 0, skillId: 0 };
    }
    if (acc > 0.25) acc = 0; // don't spiral after a hit-stop / tab switch
  }

  // Consume edge-triggered combat actions (start the visual immediately).
  if (pendingAttack) {
    pendingAttack = false;
    lastAttackSent = true;
    startLocalAttack();
  }
  if (pendingDodge) {
    pendingDodge = false;
    lastDodgeSent = true;
    startLocalDodge();
  }
  if (pendingSkill) {
    pendingSkill = false;
    lastSkillSent = true;
    startLocalSkill();
  }
  if (guardHeld && localVisual.state === "idle") {
    localVisual.state = "guard";
    localVisual.frame = 0;
  } else if (!guardHeld && localVisual.state === "guard") {
    localVisual.state = "idle";
    localVisual.frame = 0;
  }

  // Send inputs at the server tick rate (20 Hz).
  if (now - lastSend >= 50 && client.connected) {
    lastSend = now;
    seq += 1;
    const buttons =
      (lastAttackSent ? 1 : 0) | (lastDodgeSent ? 2 : 0) | (guardHeld ? 4 : 0);
    const input: InputPayload = {
      ...lastInput,
      seq,
      buttons,
      skillId: lastSkillSent ? 1 : 0,
    };
    lastAttackSent = false;
    lastDodgeSent = false;
    lastSkillSent = false;
    unacked.push({ seq, input });
    if (unacked.length > 40) unacked.splice(0, unacked.length - 40);
    client.sendInput(input);
  }

  // Glide the reconciliation correction away (~120 ms time constant).
  corrX = decayCorrection(corrX, dt);
  corrY = decayCorrection(corrY, dt);
  if (Math.abs(corrX) < 0.001) corrX = 0;
  if (Math.abs(corrY) < 0.001) corrY = 0;
  const displayX = predicted.x + corrX;
  const displayY = predicted.y + corrY;

  // Render world.
  if (lastSnapshot && playerId !== null) {
    // Render remote entities ~100 ms in the past, interpolated between the
    // two snapshots bracketing that instant (AGENTS.md §4).
    const renderTimeMs = now - REMOTE_INTERP_BUFFER_MS;
    for (const e of lastSnapshot.entities) {
      knownEntities.add(e.id);
      if (e.kind === "mob") {
        view.updateMob(e);
        continue;
      }
      const isLocal = e.id === playerId;
      let shown: EntityState;
      if (isLocal) {
        // Local animState comes from the visual combat state (prediction),
        // not from the snapshot, so the swing starts immediately.
        const localAnim =
          localVisual.state === "attack" ? 2 :
          localVisual.state === "dodge" ? 3 :
          localVisual.state === "guard" ? 4 :
          localVisual.state === "skill" ? 5 :
          predicted.moving ? 1 : 0;
        shown = { ...e, x: displayX, y: displayY, yaw: cameraYaw, animState: localAnim };
      } else {
        const interp = interpolateRemote(remoteHistory.get(e.id) ?? [], renderTimeMs);
        shown = interp
          ? { ...e, x: interp.x, y: interp.y, yaw: interp.yaw, animState: interp.animState }
          : e;
      }
      view.updatePlayer(shown, isLocal);
    }
    // Drop history and meshes for entities that left the zone (dead mobs, leavers).
    for (const id of [...remoteHistory.keys()]) {
      if (!lastSnapshot.entities.some((e) => e.id === id)) remoteHistory.delete(id);
    }
    for (const id of [...knownEntities]) {
      if (!lastSnapshot.entities.some((e) => e.id === id)) {
        knownEntities.delete(id);
        view.removeEntity(id);
      }
    }
    updateMobBars(now, lastSnapshot.entities);
    // HUD bars from the local snapshot entity (server-authoritative values).
    const me = lastSnapshot.entities.find((e) => e.id === playerId);
    if (me) {
      hpFillEl.style.width = `${me.hpPct}%`;
      stFillEl.style.width = `${me.staminaPct ?? 100}%`;
      mpFillEl.style.width = `${me.manaPct ?? 100}%`;
    }
  }
  updateFloats(now);
  view.updateCamera(displayX, displayY, cameraYaw, effDt);
  view.render();

  if (now - lastDebugUpdate > 250) {
    lastDebugUpdate = now;
    const stats = view.getStats();
    const me = lastSnapshot?.entities.find((e) => e.id === playerId);
    const mobs = lastSnapshot?.entities.filter((e) => e.kind === "mob") ?? [];
    const nearest = mobs
      .map((m) => ({ m, d: Math.hypot(m.x - displayX, m.y - displayY) }))
      .sort((a, b) => a.d - b.d)[0];
    debugEl.textContent =
      `backend: ${view.backend}\n` +
      `fps: ${fpsEma.toFixed(0)}  frame: ${frameMsEma.toFixed(1)} ms\n` +
      `draw calls: ${stats.calls}  tris: ${stats.triangles}\n` +
      `ping: ${client.rttMs.toFixed(0)} ms (sim ${simulatedLatencyMs} ms)\n` +
      `lost snapshots: ${client.lostSnapshots}  rejects: ${rejects}\n` +
      `players: ${lastSnapshot?.entities.filter((e) => e.kind === "player").length ?? 0}  mobs: ${mobs.length}  server tick: ${lastSnapshot?.serverTick ?? "-"}\n` +
      `pos: ${displayX.toFixed(1)}, ${displayY.toFixed(1)}  seq: ${seq}  corr: ${Math.hypot(corrX, corrY).toFixed(2)}\n` +
      `classe: Espadachim  estado: ${localVisual.state}${localVisual.state === "attack" ? ` golpe ${localVisual.chain + 1}` : ""}  hp: ${me?.hpPct ?? "-"}%\n` +
      `alvo: ${nearest ? `${nearest.m.name ?? "mob"} hp ${nearest.m.hpPct}% a ${nearest.d.toFixed(1)} m` : "-"}\n` +
      `controles: LMB ataque · Espaço esquiva · RMB guarda · Q ${SKILL_NAME} · WASD mover`;
  }
}

async function main(): Promise<void> {
  await view.init();
  playerEl.textContent = `backend: ${view.backend} · servidor ${serverUrl}`;
  client.connect(playerName);
  view.renderer.setAnimationLoop((time: number) => frame(time));
  // Fallback if setAnimationLoop is a no-op in some backend: rAF keeps running
  // via the renderer's own loop; frame() is driven by setAnimationLoop.
}

main().catch((err: unknown) => {
  statusEl.textContent = `Falha ao iniciar o renderer: ${String(err)}`;
  console.error(err);
});
