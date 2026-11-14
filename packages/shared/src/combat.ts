/**
 * Pure combat rules (COMBAT_SPEC.md). No I/O, no Math.random / Date.now —
 * variance and crits come from a seeded RNG passed in by the caller.
 * The server runs this; the client only mirrors it for visuals.
 *
 * Units: logical frame = 1/60 s. Frame counts here are the spec's.
 * Shapes mirror the gamedata JSON (structural typing, no import cycle).
 */

export type CombatState =
  | "idle"
  | "move"
  | "attack"
  | "skill"
  | "dodge"
  | "guard"
  | "stagger"
  | "knockdown"
  | "dead";

/** Snapshot animState values (wire). */
export const AnimState = {
  idle: 0,
  move: 1,
  attack: 2,
  dodge: 3,
  guard: 4,
  skill: 5,
  stagger: 6,
  knockdown: 7,
  dead: 8,
} as const;

export interface ChainHitData {
  startup: number;
  active: number;
  recovery: number;
  cancelFrom: number;
  cancelTo: number;
  mult: number;
  poise: number;
  advanceM: number;
  finisher?: boolean;
}

export interface HitShapeData {
  type: "arc" | "cone" | "self";
  radius?: number;
  angle?: number;
}

/** Combatant state kept by the server per entity (players and mobs). */
export interface Combatant {
  state: CombatState;
  /** Frames spent in the current state. */
  stateFrame: number;
  /** Index into the basic chain (0-based) while attacking. */
  chainIndex: number;
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  mana: number;
  maxMana: number;
  poise: number;
  poiseMax: number;
  /** Frame until which poise cannot break again (4 s immunity after stagger). */
  poiseImmuneUntilFrame: number;
  /** Frame the current guard started (null when not guarding). */
  guardSinceFrame: number | null;
  /** Skill id -> first frame it may be used again (cooldown). */
  skillReadyFrame: Record<string, number>;
  /** Consecutive hits landed on this combatant (combo decay). */
  comboHits: number;
  /** Frame of the last hit taken (combo reset). */
  lastHitFrame: number;
  /** Temporary HP (Provocação): absorbs damage before real HP. */
  tempHp: number;
  /** Frame until which the Bênção Solar damage reduction applies. */
  buffUntilFrame: number;
  /** Damage reduction while the buff is active (0 = none). */
  buffDamageReduction: number;
}

export function createCombatant(maxHp: number, stamina: number, mana: number, poise: number): Combatant {
  return {
    state: "idle",
    stateFrame: 0,
    chainIndex: 0,
    hp: maxHp,
    maxHp,
    stamina,
    maxStamina: stamina,
    mana,
    maxMana: mana,
    poise,
    poiseMax: poise,
    poiseImmuneUntilFrame: -1,
    guardSinceFrame: null,
    skillReadyFrame: {},
    comboHits: 0,
    lastHitFrame: -1000,
    tempHp: 0,
    buffUntilFrame: -1,
    buffDamageReduction: 0,
  };
}

// --- Spec constants (COMBAT_SPEC.md) ---
export const DODGE_STARTUP_FRAMES = 2;
export const DODGE_IFRAME_FIRST = 3;
export const DODGE_IFRAME_LAST = 14;
export const DODGE_PERFECT_LAST = 8;
export const DODGE_RECOVERY_FRAMES = 8;
export const DODGE_COST = 20;
export const DODGE_CANCEL_EXTRA_COST = 5;
export const DODGE_DISTANCE_M = 4;
export const GUARD_DAMAGE_REDUCTION = 0.7;
export const PARRY_WINDOW_FRAMES = 8;
export const GUARD_DRAIN_PER_S = 8;
export const STAMINA_REGEN_PER_S = 20;
export const MANA_REGEN_PER_S = 5;
export const PERFECT_DODGE_MANA = 15;
export const STAGGER_FRAMES = 72; // 1.2 s
export const KNOCKDOWN_FRAMES = 60; // 1.0 s
export const POISE_IMMUNITY_FRAMES = 240; // 4 s
export const INPUT_BUFFER_FRAMES = 9; // 150 ms
export const BASE_CRIT_CHANCE = 0.05;
export const CRIT_DAMAGE_MULT = 1.5;
export const COMBO_DECAY_AFTER_HITS = 5;
export const COMBO_DECAY_MULT = 0.8;

/** Total frames of one chain hit (startup + active + recovery). */
export function chainTotalFrames(hit: ChainHitData): number {
  return hit.startup + hit.active + hit.recovery;
}

/** [first, last) active frames of a chain hit, relative to attack start. */
export function chainActiveRange(hit: ChainHitData): [number, number] {
  return [hit.startup, hit.startup + hit.active];
}

export function isInCancelWindow(hit: ChainHitData, frame: number): boolean {
  if (hit.cancelTo <= hit.cancelFrom) return false;
  return frame >= hit.cancelFrom && frame <= hit.cancelTo;
}

export function dodgeTotalFrames(): number {
  return DODGE_STARTUP_FRAMES + (DODGE_IFRAME_LAST - DODGE_IFRAME_FIRST + 1) + DODGE_RECOVERY_FRAMES;
}

