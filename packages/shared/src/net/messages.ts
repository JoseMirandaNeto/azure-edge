/** Wire protocol v0 (docs/PROTOCOL.md).
 *  Frame: [u8 type][u16be length][payload]. Payload is UTF-8 JSON in M0
 *  (binary-quantised payloads are an M1+ optimisation, see ADR-003).
 *  The client NEVER sends results — only inputs. The server is authoritative.
 *  Uses Uint8Array/DataView only, so the same code runs in Node and browsers.
 */

export const MessageType = {
  Hello: 1,
  Input: 2,
  Chat: 3,
  Ping: 4,
  Welcome: 11,
  Snapshot: 12,
  Event: 13,
  Pong: 14,
  Reject: 15,
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export interface Vec2 {
  x: number;
  y: number;
}

export interface HelloPayload {
  protocolVersion: number;
  clientBuild: string;
  /** Optional display name; server assigns the playerId. */
  name?: string;
}

export interface InputPayload {
  /** Monotonic per-client sequence number. */
  seq: number;
  /** Client tick at send time. */
  tick: number;
  /** Movement direction, -1..1 per axis, camera-relative (x = strafe, y = forward). */
  moveX: number;
  moveY: number;
  /** Camera yaw in radians. */
  yaw: number;
  /** Bitmask: 1=attack (edge) 2=dodge (edge) 4=guard (held) 8=grab 16=jump 32=interact.
   *  skillId > 0 casts that skill (edge, M1: 1 = class skill). */
  buttons: number;
  skillId: number;
}

export interface EntityState {
  id: number;
  /** "player" or "mob" (M1: escorpião, formiga, besouro, múmia). */
  kind: "player" | "mob";
  /** Display name (mobs: "Escorpião do Deserto"; players: chosen name). */
  name?: string;
  /** Mob type id (mobs only) so the client can pick color/scale. */
  mobId?: string;
  x: number;
  y: number;
  /** Facing yaw, radians. */
  yaw: number;
  /**
   * Animation state: 0=idle 1=move 2=attack 3=dodge 4=guard 5=skill
   * 6=stagger 7=knockdown 8=dead 9=windup (mob telegraph, see mobAnim in world.ts).
   */
  animState: number;
  hpPct: number;
  staminaPct?: number;
  manaPct?: number;
}

/** Server → client combat event (type 13): syncs VFX/SFX/damage numbers. */
export interface EventPayload {
  eventId: number;
  type: "hit" | "kill" | "parry" | "perfect" | "skill" | "heal";
  sourceId: number;
  targetId: number;
  amount: number;
  crit: boolean;
  finisher?: boolean;
  x: number;
  y: number;
}

export interface WelcomePayload {
  playerId: number;
  zoneId: string;
  serverTick: number;
  tickRate: number;
  entities: EntityState[];
}

export interface SnapshotPayload {
  serverTick: number;
  /** Highest input seq the server has applied for this client. */
  ackSeq: number;
  entities: EntityState[];
}

export interface RejectPayload {
  seq: number;
  reason: string;
}

export interface PingPayload {
  clientTime: number;
}
export interface PongPayload {
  clientTime: number;
  serverTime: number;
}

export type AnyPayload =
  | HelloPayload
  | InputPayload
  | WelcomePayload
  | SnapshotPayload
  | EventPayload
  | RejectPayload
  | PingPayload
  | PongPayload;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Encode one framed message. Throws on oversize payload (> 65535 bytes). */
export function encodeMessage(type: number, payload: unknown): Uint8Array {
  const body = encoder.encode(JSON.stringify(payload));
  if (body.length > 0xffff) throw new Error("payload too large");
  const out = new Uint8Array(3 + body.length);
  const view = new DataView(out.buffer);
  view.setUint8(0, type);
  view.setUint16(1, body.length, false);
  out.set(body, 3);
  return out;
}

/** Decode all complete frames in a buffer; returns messages + leftover bytes. */
export function decodeMessages(
  buf: Uint8Array,
): { messages: Array<{ type: number; payload: unknown }>; rest: Uint8Array } {
  const messages: Array<{ type: number; payload: unknown }> = [];
  let offset = 0;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  while (offset + 3 <= buf.length) {
    const type = view.getUint8(offset);
    const len = view.getUint16(offset + 1, false);
    if (offset + 3 + len > buf.length) break;
    const payload = JSON.parse(
      decoder.decode(buf.subarray(offset + 3, offset + 3 + len)),
    ) as unknown;
    messages.push({ type, payload });
    offset += 3 + len;
  }
  return { messages, rest: buf.subarray(offset) };
}

/** Quantise a position to 1/64 m (PROTOCOL.md) for future binary snapshots. */
export function quantizePos(v: number): number {
  return Math.round(v * 64) / 64;
}
