import { describe, expect, it } from "vitest";
import {
  RECONCILE_GLIDE_TAU_S,
  decayCorrection,
  interpolateRemote,
  lerpAngle,
  reconcilePrediction,
  type RemoteSample,
  type UnackedInput,
} from "../src/reconcile.js";

function input(seq: number, moveX = 0, moveY = 1, yaw = 0): UnackedInput {
  return { seq, input: { seq, tick: seq, moveX, moveY, yaw, buttons: 0, skillId: 0 } };
}

describe("reconcilePrediction", () => {
  it("re-applies only inputs the server has not acked yet", () => {
    // Predicted ahead by 2 ticks (0.1 s at 6 m/s = 0.6 m of movement).
    const predicted = { x: 0, y: 0.6, yaw: 0, moving: true };
    const authoritative = { x: 0, y: 0, yaw: 0, moving: true };
    const unacked = [input(1), input(2)];
    // Server acked seq 1 only: seq 2 (one tick = 0.3 m) is re-applied.
    const r = reconcilePrediction(predicted, authoritative, unacked, 1, 6);
    expect(r.teleport).toBe(false);
    expect(r.corrected.y).toBeCloseTo(0.3, 9);
    expect(r.stillPending.map((u) => u.seq)).toEqual([2]);
    // Error is 0.3 m, under the teleport threshold.
    expect(Math.hypot(r.deltaX, r.deltaY)).toBeCloseTo(0.3, 9);
  });
  it("drops acked inputs and returns zero delta when prediction was exact", () => {
    // Server already applied seq 1 (0.3 m), so the authoritative state
    // matches the prediction and there is nothing left to re-apply.
    const predicted = { x: 0, y: 0.3, yaw: 0, moving: true };
    const authoritative = { x: 0, y: 0.3, yaw: 0, moving: true };
    const r = reconcilePrediction(predicted, authoritative, [input(1)], 1, 6);
    expect(r.teleport).toBe(false);
    expect(r.corrected.y).toBeCloseTo(0.3, 9);
    expect(r.deltaX).toBeCloseTo(0, 9);
    expect(r.deltaY).toBeCloseTo(0, 9);
    expect(r.stillPending).toHaveLength(0);
  });
  it("teleports only when the error is bigger than 2 m", () => {
    const predicted = { x: 0, y: 0, yaw: 0, moving: false };
    const authoritative = { x: 0, y: 2.01, yaw: 0, moving: true };
    const r = reconcilePrediction(predicted, authoritative, [], 0, 6);
    expect(r.teleport).toBe(true);
    const justUnder = reconcilePrediction(
      predicted,
      { x: 0, y: 1.99, yaw: 0, moving: true },
      [],
      0,
      6,
    );
    expect(justUnder.teleport).toBe(false);
  });
  it("does not mutate its arguments", () => {
    const predicted = { x: 1, y: 2, yaw: 0, moving: true };
    const authoritative = { x: 1, y: 2, yaw: 0, moving: true };
    const unacked = [input(5, 1, 0)];
    reconcilePrediction(predicted, authoritative, unacked, 0, 6);
    expect(predicted).toEqual({ x: 1, y: 2, yaw: 0, moving: true });
    expect(unacked).toHaveLength(1);
  });
});

describe("decayCorrection", () => {
  it("decays exponentially with the given time constant", () => {
    expect(decayCorrection(1, RECONCILE_GLIDE_TAU_S)).toBeCloseTo(Math.exp(-1), 9);
    expect(decayCorrection(1, RECONCILE_GLIDE_TAU_S * 3)).toBeCloseTo(Math.exp(-3), 9);
    expect(decayCorrection(2, 0)).toBe(2);
    expect(Math.abs(decayCorrection(1, 1))).toBeLessThan(0.001);
  });
});

describe("lerpAngle", () => {
  it("takes the short way around the wrap", () => {
    // From 170° to -170° the short way is +20° through 180°, not -340°.
    const a = (170 * Math.PI) / 180;
    const b = (-170 * Math.PI) / 180;
    const mid = lerpAngle(a, b, 0.5);
    expect(Math.abs(mid)).toBeCloseTo(Math.PI, 9);
    expect(lerpAngle(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4, 9);
  });
});

describe("interpolateRemote", () => {
  const samples: RemoteSample[] = [
    { tMs: 0, x: 0, y: 0, yaw: 0, animState: 1 },
    { tMs: 50, x: 0, y: 0.3, yaw: 0, animState: 1 },
    { tMs: 100, x: 0, y: 0.6, yaw: 0, animState: 0 },
  ];
  it("returns null with no samples, the sample itself with one", () => {
    expect(interpolateRemote([], 50)).toBeNull();
    expect(interpolateRemote([samples[0] as RemoteSample], 50)).toEqual(samples[0]);
  });
  it("interpolates linearly between the bracketing samples", () => {
    const mid = interpolateRemote(samples, 25);
    expect(mid?.y).toBeCloseTo(0.15, 9);
    expect(mid?.animState).toBe(1);
    const end = interpolateRemote(samples, 75);
    expect(end?.y).toBeCloseTo(0.45, 9);
    expect(end?.animState).toBe(0);
  });
  it("clamps instead of extrapolating outside the recorded range", () => {
    expect(interpolateRemote(samples, -100)?.y).toBe(0);
    expect(interpolateRemote(samples, 9999)?.y).toBe(0.6);
  });
});