/** Is a dodging combatant invulnerable at this frame of the dodge? */
export function dodgeIsIframes(frame: number): boolean {
  return frame >= DODGE_IFRAME_FIRST && frame <= DODGE_IFRAME_LAST;
}

/** Would a hit landing now be a "perfect dodge" (f3–f8)? */
export function dodgeIsPerfectWindow(frame: number): boolean {
  return frame >= DODGE_IFRAME_FIRST && frame <= DODGE_PERFECT_LAST;
}

/** Hit-stop in frames: 3–5 on a normal hit, 6–9 on crit/finisher (spec). */
export function hitStopFrames(crit: boolean, finisher: boolean): number {
  return crit || finisher ? 7 : 4;
}

/** Damage formula (COMBAT_SPEC.md). Variance comes from a seeded RNG. */
export function damageAmount(
  atq: number,
  mult: number,
  def: number,
  crit: boolean,
  variance: number,
  stateBonus: number,
): number {
  const raw = atq * mult * (100 / (100 + def)) * (crit ? CRIT_DAMAGE_MULT : 1) * variance * stateBonus;
  return Math.max(1, Math.round(raw));
}

/** State bonus: x1.25 on stagger, x1.5 on knockdown, x0.8 after 5 combo hits. */
export function comboStateBonus(targetState: CombatState, comboHits: number): number {
  if (targetState === "stagger") return 1.25;
  if (targetState === "knockdown") return 1.5;
  if (comboHits >= COMBO_DECAY_AFTER_HITS) return COMBO_DECAY_MULT;
  return 1;
}

export function rollCrit(rng: () => number, chance = BASE_CRIT_CHANCE): boolean {
  return rng() < chance;
}

/** Damage variance 0.95–1.05 from a seeded RNG. */
export function rollVariance(rng: () => number): number {
  return 0.95 + rng() * 0.1;
}

/**
 * Is the target inside an arc/cone hit? Attacker faces (sin yaw, cos yaw)
 * in world XZ (see sim.ts). `angleDeg` is the full cone angle.
 */
export function arcContains(
  ax: number,
  ay: number,
  yaw: number,
  tx: number,
  ty: number,
  shape: HitShapeData,
): boolean {
  if (shape.type === "self") return true;
  const radius = shape.radius ?? 0;
  const dx = tx - ax;
  const dy = ty - ay;
  const dist = Math.hypot(dx, dy);
  if (dist > radius) return false;
  if (dist < 1e-6) return true;
  const fx = Math.sin(yaw);
  const fy = Math.cos(yaw);
  const cos = (dx * fx + dy * fy) / dist;
  const halfAngle = ((shape.angle ?? 360) / 2) * (Math.PI / 180);
  return cos >= Math.cos(halfAngle);
}

/** Is the attacker in front of the target (for guard: damage only if frontal)? */
export function isInFront(tx: number, ty: number, tYaw: number, ax: number, ay: number): boolean {
  const dx = ax - tx;
  const dy = ay - ty;
  if (Math.hypot(dx, dy) < 1e-6) return true;
  const fx = Math.sin(tYaw);
  const fy = Math.cos(tYaw);
  return (dx * fx + dy * fy) / Math.hypot(dx, dy) > 0;
}

/**
 * Apply poise damage. Returns "stagger" when poise breaks (and resets poise
 * with 4 s immunity), "none" otherwise. Immune targets and super-armor
 * never stagger from poise.
 */
export function applyPoise(
  target: Combatant,
  poiseDmg: number,
  frame: number,
  superArmor = false,
): "stagger" | "none" {
  if (superArmor || frame < target.poiseImmuneUntilFrame || target.state === "dead") return "none";
  target.poise -= poiseDmg;
  if (target.poise > 0) return "none";
  target.poise = target.poiseMax;
  target.poiseImmuneUntilFrame = frame + POISE_IMMUNITY_FRAMES;
  return "stagger";
}

/** Can this combatant start an attack now (idle/move, or inside a cancel window)? */
export function canAttack(c: Combatant, chain: ChainHitData[]): boolean {
  if (c.state === "idle" || c.state === "move") return true;
  if (c.state === "attack") {
    const hit = chain[c.chainIndex];
    return hit !== undefined && isInCancelWindow(hit, c.stateFrame);
  }
  return false;
}

export function canDodge(c: Combatant): boolean {
  if (c.state === "idle" || c.state === "move" || c.state === "guard") return true;
  if (c.state === "attack") return true; // cancels recovery (+5 stamina, checked by caller)
  return false;
}

export function canGuard(c: Combatant): boolean {
  return c.state === "idle" || c.state === "move" || c.state === "guard";
}

export function canSkill(c: Combatant, skillId: string, costMana: number, frame: number): boolean {
  if (c.state !== "idle" && c.state !== "move") return false;
  if (c.mana < costMana) return false;
  return frame >= (c.skillReadyFrame[skillId] ?? 0);
}

/** Combat events the server replicates so clients sync VFX/SFX/damage numbers. */
export interface CombatEvent {
  kind: "hit" | "kill" | "parry" | "perfect" | "skill" | "heal";
  sourceId: number;
  targetId: number;
  amount: number;
  crit: boolean;
  finisher?: boolean;
  x: number;
  y: number;
}
