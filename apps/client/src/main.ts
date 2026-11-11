import { ZONE } from "@azure-edge/gamedata";
import {
  stepMovement,
  TICK_DT_S,
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

const client = new GameClient(serverUrl, simulatedLatencyMs, {
  onWelcome(w: WelcomePayload) {
    playerId = w.playerId;
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
    const me = snap.entities.find((e) => e.id === playerId);
    if (!me) return;
    // Reconciliation: rewind to the authoritative state, then re-apply
    // inputs the server has not acked yet (each input = one server tick).
    const dx = me.x - predicted.x;
    const dy = me.y - predicted.y;
    if (Math.hypot(dx, dy) > 0.5) {
      predicted = { x: me.x, y: me.y, yaw: me.yaw, moving: me.animState === 1 };
      unacked.length = 0;
    } else {
      predicted = { x: me.x, y: me.y, yaw: me.yaw, moving: me.animState === 1 };
      const stillPending = unacked.filter((u) => u.seq > snap.ackSeq);
      unacked.length = 0;
      unacked.push(...stillPending);
      for (const u of stillPending) {
        predicted = stepMovement(predicted, u.input, TICK_DT_S, ZONE.player.walkSpeedMps);
      }
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

  // Render world.
  if (lastSnapshot && playerId !== null) {
    for (const e of lastSnapshot.entities) {
      const isLocal = e.id === playerId;
      const shown: EntityState = isLocal
        ? { ...e, x: predicted.x, y: predicted.y, yaw: cameraYaw, animState: predicted.moving ? 1 : 0 }
        : e;
      view.updatePlayer(shown, isLocal, dt);
    }
    const seen = new Set(lastSnapshot.entities.map((e) => e.id));
    // (Removal is handled on the next snapshot; stale meshes are rare in M0.)
    void seen;
  }
  view.updateCamera(predicted.x, predicted.y, cameraYaw);
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
      `pos: ${predicted.x.toFixed(1)}, ${predicted.y.toFixed(1)}  seq: ${seq}`;
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
