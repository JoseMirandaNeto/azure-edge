import { ZONE } from "@azure-edge/gamedata";
import {
  maxDisplacementM,
  stepMovement,
  TICK_DT_S,
  type EntityState,
  type InputPayload,
  type SimState,
} from "@azure-edge/shared";

/**
 * Authoritative zone simulation (M0). Pure simulation, no sockets here so it
 * is unit-testable. The server is the ONLY writer of positions: clients send
 * inputs, the server steps them and returns snapshots.
 */
export interface PlayerEntity extends SimState {
  id: number;
  name: string;
  hpPct: number;
  lastSeq: number;
  /** Inputs received since the last tick, in arrival order. */
  pending: InputPayload[];
  rejected: number;
}

export class ZoneWorld {
  readonly tickRate = 20;
  tick = 0;
  readonly players = new Map<number, PlayerEntity>();
  private nextId = 1;
  /** Tick duration stats (ms) for the F3 / metrics log. */
  tickMsLast = 0;
  tickMsMax = 0;
  private tickMsSum = 0;
  private tickCount = 0;

  addPlayer(name: string): PlayerEntity {
    const id = this.nextId;
    this.nextId += 1;
    // Deterministic spawn ring around the zone spawn — no Math.random.
    const angle = (id - 1) * 2.399963; // golden angle
    const radius = 1.5 + (id - 1) * 0.5;
    const p: PlayerEntity = {
      id,
      name: name || `Player${id}`,
      x: ZONE.zone.spawn.x + Math.cos(angle) * radius,
      y: ZONE.zone.spawn.y + Math.sin(angle) * radius,
      yaw: 0,
      moving: false,
      hpPct: 100,
      lastSeq: 0,
      pending: [],
      rejected: 0,
    };
    this.players.set(id, p);
    return p;
  }

  removePlayer(id: number): void {
    this.players.delete(id);
  }

  /** Queue a client input. Invalid inputs are rejected, never trusted. */
  applyInput(id: number, input: InputPayload): { ok: boolean; reason?: string } {
    const p = this.players.get(id);
    if (!p) return { ok: false, reason: "unknown player" };
    if (!Number.isFinite(input.moveX) || !Number.isFinite(input.moveY)) {
      p.rejected += 1;
      return { ok: false, reason: "non-finite input" };
    }
    if (input.seq <= p.lastSeq) {
      // Duplicate / stale input — ignore, do not count as cheat.
      return { ok: false, reason: "stale seq" };
    }
    if (input.seq > p.lastSeq + 100) {
      p.rejected += 1;
      return { ok: false, reason: "seq jump" };
    }
    // Clamp the direction vector to unit length (client cannot send |v| > 1).
    const len = Math.hypot(input.moveX, input.moveY);
    const clamped: InputPayload = {
      ...input,
      moveX: len > 1 ? input.moveX / len : input.moveX,
      moveY: len > 1 ? input.moveY / len : input.moveY,
    };
    p.pending.push(clamped);
    if (p.pending.length > 8) p.pending.splice(0, p.pending.length - 8);
    p.lastSeq = input.seq;
    return { ok: true };
  }

  /** One fixed 20 Hz tick: apply at most one queued input per player. */
  step(): void {
    const started = performance.now();
    this.tick += 1;
    for (const p of this.players.values()) {
      const input = p.pending.shift();
      if (!input) {
        p.moving = false;
        continue;
      }
      const before = { x: p.x, y: p.y, yaw: p.yaw, moving: p.moving };
      const next = stepMovement(before, input, TICK_DT_S, ZONE.player.walkSpeedMps);
      // Server-side speed validation: never accept a displacement beyond the cap.
      const moved = Math.hypot(next.x - before.x, next.y - before.y);
      const cap = maxDisplacementM(ZONE.player.walkSpeedMps, TICK_DT_S);
      if (moved > cap) {
        p.rejected += 1;
        continue;
      }
      p.x = next.x;
      p.y = next.y;
      p.yaw = next.yaw;
      p.moving = next.moving;
      // Clamp to the zone bounds.
      const half = ZONE.zone.sizeM / 2;
      p.x = Math.max(-half, Math.min(half, p.x));
      p.y = Math.max(-half, Math.min(half, p.y));
    }
    const ms = performance.now() - started;
    this.tickMsLast = ms;
    this.tickMsMax = Math.max(this.tickMsMax, ms);
    this.tickMsSum += ms;
    this.tickCount += 1;
  }

  get tickMsAvg(): number {
    return this.tickCount === 0 ? 0 : this.tickMsSum / this.tickCount;
  }

  snapshot(): EntityState[] {
    return [...this.players.values()].map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      yaw: p.yaw,
      animState: p.moving ? 1 : 0,
      hpPct: p.hpPct,
    }));
  }
}
