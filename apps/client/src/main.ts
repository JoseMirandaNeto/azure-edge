import { ZONE, armorById, armorsForClass, classById, mobById, skillById, zoneById, dungeonById, type ChainHit } from "@azure-edge/gamedata";
import { applyClassPreset, generateGenome, type CharacterGenome } from "@azure-edge/charforge";
import {
  REMOTE_INTERP_BUFFER_MS,
  chainActiveRange,
  chainTotalFrames,
  decayCorrection,
  dodgeTotalFrames,
  hitStopFrames,
  interpolateRemote,
  isInCancelWindow,
  parseCameraMode,
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
import { CharacterCreator, loadSavedGenome } from "./creator.js";
import "./hud.css";
import { createHud, maxStatsFor, minimapMobsFromEntities, partyMembersFromEntities, type Hud } from "./hud.js";
import { GameScreens } from "./screens.js";

/**
 * M0 client: third-person movement + client-side prediction + reconciliation.
 * The client only sends inputs; positions come from server snapshots.
 */

const params = new URLSearchParams(window.location.search);
const simulatedLatencyMs = Number(params.get("latency") ?? 0) || 0;
/** Vertical slice: `?class=guerreiro|atirador|curandeiro|espadachim`
 *  (default espadachim), `?gender=f|m`, `?armor=<id>`, `?zone=cidade_serket|dunas_serket`,
 *  `?dungeon=tumbas|templo`, `?camera=2.5d|3d` (default 2.5d). */
const paramClass = classById(params.get("class") ?? "") ?? null;
const paramGender: "f" | "m" = params.get("gender") === "m" ? "m" : "f";
const paramArmor = params.get("armor") ?? null;
const paramZone = params.get("zone") ?? null;
const paramDungeon = params.get("dungeon") ?? null;
/** Debug-only visual mobs: `?testmobs=golem_areia,cultista_serket` places
 *  local-only models near spawn (no server entity) so Playwright can
 *  screenshot mobIds that never spawn in the current zone. */
const paramTestMobs = params.get("testmobs") ?? null;
/** Debug-only test-mob yaw offset (radians): `?testmobry=1.57` turns the
 *  ?testmobs= placement sideways for side/back screenshots (PI = back). */
const paramTestMobRy = Number(params.get("testmobry") ?? 0) || 0;
/** Debug test mobs are placed once, on welcome (relative to the real spawn). */
let testMobsPlaced = false;
const cameraMode = parseCameraMode(params.get("camera"));
/** Character mesh: `?char=warrior` forces the rigged GLB (skips the creator,
 *  Espadachim by default); `?char=capsule` forces the CharForge/capsule
 *  placeholder; default (no param) is the GLB for everyone — loaded in the
 *  background at boot, CharForge until it arrives, permanent fallback if
 *  the load fails. */
const charParam = params.get("char");
const charMode: "auto" | "glb" | "capsule" =
  charParam === "capsule" ? "capsule" : charParam === "warrior" ? "glb" : "auto";
const GLB_CHARACTER_URL = "/assets/characters/warrior_f_r64_final.glb";
const GLB_MALE_URL = "/assets/characters/warrior_m_klein_r64_final_rigged.glb";
// Deploy-ready: on an https:// page the browser blocks plain ws://
// (mixed content), so default to wss:// there. `?server=` still wins,
// then the build-time VITE_GAME_SERVER_URL (e.g. wss://…onrender.com).
const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
const serverUrl =
  params.get("server") ??
  import.meta.env.VITE_GAME_SERVER_URL ??
  `${wsProtocol}://${window.location.hostname || "localhost"}:3001`;
/** M2: the local player's CharForge genome (localStorage) + display name. */
let currentGenome: CharacterGenome | null = null;
let playerName = "";
let classLabel = "Espadachim";

const statusEl = document.getElementById("status") as HTMLElement;
const playerEl = document.getElementById("player") as HTMLElement;
const debugEl = document.getElementById("debug") as HTMLElement;
const appEl = document.getElementById("app") as HTMLElement;
const dmgLayerEl = document.getElementById("dmg-layer") as HTMLElement;

const view = new WorldView(appEl);
view.setCameraMode(cameraMode);

/** Novo HUD (hud.ts) e telas/menus (screens.ts) — criados em startGame/boot. */
let hud: Hud | null = null;
let currentZoneId = "cidade_serket";
let deathShown = false;
const screens = new GameScreens({
  version: "0.1.0",
  serverLabel: "Render free",
  getClassId: () => currentGenome?.classId ?? null,
  getZoneId: () => currentZoneId,
  getPlayerPosition: () => ({ x: predicted.x, y: predicted.y }),
  getEquippedArmorId: () => currentArmorId,
  onEquipArmor: (armorId) => {
    currentArmorId = armorId;
    view.setArmor(armorId);
    hud?.setClass(currentGenome?.classId ?? "", armorId);
  },
  onReturnToStart: () => window.location.reload(),
  onToggleHud: (visible) => {
    const el = document.querySelector(".ae-hud") as HTMLElement | null;
    if (el) el.style.display = visible ? "" : "none";
  },
});

/** Selected class (from the genome at boot): chain, skill name, walk speed. */
let classChain: ChainHit[] = [];
let skillName = "Corte Crescente";
let walkSpeedMps = ZONE.player.walkSpeedMps;
let currentArmorId: string | null = null;
let zoneLabel = "Dunas de Serket";

/** Loading splash (arte da Serket): some com fade quando o jogo está pronto.
 *  Delega para o GameScreens, que limpa o timer de dicas e o fade. */
function hideLoading(): void {
  screens.hideLoading();
}

// --- Input state ---
const keys = new Set<string>();
/** 2.5D: fixed camera, yaw stays 0 (W = screen-up/north). 3D: orbit yaw. */
let cameraYaw = 0;
/** Orbit elevation: default preserves the M0 framing (heightM above ground). */
const PITCH_MIN = 0.05;
const PITCH_MAX = 1.25;
let cameraPitch = Math.asin(Math.min(0.9, (ZONE.camera.heightM - 1.4) / ZONE.camera.distanceM));
/** The click that acquires pointer lock must not also fire an attack. */
let suppressNextAttack = false;
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
  // Typing in the creator (name field) must not trigger game actions.
  if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
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
  if (e.code === "KeyT" && !e.repeat) cycleArmor();
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
  // First click captures the mouse (pointer lock) for mouse-look in 3D mode;
  // in 2.5D there is no orbit, so no lock is requested. If the lock is
  // refused/unavailable, dragging still rotates the camera (3D only).
  if (cameraMode === "3d" && !view.isPointerLocked()) {
    view.requestPointerLock();
    suppressNextAttack = true;
  }
  if (e.button === 2) guardHeld = true;
});
window.addEventListener("pointermove", (e) => {
  // 2.5D: no orbit — the camera is fixed; only the wheel zooms.
  if (cameraMode === "2.5d") return;
  if (view.isPointerLocked()) {
    // Mouse-look: horizontal orbits the camera, vertical raises/lowers it.
    cameraYaw -= e.movementX * 0.005;
    cameraPitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, cameraPitch - e.movementY * 0.005));
    return;
  }
  if (!dragging) return;
  cameraYaw -= (e.clientX - lastPointerX) * 0.005;
  lastPointerX = e.clientX;
});
appEl.addEventListener("wheel", (e) => {
  if (cameraMode !== "2.5d") return;
  e.preventDefault();
  view.setZoom25D(view.zoom25DValue + Math.sign(e.deltaY));
}, { passive: false });
window.addEventListener("pointerup", (e) => {
  // LMB click (no drag) = attack; drag = camera. The click that locked the
  // pointer does not attack.
  if (e.button === 0 && !suppressNextAttack && Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY) < 6) {
    pendingAttack = true;
  }
  suppressNextAttack = false;
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
function setClassCombat(classId: string): void {
  const cls = classById(classId);
  classChain = cls?.basicChain ?? [];
  skillName = skillById(cls?.skillId ?? "")?.name ?? "Skill";
  walkSpeedMps = cls?.base.walkSpeedMps ?? ZONE.player.walkSpeedMps;
}

/** Cycle the armor sets of the current class (T): visual only in-session —
 *  the server maxHp bonus comes from the ?armor= used at join time. */
function cycleArmor(): void {
  if (!currentGenome) return;
  const sets = armorsForClass(currentGenome.classId);
  if (sets.length === 0) return;
  const idx = sets.findIndex((a) => a.id === currentArmorId);
  const next = sets[(idx + 1) % sets.length];
  if (!next) return;
  currentArmorId = next.id;
  view.setArmor(next.id);
  hud?.setClass(currentGenome?.classId ?? "", next.id);
  playerEl.textContent = `Armadura: ${next.name} (visual — bônus de +${next.bonus.maxHp} HP vale no próximo login)`;
}

interface LocalVisual {
  state: "idle" | "attack" | "dodge" | "guard" | "skill";
  frame: number;
  chain: number;
  dodgeDirX: number;
  dodgeDirY: number;
}
let localVisual: LocalVisual = { state: "idle", frame: 0, chain: 0, dodgeDirX: 0, dodgeDirY: 1 };

function startLocalAttack(): void {
  const chain = classChain[localVisual.chain];
  if (localVisual.state === "attack" && chain && isInCancelWindow(chain, localVisual.frame)) {
    localVisual.chain = Math.min(localVisual.chain + 1, classChain.length - 1);
    localVisual.frame = 0;
  } else if (localVisual.state === "idle") {
    localVisual.chain = 0;
    localVisual.state = "attack";
    localVisual.frame = 0;
  } else {
    return;
  }
  view.showSwingFor(playerId ?? -1, predicted.x, predicted.y, cameraMode === "2.5d" ? predicted.yaw : cameraYaw, 2.5, 140, 0x9fd8ff);
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
  view.showSwingFor(playerId ?? -1, predicted.x, predicted.y, cameraMode === "2.5d" ? predicted.yaw : cameraYaw, 3.2, 140, 0x66aaff);
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
    hud?.setConnectionState("connected");
    hud?.setZone(w.zoneId);
    hideLoading();
    const me = w.entities.find((e) => e.id === w.playerId);
    if (me) {
      predicted = { x: me.x, y: me.y, yaw: me.yaw, moving: false };
      // 2.5D: fixed camera, yaw stays 0 (W = north); 3D: orbit follows the spawn yaw.
      if (cameraMode === "3d") cameraYaw = me.yaw;
      // Debug-only visual mobs (?testmobs=): place them north of the REAL
      // spawn (player ids grow a golden-angle ring, so the origin is not
      // the spawn). Distance scales with the mob so bosses fit the frame.
      if (paramTestMobs && !testMobsPlaced) {
        testMobsPlaced = true;
        const ids = paramTestMobs.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
        ids.forEach((id, i) =>
          view.addTestMob(
            id,
            me.x + (i - (ids.length - 1) / 2) * 4,
            me.y + 4 * (mobById(id)?.scale ?? 1),
            paramTestMobRy,
          ),
        );
      }
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
      walkSpeedMps,
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
      const mob = lastSnapshot?.entities.find((en) => en.id === e.targetId);
      if (mob?.mobId) hud?.noteKill(mob.mobId);
    } else if (e.type === "parry") {
      spawnFloat(e.x, e.y, "PARRY!", "dmg-parry");
      view.addShake(0.05);
    } else if (e.type === "perfect") {
      spawnFloat(e.x, e.y, "ESQUIVA PERFEITA!", "dmg-perfect");
      slowMoUntil = performance.now() + 120;
    } else if (e.type === "skill") {
      if (e.sourceId === playerId) spawnFloat(e.x, e.y, `${skillName}!`, "dmg-skill");
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
      hud?.clearSkillCooldown(classById(currentGenome?.classId ?? "")?.skillId ?? "");
    }
  },
  onClose() {
    hideLoading();
    hud?.setConnectionState("disconnected");
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
        const hit = classChain[localVisual.chain];
        if (hit) {
          const [a0, a1] = chainActiveRange(hit);
          if (localVisual.frame >= a0 && localVisual.frame < a1) {
            const perFrame = hit.advanceM / hit.active;
            // Lunge toward the facing yaw (2.5D: predicted.yaw) — the
            // server lunges along p.yaw, so the prediction must match it
            // (cameraYaw is 0 in 2.5D and lunged north from every facing).
            const lungeYaw = cameraMode === "2.5d" ? predicted.yaw : cameraYaw;
            predicted.x += Math.sin(lungeYaw) * perFrame;
            predicted.y += Math.cos(lungeYaw) * perFrame;
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
        // stepMovement overwrites yaw with the input (camera) yaw — in
        // 2.5D that is 0, which snapped the hero back to facing north the
        // instant she stopped walking. Keep the facing: movement direction
        // while walking, last facing while idle.
        const facingYaw = predicted.yaw;
        predicted = stepMovement(predicted, { moveX, moveY, yaw: cameraYaw }, step, walkSpeedMps);
        if (cameraMode === "2.5d") {
          predicted.yaw = predicted.moving ? Math.atan2(moveX, moveY) : facingYaw;
        }
      }
      // 2.5D: the server runs stepMovement with input.yaw as BOTH the
      // movement frame and the facing yaw, while the client predicts with
      // the fixed camera yaw (0). Sending the raw screen-relative move
      // with the facing yaw walked S/D/A the wrong way server-side (S
      // walked the player north). Rotate the move into the facing frame
      // so the server reproduces the client's world-space move: R(-yaw).
      const sendYaw = cameraMode === "2.5d" ? predicted.yaw : cameraYaw;
      let sendMoveX = moveX;
      let sendMoveY = moveY;
      if (cameraMode === "2.5d") {
        const sin = Math.sin(predicted.yaw);
        const cos = Math.cos(predicted.yaw);
        sendMoveX = moveX * cos - moveY * sin;
        sendMoveY = moveX * sin + moveY * cos;
      }
      lastInput = { seq, tick, moveX: sendMoveX, moveY: sendMoveY, yaw: sendYaw, buttons: 0, skillId: 0 };
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
    hud?.startSkillCooldown(classById(currentGenome?.classId ?? "")?.skillId ?? "");
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
        view.updateMob(e, lastSnapshot.serverTick);
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
        shown = { ...e, x: displayX, y: displayY, yaw: cameraMode === "2.5d" ? predicted.yaw : cameraYaw, animState: localAnim };
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
    // HUD (server-authoritative values) + tela de morte quando o HP zera.
    const me = lastSnapshot.entities.find((e) => e.id === playerId);
    if (me) {
      if (me.hpPct <= 0 && !deathShown) {
        deathShown = true;
        window.dispatchEvent(new CustomEvent("ae:show-death", { detail: { respawnSeconds: 5 } }));
      } else if (me.hpPct > 0 && deathShown) {
        deathShown = false;
        window.dispatchEvent(new CustomEvent("ae:hide-death"));
      }
    }
    if (me && hud) {
      hud.update({
        hpPct: me.hpPct,
        manaPct: me.manaPct ?? 100,
        staminaPct: me.staminaPct ?? 100,
        mana: ((me.manaPct ?? 100) / 100) * maxStatsFor(currentGenome?.classId ?? "", currentArmorId).maxMana,
        playerX: displayX,
        playerY: displayY,
        playerYaw: predicted.yaw,
        pingMs: client.rttMs,
        party: partyMembersFromEntities(lastSnapshot.entities, playerId),
        mobs: minimapMobsFromEntities(lastSnapshot.entities, displayX, displayY),
      });
    }
  }
  updateFloats(now);
  view.updateCamera(displayX, displayY, cameraYaw, cameraPitch, effDt);
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
      `classe: ${classLabel}  estado: ${localVisual.state}${localVisual.state === "attack" ? ` golpe ${localVisual.chain + 1}` : ""}  hp: ${me?.hpPct ?? "-"}%\n` +
      `zona: ${zoneLabel}  câmera: ${cameraMode}  armadura: ${currentArmorId ?? "-"} (T troca)\n` +
      `alvo: ${nearest ? `${nearest.m.name ?? "mob"}${nearest.m.level ? ` nv ${nearest.m.level}` : ""} hp ${nearest.m.hpPct}% a ${nearest.d.toFixed(1)} m` : "-"}\n` +
      `controles: LMB ataque · Espaço esquiva · RMB guarda · Q ${skillName} · T armadura · WASD mover${cameraMode === "2.5d" ? " · roda zoom" : ""}`;
  }
}

