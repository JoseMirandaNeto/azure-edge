import { describe, expect, it } from "vitest";
import { ZoneWorld } from "../src/world.js";

function forwardInput(seq: number) {
  return { seq, tick: seq, moveX: 0, moveY: 1, yaw: 0, buttons: 0, skillId: 0 };
}

describe("ZoneWorld (authoritative)", () => {
  it("two players spawn and see each other in the snapshot", () => {
    const w = new ZoneWorld();
    const a = w.addPlayer("A");
    const b = w.addPlayer("B");
    const snap = w.snapshot();
    expect(snap).toHaveLength(2);
    expect(snap.map((e) => e.id)).toContain(a.id);
    expect(snap.map((e) => e.id)).toContain(b.id);
    expect(a.x).not.toBe(b.x);
  });

  it("applies inputs on tick and moves at walk speed", () => {
    const w = new ZoneWorld();
    const p = w.addPlayer("A");
    const y0 = p.y;
    w.applyInput(p.id, forwardInput(1));
    w.step();
    expect(p.y).toBeCloseTo(y0 + 6 * 0.05, 9);
    expect(p.moving).toBe(true);
  });

  it("rejects a huge direction vector by clamping, never teleporting", () => {
    const w = new ZoneWorld();
    const p = w.addPlayer("A");
    const y0 = p.y;
    w.applyInput(p.id, { seq: 1, tick: 1, moveX: 0, moveY: 100, yaw: 0, buttons: 0, skillId: 0 });
    w.step();
    expect(p.y - y0).toBeLessThanOrEqual(6 * 0.05 * 1.05 + 0.01 + 1e-9);
  });

  it("ignores stale / duplicate seq", () => {
    const w = new ZoneWorld();
    const p = w.addPlayer("A");
    expect(w.applyInput(p.id, forwardInput(5)).ok).toBe(true);
    expect(w.applyInput(p.id, forwardInput(5)).ok).toBe(false);
    expect(w.applyInput(p.id, forwardInput(3)).ok).toBe(false);
  });

  it("removes players on leave", () => {
    const w = new ZoneWorld();
    const p = w.addPlayer("A");
    w.removePlayer(p.id);
    expect(w.snapshot()).toHaveLength(0);
  });

  it("tick stays far under the 10 ms p99 budget for 200 entities", () => {
    const w = new ZoneWorld();
    for (let i = 0; i < 200; i += 1) {
      const p = w.addPlayer(`bot${i}`);
      w.applyInput(p.id, forwardInput(1));
    }
    for (let i = 0; i < 20; i += 1) w.step();
    expect(w.tickMsMax).toBeLessThan(10);
  });
});
