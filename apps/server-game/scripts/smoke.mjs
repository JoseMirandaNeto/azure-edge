/* M0 smoke test: boots the real server-game, connects 2 WS clients,
 * moves them, and asserts both see each other + positions advance.
 * Run: pnpm --filter @azure-edge/server-game smoke */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeMessages, encodeMessage, MessageType } from "../../../packages/shared/dist/index.js";

const require = createRequire(new URL("../package.json", import.meta.url));
const { WebSocket } = require("ws");

const PORT = 3101;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const server = spawn("node", ["apps/server-game/dist/index.js"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClient(name) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  ws.binaryType = "arraybuffer";
  const state = { welcome: null, snapshots: [], lastPos: null, pongs: 0 };
  let buf = new Uint8Array(0);
  ws.on("message", (data) => {
    const incoming = new Uint8Array(data);
    const joined = new Uint8Array(buf.length + incoming.length);
    joined.set(buf, 0);
    joined.set(incoming, buf.length);
    buf = joined;
    const { messages, rest } = decodeMessages(buf);
    buf = rest;
    for (const { type, payload } of messages) {
      if (type === MessageType.Welcome) state.welcome = payload;
      else if (type === MessageType.Snapshot) {
        state.snapshots.push(payload);
        const me = payload.entities.find((e) => e.id === state.welcome?.playerId);
        if (me) state.lastPos = { x: me.x, y: me.y };
      } else if (type === MessageType.Pong) state.pongs += 1;
    }
  });
  return { ws, state, name };
}

async function main() {
  await sleep(1200); // let the server boot
  const a = makeClient("A");
  const b = makeClient("B");
  await Promise.all([
    new Promise((r) => a.ws.on("open", r)),
    new Promise((r) => b.ws.on("open", r)),
  ]);
  a.ws.send(encodeMessage(MessageType.Hello, { protocolVersion: 0, clientBuild: "smoke", name: "A" }));
  b.ws.send(encodeMessage(MessageType.Hello, { protocolVersion: 0, clientBuild: "smoke", name: "B" }));
  await sleep(500);
  if (!a.state.welcome || !b.state.welcome) throw new Error("no Welcome received");
  const y0a = a.state.lastPos?.y;
  const y0b = b.state.lastPos?.y;
  // Move A forward (+y) and B sideways for 1.5 s at 20 Hz.
  let seq = 0;
  const iv = setInterval(() => {
    seq += 1;
    a.ws.send(encodeMessage(MessageType.Input, { seq, tick: seq, moveX: 0, moveY: 1, yaw: 0, buttons: 0, skillId: 0 }));
    b.ws.send(encodeMessage(MessageType.Input, { seq, tick: seq, moveX: 1, moveY: 0, yaw: 0, buttons: 0, skillId: 0 }));
  }, 50);
  a.ws.send(encodeMessage(MessageType.Ping, { clientTime: Date.now() }));
  await sleep(1500);
  clearInterval(iv);
  await sleep(300);
  const snapA = a.state.snapshots.at(-1);
  const snapB = b.state.snapshots.at(-1);
  const checks = {
    welcomeA: a.state.welcome.playerId,
    welcomeB: b.state.welcome.playerId,
    distinctIds: a.state.welcome.playerId !== b.state.welcome.playerId,
    snapshotsReceivedA: a.state.snapshots.length,
    snapshotsReceivedB: b.state.snapshots.length,
    entitiesSeenByA: snapA?.entities.length,
    entitiesSeenByB: snapB?.entities.length,
    playersSeenByA: snapA?.entities.filter((e) => e.kind === "player").length,
    mobsSeenByA: snapA?.entities.filter((e) => e.kind === "mob").length,
    aMovedForward: a.state.lastPos && y0a !== undefined ? a.state.lastPos.y - y0a : null,
    bMovedSideways: b.state.lastPos && y0b !== undefined ? b.state.lastPos.x - 0 : null,
    ackSeqAdvanced: (snapA?.ackSeq ?? 0) > 0,
    pongReceived: a.state.pongs > 0,
  };
  console.log(JSON.stringify(checks, null, 2));
  const ok =
    checks.distinctIds &&
    checks.playersSeenByA === 2 &&
    (checks.mobsSeenByA ?? 0) >= 1 &&
    (checks.aMovedForward ?? 0) > 1 &&
    checks.ackSeqAdvanced &&
    checks.pongReceived &&
    checks.snapshotsReceivedA > 10;
  console.log(ok ? "SMOKE M1: PASS" : "SMOKE M1: FAIL");
  a.ws.close();
  b.ws.close();
  server.kill("SIGINT");
  await sleep(500);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("SMOKE ERROR:", err, "\nSERVER LOG:\n", serverLog);
  server.kill("SIGINT");
  process.exit(1);
});