const creatorEl = document.getElementById("creator") as HTMLElement;
const creatorPreviewEl = document.getElementById("creator-preview") as HTMLElement;
const creator = new CharacterCreator(creatorEl, creatorPreviewEl);

/** Start the game world with a CharForge genome (replaces the capsule). */
async function startGame(genome: CharacterGenome, name: string): Promise<void> {
  currentGenome = genome;
  playerName = name;
  classLabel = classById(genome.classId)?.name ?? "Espadachim";
  setClassCombat(genome.classId);
  // Armor: ?armor= wins when it belongs to the class; otherwise tier 1.
  const armor = paramArmor ? armorById(paramArmor) : undefined;
  currentArmorId =
    armor && armor.classId === genome.classId
      ? armor.id
      : (armorsForClass(genome.classId)[0]?.id ?? null);
  // Zone: ?dungeon= wins over ?zone=; default is the city (lv 1-20 hub).
  const dungeon = paramDungeon ? dungeonById(paramDungeon) : undefined;
  const zone = paramZone ? zoneById(paramZone) : undefined;
  const zoneId = dungeon ? undefined : (zone?.zone.id ?? "cidade_serket");
  zoneLabel = dungeon ? dungeon.name : (zone?.zone.name ?? "Cidade de Serket");
  currentZoneId = zoneId ?? dungeon?.id ?? "cidade_serket";
  // Novo HUD: remove o HUD antigo do index.html e constrói o novo.
  // A barra de ajuda antiga (#help) também sai — ela ficava por baixo da
  // hotbar e do chat novos; os controles estão na tela de configurações.
  screens.showLoading();
  screens.setLoadingStage(0, 0.5);
  document.getElementById("hud")?.remove();
  document.getElementById("help")?.remove();
  hud = createHud(document.body, {
    playerName: name,
    classId: genome.classId,
    armorId: currentArmorId,
    zoneId: currentZoneId,
    onSkill: () => {
      pendingSkill = true;
    },
  });
  view.setCharMode(charMode);
  await view.init(zoneId, dungeon?.id);
  // Debug handle for Playwright verification (draw calls / tris). Harmless
  // read-only handle on the user's own client.
  (window as unknown as { __aeView?: WorldView }).__aeView = view;
  view.setArmor(currentArmorId);
  // Scenery GLBs (temple/house/stall): procedural placeholders swap to the
  // TRELLIS2 meshes when they arrive; palm stays procedural. Loads in
  // every character mode — ?char=capsule only swaps the CHARACTER mesh.
  void view.loadSceneryGlbs();
  if (charMode === "capsule") {
    view.setLocalGenome(genome);
  } else {
    // GLB first (background, non-blocking): the CharForge build renders
    // until the GLB arrives, then local + remote players swap to GLB
    // clones; if the load fails the CharForge mesh stays as the fallback.
    view.setLocalGenome(genome);
    void view.loadGlbCharacter(GLB_CHARACTER_URL);
    void view.loadGlbMaleCharacter(GLB_MALE_URL);
  }
  playerEl.textContent = `backend: ${view.backend} · servidor ${serverUrl}`;
  screens.setLoadingStage(2, 1);
  client.connect(playerName, {
    classId: genome.classId,
    ...(currentArmorId ? { armorId: currentArmorId } : {}),
    gender: genome.gender,
    ...(zoneId ? { zoneId } : {}),
    ...(dungeon ? { dungeonId: dungeon.id } : {}),
  });
  view.renderer.setAnimationLoop((time: number) => frame(time));
}

