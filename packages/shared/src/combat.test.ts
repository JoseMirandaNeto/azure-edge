import { describe, expect, it } from "vitest";
import {
  BASE_CRIT_CHANCE,
  applyPoise,
  arcContains,
  canAttack,
  canDodge,
  canSkill,
  chainActiveRange,
  chainTotalFrames,
  comboStateBonus,
  createCombatant,
  damageAmount,
  dodgeIsIframes,
  dodgeIsPerfectWindow,
  hitStopFrames,
  isInCancelWindow,
  isInFront,
  rollCrit,
  rollVariance,
} from "../src/combat.js";
import { sfc32 } from "../src/rng.js";

const CHAIN = [
  { startup: 7, active: 4, recovery: 12, cancelFrom: 10, cancelTo: 22, mult: 0.9, poise: 8, advanceM: 0.6 },
  { startup: 6, active: 4, recovery: 12, cancelFrom: 9, cancelTo: 22, mult: 1.0, poise: 8, advanceM: 0.6 },
  { startup: 9, active: 5, recovery: 16, cancelFrom: 13, cancelTo: 26, mult: 1.3, poise: 14, advanceM: 1.0 },
  { startup: 14, active: 6, recovery: 28, cancelFrom: 0, cancelTo: 0, mult: 2.0, poise: 30, advanceM: 1.4, finisher: true },
];

describe("combat (pure rules)", () => {
  it("chain frame windows match the spec table", () => {
    expect(chainTotalFrames(CHAIN[0])).toBe(23);
    expect(chainTotalFrames(CHAIN[3])).toBe(48);
    expect(chainActiveRange(CHAIN[0])).toEqual([7, 11]);
    expect(chainActiveRange(CHAIN[3])).toEqual([14, 20]);
    expect(isInCancelWindow(CHAIN[0], 10)).toBe(true);
    expect(isInCancelWindow(CHAIN[0], 9)).toBe(false);
    expect(isInCancelWindow(CHAIN[0], 23)).toBe(false);
    expect(isInCancelWindow(CHAIN[3], 20)).toBe(false); // finisher has no cancel
  });

  it("damage formula: mult, defence, crit, variance and state bonus", () => {
    expect(damageAmount(10, 0.9, 0, false, 1, 1)).toBe(9);
    expect(damageAmount(10, 2.0, 0, false, 1, 1)).toBe(20);
    expect(damageAmount(10, 1.0, 100, false, 1, 1)).toBe(5); // 100/(100+100) = 0.5
    expect(damageAmount(10, 1.0, 0, true, 1, 1)).toBe(15); // crit x1.5
    expect(damageAmount(10, 1.0, 0, false, 1, 1.25)).toBe(13); // stagger bonus (12.5 rounds)
    expect(damageAmount(10, 1.0, 0, false, 1, 1)).toBeGreaterThanOrEqual(1);
  });

  it("combo state bonus: stagger 1.25, knockdown 1.5, decay 0.8 after 5 hits", () => {
    expect(comboStateBonus("stagger", 0)).toBe(1.25);
    expect(comboStateBonus("knockdown", 0)).toBe(1.5);
    expect(comboStateBonus("idle", 5)).toBe(0.8);
    expect(comboStateBonus("idle", 4)).toBe(1);
  });

  it("crit and variance come from the seeded RNG (deterministic)", () => {
    const rng = sfc32(42);
    const rolls = Array.from({ length: 1000 }, () => rollCrit(rng, BASE_CRIT_CHANCE));
    expect(rolls.filter(Boolean).length).toBeGreaterThan(20);
    expect(rolls.filter(Boolean).length).toBeLessThan(90);
    const draw10 = (seed: number): number[] => {
      const rng = sfc32(seed);
      return Array.from({ length: 10 }, () => rollVariance(rng));
    };
    const seqA = draw10(42);
    expect(seqA).toEqual(draw10(42)); // same seed => same sequence
    expect(new Set(seqA).size).toBeGreaterThan(1); // and it actually varies
    const v = rollVariance(sfc32(1));
    expect(v).toBeGreaterThanOrEqual(0.95);
    expect(v).toBeLessThanOrEqual(1.05);
  });

  it("arc hit: range and cone angle", () => {
    // Attacker at origin facing +y (yaw 0 -> forward (0, 1)).
    const shape = { type: "arc" as const, radius: 2.5, angle: 140 };
    expect(arcContains(0, 0, 0, 0, 2, shape)).toBe(true); // dead ahead
    expect(arcContains(0, 0, 0, 0, 3, shape)).toBe(false); // out of range
    expect(arcContains(0, 0, 0, 0, -2, shape)).toBe(false); // behind
    expect(arcContains(0, 0, 0, 2, 0.5, shape)).toBe(false); // ~76 deg off-axis > 70
    expect(arcContains(0, 0, 0, 1, 1.5, shape)).toBe(true); // ~34 deg off-axis
  });

  it("guard is frontal only", () => {
    expect(isInFront(0, 0, 0, 0, 2)).toBe(true); // attacker ahead of facing
    expect(isInFront(0, 0, 0, 0, -2)).toBe(false); // attacker behind
    expect(isInFront(0, 0, Math.PI, 0, -2)).toBe(true); // facing flipped
  });

  it("dodge i-frames f3–f14, perfect window f3–f8", () => {
    expect(dodgeIsIframes(2)).toBe(false);
    expect(dodgeIsIframes(3)).toBe(true);
    expect(dodgeIsIframes(14)).toBe(true);
    expect(dodgeIsIframes(15)).toBe(false);
    expect(dodgeIsPerfectWindow(8)).toBe(true);
    expect(dodgeIsPerfectWindow(9)).toBe(false);
  });

  it("hit-stop: 4 frames normal, 7 frames crit/finisher", () => {
    expect(hitStopFrames(false, false)).toBe(4);
    expect(hitStopFrames(true, false)).toBe(7);
    expect(hitStopFrames(false, true)).toBe(7);
  });

  it("poise breaks into stagger with 4 s immunity, then resets", () => {
    const c = createCombatant(100, 100, 100, 30);
    expect(applyPoise(c, 20, 0)).toBe("none");
    expect(c.poise).toBe(10);
    expect(applyPoise(c, 10, 1)).toBe("stagger");
    expect(c.poise).toBe(30); // reset to max
    expect(applyPoise(c, 100, 2)).toBe("none"); // immune
    expect(applyPoise(c, 100, 241)).toBe("stagger"); // immunity expired (240 frames)
    expect(applyPoise(c, 100, 242, true)).toBe("none"); // super-armor never staggers
  });

  it("attack/dodge/skill gating by state and resources", () => {
    const c = createCombatant(100, 100, 100, 30);
    expect(canAttack(c, CHAIN)).toBe(true);
    expect(canDodge(c)).toBe(true);
    expect(canSkill(c, "s1", 18, 0)).toBe(true);
    c.mana = 10;
    expect(canSkill(c, "s1", 18, 0)).toBe(false);
    c.mana = 100;
    c.state = "stagger";
    expect(canAttack(c, CHAIN)).toBe(false);
    expect(canDodge(c)).toBe(false);
    expect(canSkill(c, "s1", 18, 0)).toBe(false);
    c.state = "attack";
    c.chainIndex = 0;
    c.stateFrame = 12;
    expect(canAttack(c, CHAIN)).toBe(true); // inside cancel window
    c.stateFrame = 5;
    expect(canAttack(c, CHAIN)).toBe(false); // too early
  });
});
