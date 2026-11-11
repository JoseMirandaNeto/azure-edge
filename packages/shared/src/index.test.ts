import { describe, expect, it } from "vitest";
import { decodeMessages, encodeMessage, MessageType } from "../src/net/messages.js";
import { hashSeed, sfc32 } from "../src/rng.js";
import { maxDisplacementM, stepMovement } from "../src/sim.js";

describe("rng (sfc32)", () => {
  it("same seed => same sequence", () => {
    const a = sfc32(42);
    const b = sfc32(42);
    expect(Array.from({ length: 100 }, () => a())).toEqual(
      Array.from({ length: 100 }, () => b()),
    );
  });
  it("values are in [0, 1)", () => {
    const rng = sfc32(7);
    for (let i = 0; i < 1000; i += 1) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it("hashSeed is stable", () => {
    expect(hashSeed("azure-edge")).toBe(hashSeed("azure-edge"));
    expect(hashSeed("a")).not.toBe(hashSeed("b"));
  });
});

describe("movement sim", () => {
  it("moves forward at walk speed, deterministic", () => {
    const s0 = { x: 0, y: 0, yaw: 0, moving: false };
    const input = { moveX: 0, moveY: 1, yaw: 0 };
    const a = stepMovement(s0, input, 0.05, 6);
    const b = stepMovement(s0, input, 0.05, 6);
    expect(a).toEqual(b);
    expect(a.y).toBeCloseTo(0.3, 9);
    expect(a.x).toBeCloseTo(0, 9);
    expect(a.moving).toBe(true);
  });
  it("zero input => no movement", () => {
    const s0 = { x: 1, y: 2, yaw: 0.5, moving: true };
    const out = stepMovement(s0, { moveX: 0, moveY: 0, yaw: 0.5 }, 0.05, 6);
    expect(out.x).toBe(1);
    expect(out.y).toBe(2);
    expect(out.moving).toBe(false);
  });
  it("diagonal is normalised (no speed exploit)", () => {
    const s0 = { x: 0, y: 0, yaw: 0, moving: false };
    const out = stepMovement(s0, { moveX: 1, moveY: 1, yaw: 0 }, 0.05, 6);
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(0.3, 9);
  });
  it("maxDisplacementM bounds one tick", () => {
    expect(maxDisplacementM(6, 0.05)).toBeCloseTo(0.325, 9);
  });
});

describe("wire framing", () => {
  it("round-trips and splits concatenated frames", () => {
    const a = encodeMessage(MessageType.Ping, { clientTime: 123 });
    const b = encodeMessage(MessageType.Hello, { protocolVersion: 0, clientBuild: "m0" });
    const joined = new Uint8Array(a.length + b.length);
    joined.set(a, 0);
    joined.set(b, a.length);
    const { messages, rest } = decodeMessages(joined);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.payload).toEqual({ clientTime: 123 });
    expect(messages[1]?.type).toBe(MessageType.Hello);
    expect(rest.length).toBe(0);
  });
  it("keeps a partial frame as rest", () => {
    const a = encodeMessage(MessageType.Ping, { clientTime: 1 });
    const { messages, rest } = decodeMessages(a.subarray(0, 4));
    expect(messages).toHaveLength(0);
    expect(rest.length).toBe(4);
  });
});