/** Reopen the creator over the running game (HUD "Personagem" button). */
document.getElementById("btn-personagem")?.addEventListener("click", () => {
  void (async () => {
    if (!currentGenome) return;
    const result = await creator.show(currentGenome, playerName);
    currentGenome = result.genome;
    playerName = result.name || playerName;
    classLabel = classById(result.genome.classId)?.name ?? "Espadachim";
    hud?.setClass(result.genome.classId);
    // setLocalGenome re-applies the GLB (with the new class/gender) when
    // the template is loaded; otherwise it rebuilds the CharForge mesh.
    view.setLocalGenome(result.genome);
  })();
});

/** Poção usada no inventário (efeito LOCAL — o servidor não aplica consumíveis). */
window.addEventListener("ae:use-potion", (e) => {
  const detail = (e as CustomEvent<{ healHp?: number; restoreMana?: number }>).detail;
  if (detail?.healHp) hud?.showLocalRestore("hp", detail.healHp);
  if (detail?.restoreMana) hud?.showLocalRestore("mana", detail.restoreMana);
});

/**
 * Boot: no saved genome (or `?creator=1`) → the creator runs first
 * (class first, then customization); otherwise straight into the zone.
 * `?char=warrior` skips the creator (default Espadachim genome) and forces
 * the rigged GLB character; without it the GLB still becomes the default
 * mesh (loaded in the background by startGame), and `?char=capsule`
 * forces the CharForge/capsule placeholder for debug.
 * `?class=` / `?gender=` override the genome in-memory (no save) so the
 * vertical slice can be tested straight from a URL.
 */
