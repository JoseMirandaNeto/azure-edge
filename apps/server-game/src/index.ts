import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { DUNGEONS, ZONE, dungeonById, zoneById } from "@azure-edge/gamedata";
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

/**
 * One world per zone/instance. Open zones (dunas, cidade) share the default
 * cap; dungeons (tumbas, templo) cap at 8 players (dungeons.json) — the
 * 9th join is refused with "instance full".
 */
const worlds = new Map<string, ZoneWorld>();
function makeWorld(zoneId: string, maxPlayers?: number): ZoneWorld {
  const w = new ZoneWorld({ zoneId, ...(maxPlayers !== undefined ? { maxPlayers } : {}) });
  worlds.set(zoneId, w);
  return w;
}
const dunas = makeWorld(ZONE.zone.id);
dunas.spawnArenaMobs(); // Dunas de Serket: escorpião (principal) + formiga, besouro, múmia
makeWorld("cidade_serket"); // Cidade inicial lv 1-20: safe zone, sem mobs
for (const d of DUNGEONS) {
  const w = makeWorld(d.id, d.maxPlayers);
  w.spawnDungeonMobs(d.id);
}

const clients = new Map<WebSocket, { playerId: number; world: ZoneWorld; buffer: Buffer }>();

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
        worlds: [...worlds.values()].map((w) => ({
          zone: w.zoneId,
          tick: w.tick,
          players: w.players.size,
          maxPlayers: w.maxPlayers,
          mobs: w.mobs.size,
        })),
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

httpServer.listen(PORT, HOST, () => {
  log("server-game listening", { port: PORT, zone: ZONE.zone.id, tickHz: dunas.tickRate });
});

/** Pick the world for a Hello: dungeon wins, then zone, then dunas. */
function worldForHello(hello: HelloPayload): ZoneWorld | null {
  if (hello.dungeonId) {
    const d = dungeonById(hello.dungeonId);
    if (!d) return null;
    return worlds.get(d.id) ?? null;
  }
  if (hello.zoneId) {
    const z = zoneById(hello.zoneId);
    if (!z) return null;
    return worlds.get(z.zone.id) ?? null;
  }
  return dunas;
}

wss.on("connection", (ws: WebSocket) => {
  let playerId: number | null = null;
  let world: ZoneWorld | null = null;
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
        const target = worldForHello(hello);
        if (!target) {
          ws.close(1008, "unknown zone or dungeon");
          return;
        }
        if (target.isFull()) {
          ws.close(1008, `instance full: ${target.zoneId} allows at most ${target.maxPlayers} players (${target.players.size}/${target.maxPlayers})`);
          log("join refused: instance full", { zone: target.zoneId, players: target.players.size });
          return;
        }
        let player;
        try {
          // exactOptionalPropertyTypes: only pass keys that are present.
          const joinOpts: { classId?: string; armorId?: string; gender?: string } = {};
          if (hello.classId !== undefined) joinOpts.classId = hello.classId;
          if (hello.armorId !== undefined) joinOpts.armorId = hello.armorId;
          if (hello.gender !== undefined) joinOpts.gender = hello.gender;
          player = target.addPlayer(hello.name ?? "", joinOpts);
        } catch (err) {
          ws.close(1008, err instanceof Error ? err.message : "join failed");
          return;
        }
        playerId = player.id;
        world = target;
        clients.set(ws, { playerId, world: target, buffer });
        const welcome: WelcomePayload = {
          playerId: player.id,
          zoneId: target.zoneId,
          serverTick: target.tick,
          tickRate: target.tickRate,
          entities: target.snapshot(),
        };
        ws.send(encodeMessage(MessageType.Welcome, welcome));
        log("player joined", { playerId, name: player.name, zone: target.zoneId, classId: player.classId, players: target.players.size });
      } else if (type === MessageType.Input) {
        if (playerId === null || world === null) return;
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
    if (playerId !== null && world !== null) {
      world.removePlayer(playerId);
      clients.delete(ws);
      log("player left", { playerId, zone: world.zoneId, players: world.players.size });
    }
  });

  ws.on("error", (err) => log("ws error", { error: String(err) }));
});

// Fixed 20 Hz tick + snapshot broadcast, per world.
setInterval(() => {
  for (const world of worlds.values()) {
    world.step();
    // Combat rejects validated at step time (client rolls the visual back).
    for (const r of world.drainRejects()) {
      for (const [ws, info] of clients) {
        if (info.world === world && info.playerId === r.playerId && ws.readyState === ws.OPEN) {
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
      for (const [ws, info] of clients) {
        if (info.world === world && ws.readyState === ws.OPEN) ws.send(bytes);
      }
    }
    const snapshot: SnapshotPayload = {
      serverTick: world.tick,
      ackSeq: 0, // per-client ack is filled below
      entities: world.snapshot(),
    };
    for (const [ws, info] of clients) {
      if (info.world !== world || ws.readyState !== ws.OPEN) continue;
      const player = world.players.get(info.playerId);
      const perClient: SnapshotPayload = {
        ...snapshot,
        ackSeq: player?.lastSeq ?? 0,
      };
      ws.send(encodeMessage(MessageType.Snapshot, perClient));
    }
  }
  if (dunas.tick % 200 === 0) {
    log("tick metrics", {
      tick: dunas.tick,
      worlds: [...worlds.values()].map((w) => `${w.zoneId}:${w.players.size}p/${w.mobs.size}m`).join(" "),
      tickMsLast: dunas.tickMsLast.toFixed(3),
      tickMsAvg: dunas.tickMsAvg.toFixed(3),
      tickMsMax: dunas.tickMsMax.toFixed(3),
    });
  }
}, TICK_DT_S * 1000);

process.on("SIGINT", () => {
  log("shutting down");
  wss.close(() => process.exit(0));
});
