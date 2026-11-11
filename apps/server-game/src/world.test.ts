import { describe, expect, it } from "vitest";
import { ZoneWorld } from "../src/world.js";

function forwardInput(seq: number) {
  return { seq, tick: seq, moveX: 0, moveY: 1, yaw: 0, buttons: 0, skillId: 0 };
}

function input(seq: number, buttons: number, skillId = 0, yaw = 0) {
  return { seq, tick: seq, moveX: 0, moveY: 0, yaw, buttons, skillId };
}

/** Place A facing B at 2 m (inside the 2.5 m attack arc). */
function duel(w: ZoneWorld) {
  const a = w.addPlayer("A");
  const b = w.addPlayer("B");
  a.x = 0;
  a.y = 0;
  a.yaw = 0; // facing +y
  b.x = 0;
  b.y = 2;
  b.yaw = Math.PI; // facing A
  return { a, b };
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
    expect(snap[0].kind).toBe("player");
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

  it("basic attack hits a target in front and emits a hit event", () => {
    const w = new ZoneWorld();
    const { a, b } = duel(w);
    w.applyInput(a.id, input(1, 1)); // attack
    for (let i = 0; i < 6; i += 1) w.step();
    expect(b.combat.hp).toBeLessThan(100);
    expect(b.combat.hp).toBeGreaterThan(80); // one hit, ~9 dmg
    const events = w.drainEvents();
    expect(events.some((e) => e.kind === "hit" && e.targetId === b.id)).toBe(true);
    expect(w.snapshot().find((e) => e.id === b.id)?.hpPct).toBeLessThan(100);
  });

  it("attack misses a target behind the attacker", () => {
    const w = new ZoneWorld();
    const { a, b } = duel(w);
    b.x = 0;
    b.y = -2; // behind A
    w.applyInput(a.id, input(1, 1));
    for (let i = 0; i < 6; i += 1) w.step();
    expect(b.combat.hp).toBe(100);
    expect(w.drainEvents().some((e) => e.kind === "hit")).toBe(false);
  });

  it("chains into the second hit when pressed inside the cancel window", () => {
    const w = new ZoneWorld();
    const { a, b } = duel(w);
    w.applyInput(a.id, input(1, 1));
    w.step();
    w.step();
    w.applyInput(a.id, input(2, 1)); // early press -> buffered, chains at f10
    for (let i = 0; i < 18; i += 1) w.step();
    const hits = w.drainEvents().filter((e) => e.kind === "hit" && e.targetId === b.id);
    expect(hits).toHaveLength(2);
    expect(b.combat.hp).toBeLessThan(85); // ~9 + ~10 dmg
  });

  it("dodge i-frames avoid damage, perfect window grants mana + event", () => {
    const w = new ZoneWorld();
    const { a, b } = duel(w);
    b.combat.state = "dodge";
    b.combat.stateFrame = 0;
    b.dodgeDirX = 0;
    b.dodgeDirY = -1; // dodge toward A, stays in range
    b.combat.mana = 50;
    w.applyInput(a.id, input(1, 1));
    for (let i = 0; i < 6; i += 1) w.step();
    expect(b.combat.hp).toBe(100);
    const events = w.drainEvents();
    expect(events.some((e) => e.kind === "perfect" && e.targetId === b.id)).toBe(true);
    expect(b.combat.mana).toBeGreaterThan(50);
  });

  it("dodge after the perfect window still avoids damage, without the bonus", () => {
    const w = new ZoneWorld();
    const { a, b } = duel(w);
    b.combat.state = "dodge";
    b.combat.stateFrame = 7; // i-frames (f3–f14) but past the perfect window (f3–f8)
    b.dodgeDirX = 0;
    b.dodgeDirY = -1;
    w.applyInput(a.id, input(1, 1));
    for (let i = 0; i < 6; i += 1) w.step();
    expect(b.combat.hp).toBe(100);
    expect(w.drainEvents().some((e) => e.kind === "perfect")).toBe(false);
  });

  it("guard reduces frontal damage by 70% (no parry after 8 frames)", () => {
    const w = new ZoneWorld();
    const { a, b } = duel(w);
    // B holds guard for 4 ticks first (12 frames > parry window).
    for (let i = 1; i <= 4; i += 1) {
      w.applyInput(b.id, input(i, 4));
      w.step();
    }
    expect(b.combat.state).toBe("guard");
    w.applyInput(a.id, input(1, 1));
    for (let i = 5; i <= 10; i += 1) {
      w.applyInput(b.id, input(i, 4));
      w.step();
    }
    expect(b.combat.hp).toBeGreaterThan(94); // ~9 * 0.3 = ~3 dmg
    expect(b.combat.hp).toBeLessThan(100);
  });

  it("parry in the first 8 guard frames staggers the attacker, no damage", () => {
    const w = new ZoneWorld();
    const { a, b } = duel(w);
    w.applyInput(b.id, input(1, 4)); // guard starts this tick
    w.applyInput(a.id, input(1, 1));
    for (let i = 2; i <= 7; i += 1) {
      w.applyInput(b.id, input(i, 4));
      w.step();
    }
    expect(b.combat.hp).toBe(100);
    expect(w.drainEvents().some((e) => e.kind === "parry")).toBe(true);
    expect(a.combat.state).toBe("stagger");
  });

  it("skill costs mana, hits in the arc, and rejects while on cooldown", () => {
    const w = new ZoneWorld();
    const { a, b } = duel(w);
    w.applyInput(a.id, input(1, 0, 1)); // Q = class skill
    for (let i = 0; i < 8; i += 1) w.step();
    expect(a.combat.mana).toBeLessThan(100);
    expect(b.combat.hp).toBeLessThan(85); // skill mult 2.2 -> ~22 dmg
    expect(w.drainEvents().some((e) => e.kind === "skill")).toBe(true);
    // Wait for the skill animation to end, then cast again -> cooldown reject.
    for (let i = 0; i < 12; i += 1) w.step();
    expect(a.combat.state).toBe("idle");
    w.applyInput(a.id, input(2, 0, 1));
    w.step();
    expect(w.drainRejects().some((r) => r.reason === "cooldown")).toBe(true);
  });

  it("attack while staggered is rejected with reason state", () => {
    const w = new ZoneWorld();
    const { a } = duel(w);
    a.combat.state = "stagger";
    a.combat.stateFrame = 0;
    w.applyInput(a.id, input(1, 1));
    w.step();
    expect(w.drainRejects().some((r) => r.reason === "state")).toBe(true);
    expect(a.combat.state).toBe("stagger");
  });

  it("finisher knocks the target down", () => {
    const w = new ZoneWorld();
    const { a, b } = duel(w);
    a.combat.state = "attack";
    a.combat.chainIndex = 3;
    a.combat.stateFrame = 13; // finisher active starts at f14
    for (let i = 0; i < 3; i += 1) w.step();
    expect(b.combat.hp).toBeLessThan(100);
    expect(b.combat.state).toBe("knockdown");
  });

  it("death emits kill and the player respawns after 5 s", () => {
    const w = new ZoneWorld();
    const { a, b } = duel(w);
    b.combat.hp = 5;
    w.applyInput(a.id, input(1, 1));
    for (let i = 0; i < 6; i += 1) w.step();
    expect(b.combat.state).toBe("dead");
    expect(w.drainEvents().some((e) => e.kind === "kill" && e.targetId === b.id)).toBe(true);
    for (let i = 0; i < 110; i += 1) w.step(); // 330 frames > 300
    expect(b.combat.state).toBe("idle");
    expect(b.combat.hp).toBe(b.combat.maxHp);
  });
});