async function boot(): Promise<void> {
  let genome = loadSavedGenome();
  let name = params.get("name") ?? "";
  const quickClass = paramClass ?? (charMode === "glb" ? classById("espadachim") : null);
  // Tela inicial (Jogar/Continuar) — exceto em deep links de teste/jogo rápido
  // (?class=, ?char=warrior, ?creator=1), que entram direto como antes.
  const quickPlay = Boolean(quickClass) || params.has("creator");
  if (!quickPlay) {
    // O splash de loading cobre a tela: sem escondê-lo, a tela inicial
    // aparece por baixo e o botão Jogar não recebe o clique.
    hideLoading();
    const choice = await screens.showStart();
    if (choice === "continue" && genome) {
      // Usa o personagem salvo e pula o criador (fluxo abaixo preservado).
    } else {
      hideLoading(); // O criador cobre a tela; o splash não pode ficar por cima.
      const result = await creator.show(null, name);
      genome = result.genome;
      name = result.name;
    }
  } else if (quickClass && !genome) {
    genome = applyClassPreset(generateGenome(20261112, { gender: paramGender }), quickClass.id as CharacterGenome["classId"]);
  } else if (!genome || params.has("creator")) {
    hideLoading(); // O criador cobre a tela; o splash não pode ficar por cima.
    const result = await creator.show(genome, name);
    genome = result.genome;
    name = result.name;
  }
  if (paramClass && genome) {
    genome = applyClassPreset(genome, paramClass.id as CharacterGenome["classId"]);
  }
  if (params.has("gender") && genome) {
    genome = { ...genome, gender: paramGender };
  }
  if (!name) name = `Player-${crypto.randomUUID().slice(0, 4)}`;
  await startGame(genome, name);
}

boot().catch((err: unknown) => {
  hideLoading();
  statusEl.textContent = `Falha ao iniciar: ${String(err)}`;
  console.error(err);
});
