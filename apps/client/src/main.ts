import { ZONE } from "@azure-edge/gamedata";
import {
  REMOTE_INTERP_BUFFER_MS,
  decayCorrection,
  interpolateRemote,
  reconcilePrediction,
  stepMovement,
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

const view = new WorldView(appEl);

// --- Input state ---
const keys = new Set<string>();
let cameraYaw = 0;
let dragging = false;
let lastPointerX = 0;

window.addEventListener("keydown", (e) => {
  if (e.code === "F3") {
    e.preventDefault();
    debugEl.classList.toggle("on");
    return;
  }
  keys.add(e.code);
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
appEl.addEventListener("pointerdown", (e) => {
  dragging = true;
  lastPointerX = e.clientX;
});
window.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  cameraYaw -= (e.clientX - lastPointerX) * 0.005;
  lastPointerX = e.clientX;
});
window.addEventListener("pointerup", () => {
  dragging = false;
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
  onReject(_seq: number, reason: string) {
    rejects += 1;
    console.warn("input rejected:", reason);
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

  // Fixed 60 Hz logical update for local prediction.
  acc += dt;
  const step = 1 / 60;
  while (acc >= step) {
    acc -= step;
    tick += 1;
    const { moveX, moveY } = readMove();
    lastInput = { seq, tick, moveX, moveY, yaw: cameraYaw, buttons: 0, skillId: 0 };
    predicted = stepMovement(predicted, lastInput, step, ZONE.player.walkSpeedMps);
  }

  // Send inputs at the server tick rate (20 Hz).
  if (now - lastSend >= 50 && client.connected) {
    lastSend = now;
    seq += 1;
    const input: InputPayload = { ...lastInput, seq };
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
      const isLocal = e.id === playerId;
      let shown: EntityState;
      if (isLocal) {
        shown = { ...e, x: displayX, y: displayY, yaw: cameraYaw, animState: predicted.moving ? 1 : 0 };
      } else {
        const interp = interpolateRemote(remoteHistory.get(e.id) ?? [], renderTimeMs);
        shown = interp
          ? { ...e, x: interp.x, y: interp.y, yaw: interp.yaw, animState: interp.animState }
          : e;
      }
      view.updatePlayer(shown, isLocal);
    }
    // Drop history for entities that left the zone.
    for (const id of [...remoteHistory.keys()]) {
      if (!lastSnapshot.entities.some((e) => e.id === id)) remoteHistory.delete(id);
    }
  }
  view.updateCamera(displayX, displayY, cameraYaw, dt);
  view.render();

  if (now - lastDebugUpdate > 250) {
    lastDebugUpdate = now;
    const stats = view.getStats();
    debugEl.textContent =
      `backend: ${view.backend}\n` +
      `fps: ${fpsEma.toFixed(0)}  frame: ${frameMsEma.toFixed(1)} ms\n` +
      `draw calls: ${stats.calls}  tris: ${stats.triangles}\n` +
      `ping: ${client.rttMs.toFixed(0)} ms (sim ${simulatedLatencyMs} ms)\n` +
      `lost snapshots: ${client.lostSnapshots}  rejects: ${rejects}\n` +
      `players: ${lastSnapshot?.entities.length ?? 0}  server tick: ${lastSnapshot?.serverTick ?? "-"}\n` +
      `pos: ${displayX.toFixed(1)}, ${displayY.toFixed(1)}  seq: ${seq}  corr: ${Math.hypot(corrX, corrY).toFixed(2)}`;
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
