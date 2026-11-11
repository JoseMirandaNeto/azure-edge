import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { ZONE } from "@azure-edge/gamedata";
import {
  decodeMessages,
  encodeMessage,
  MessageType,
  PROTOCOL_VERSION,
  TICK_DT_S,
  type EventPayload,
  type HelloPayload,
  type InputPayload,
  type PingPayload,
  type SnapshotPayload,
  type WelcomePayload,
} from "@azure-edge/shared";
import { ZoneWorld } from "./world.js";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";

const world = new ZoneWorld();
const clients = new Map<WebSocket, { playerId: number; buffer: Buffer }>();

function log(msg: string, fields: Record<string, unknown> = {}): void {
  // Structured-ish single-line log (pino is an M4 observability upgrade).
  console.log(JSON.stringify({ ts: new Date().toISOString(), msg, ...fields }));
}

// Minimal HTTP surface so free hosts (e.g. Render) can health-check the
// service and keep-alive pings have something to hit: GET /healthz -> 200.
// WebSocket upgrades are handled by `ws` on the same server/port.
const httpServer = createServer((req, res) => {
  if (req.url === "/healthz" || req.url === "/") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "azure-edge-server-game",
        zone: ZONE.zone.id,
        tick: world.tick,
        players: world.players.size,
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

httpServer.listen(PORT, HOST, () => {
  log("server-game listening", { port: PORT, zone: ZONE.zone.id, tickHz: world.tickRate });
});

wss.on("connection", (ws: WebSocket) => {
  let playerId: number | null = null;
  let buffer = Buffer.alloc(0);

  ws.on("message", (data: Buffer) => {
    buffer = Buffer.concat([buffer, Buffer.from(data)]);
    const { messages, rest } = decodeMessages(buffer);
    buffer = Buffer.from(rest);
    for (const { type, payload } of messages) {
      if (type === MessageType.Hello) {
        const hello = payload as HelloPayload;
        if (hello.protocolVersion !== PROTOCOL_VERSION) {
          ws.close(1008, `protocol mismatch: want ${PROTOCOL_VERSION}`);
          return;
        }
        const player = world.addPlayer(hello.name ?? "");
        playerId = player.id;
        clients.set(ws, { playerId, buffer });
        const welcome: WelcomePayload = {
          playerId: player.id,
          zoneId: ZONE.zone.id,
          serverTick: world.tick,
          tickRate: world.tickRate,
          entities: world.snapshot(),
        };
        ws.send(encodeMessage(MessageType.Welcome, welcome));
        log("player joined", { playerId, name: player.name, players: world.players.size });
      } else if (type === MessageType.Input) {
        if (playerId === null) return;
        const input = payload as InputPayload;
        const res = world.applyInput(playerId, input);
        if (!res.ok && res.reason !== "stale seq") {
          ws.send(encodeMessage(MessageType.Reject, { seq: input.seq, reason: res.reason ?? "invalid" }));
        }
      } else if (type === MessageType.Ping) {
        const ping = payload as PingPayload;
        ws.send(encodeMessage(MessageType.Pong, { clientTime: ping.clientTime, serverTime: Date.now() }));
      }
    }
  });

  ws.on("close", () => {
    if (playerId !== null) {
      world.removePlayer(playerId);
      clients.delete(ws);
      log("player left", { playerId, players: world.players.size });
    }
  });

  ws.on("error", (err) => log("ws error", { error: String(err) }));
});

// Fixed 20 Hz tick + snapshot broadcast.
setInterval(() => {
  world.step();
  // Combat rejects validated at step time (client rolls the visual back).
  for (const r of world.drainRejects()) {
    for (const [ws, info] of clients) {
      if (info.playerId === r.playerId && ws.readyState === ws.OPEN) {
        ws.send(encodeMessage(MessageType.Reject, { seq: r.seq, reason: r.reason }));
      }
    }
  }
  // Combat events (hit / kill / parry / perfect / skill / heal) for VFX/SFX.
  const events = world.drainEvents();
  for (const e of events) {
    const payload: EventPayload = {
      eventId: e.eventId,
      type: e.kind,
      sourceId: e.sourceId,
      targetId: e.targetId,
      amount: e.amount,
      crit: e.crit,
      x: e.x,
      y: e.y,
      ...(e.finisher !== undefined ? { finisher: e.finisher } : {}),
    };
    const bytes = encodeMessage(MessageType.Event, payload);
    for (const [ws] of clients) {
      if (ws.readyState === ws.OPEN) ws.send(bytes);
    }
  }
  const snapshot: SnapshotPayload = {
    serverTick: world.tick,
    ackSeq: 0, // per-client ack is filled below
    entities: world.snapshot(),
  };
  for (const [ws, info] of clients) {
    if (ws.readyState !== ws.OPEN) continue;
    const player = world.players.get(info.playerId);
    const perClient: SnapshotPayload = {
      ...snapshot,
      ackSeq: player?.lastSeq ?? 0,
    };
    ws.send(encodeMessage(MessageType.Snapshot, perClient));
  }
  if (world.tick % 200 === 0) {
    log("tick metrics", {
      tick: world.tick,
      players: world.players.size,
      tickMsLast: world.tickMsLast.toFixed(3),
      tickMsAvg: world.tickMsAvg.toFixed(3),
      tickMsMax: world.tickMsMax.toFixed(3),
    });
  }
}, TICK_DT_S * 1000);

process.on("SIGINT", () => {
  log("shutting down");
  wss.close(() => process.exit(0));
});
