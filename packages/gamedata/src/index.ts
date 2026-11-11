import zoneData from "../data/zone_dunas_serket.json" with { type: "json" };
import classesData from "../data/classes.json" with { type: "json" };
import skillsData from "../data/skills.json" with { type: "json" };
import mobsData from "../data/mobs.json" with { type: "json" };

export interface ZoneData {
  zone: {
    id: string;
    name: string;
    subArea?: string;
    sizeM: number;
    spawn: { x: number; y: number };
  };
  biome: "desert" | "meadow";
  palette: { sky: string; fog: string; low: string; high: string; sun: string; ground: string };
  props: Array<{ kind: "rock" | "cactus" | "palm" | "ruin" | "tree"; count: number }>;
  player: { walkSpeedMps: number; runSpeedMps: number; radiusM: number; maxHp: number };
  camera: { distanceM: number; heightM: number; pitchRad: number };
}

/** One hit of a basic-attack chain (COMBAT_SPEC.md frame table, 60 fps logic). */
export interface ChainHit {
  startup: number;
  active: number;
  recovery: number;
  /** Cancel window into the next chain hit (frames in the hit); 0/0 = no cancel. */
  cancelFrom: number;
  cancelTo: number;
  mult: number;
  poise: number;
  /** Forward lunge (m) applied across the active frames. */
  advanceM: number;
  finisher?: boolean;
}

export interface ClassBase {
  maxHp: number;
  atk: number;
  def: number;
  stamina: number;
  mana: number;
  walkSpeedMps: number;
}

export interface ClassData {
  id: string;
  name: string;
  role: string;
  weapon: string;
  base: ClassBase;
  skillId: string;
  /** 4-hit basic chain. Chains of non-playable classes are provisional (M3). */
  basicChain: ChainHit[];
  provisional?: boolean;
}

export interface HitShape {
  type: "arc" | "cone" | "self";
  radius?: number;
  angle?: number;
}

export interface SkillHit {
  mult?: number;
  poise?: number;
  effect?: "knockback" | "knockdown";
  heal?: number;
}

export interface SkillData {
  id: string;
  classId: string;
  name: string;
  /** Name is provisional — Jose will name the skills (M1). */
  nameProvisional?: boolean;
  kind: "damage" | "heal" | "taunt" | "buff";
  cooldownS: number;
  costMana: number;
  startup: number;
  active: Array<{ from: number; to: number; shape: HitShape; hit: SkillHit }>;
  recovery: number;
  cancelInto: string[];
  superArmor?: { from: number; to: number };
  /** Taunt (Provocação): mobs in radiusM redirect to the caster for durationS. */
  taunt?: { radiusM: number; durationS: number; tempHp: number };
  /** Buff (Bênção Solar): damage reduction for the caster + allies in radiusM. */
  buff?: { damageReduction: number; durationS: number; radiusM: number };
  vfx: string;
}

export interface MobData {
  id: string;
  name: string;
  nameProvisional?: boolean;
  maxHp: number;
  atk: number;
  def: number;
  poise: number;
  poiseRegenPerS: number;
  radiusM: number;
  /** Procedural placeholder tint (hex) and size scale for the client. */
  color: string;
  scale: number;
  walkSpeedMps: number;
  chaseSpeedMps: number;
  aggroRadiusM: number;
  leashRadiusM: number;
  attackRangeM: number;
  attack: {
    windup: number;
    active: number;
    recovery: number;
    shape: HitShape;
    mult: number;
    poise: number;
  };
  respawnS: number;
  xp: number;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isPos = (v: unknown): v is number => isNum(v) && v > 0;
/** Assertion helper: after check(cond) the compiler knows cond is true,
 *  so type guards inside cond narrow the values for the code that follows. */
function check(cond: boolean, what: string): asserts cond {
  if (!cond) throw new Error(`${what} failed schema validation`);
}

function checkShape(v: unknown, where: string): HitShape {
  check(isRec(v) && isStr(v.type) && ["arc", "cone", "self"].includes(v.type), where);
  check(v.type === "self" || (isPos(v.radius) && isPos(v.angle)), where);
  return v as unknown as HitShape;
}

function checkZone(v: unknown): ZoneData {
  check(isRec(v), "zone_dunas_serket.json");
  const z = v.zone as Rec | undefined;
  const p = v.player as Rec | undefined;
  const c = v.camera as Rec | undefined;
  const pal = v.palette as Rec | undefined;
  check(
    isRec(z) && isStr(z.id) && isStr(z.name) && isPos(z.sizeM) &&
    isRec(z.spawn) && isNum(z.spawn.x) && isNum(z.spawn.y) &&
    isPos(p?.walkSpeedMps) && isPos(p?.maxHp) &&
    isPos(c?.distanceM) && isNum(c?.pitchRad) &&
    v.biome === "desert" &&
    isRec(pal) && ["sky", "fog", "low", "high", "sun", "ground"].every((k) => isStr(pal[k])) &&
    Array.isArray(v.props) &&
    v.props.every((pr) => isRec(pr) && isStr(pr.kind) && isPos(pr.count)),
    "zone_dunas_serket.json",
  );
  return v as unknown as ZoneData;
}

function checkChain(v: unknown, where: string): ChainHit[] {
  check(Array.isArray(v) && v.length === 4, where);
  for (const h of v) {
    check(
      isRec(h) && isPos(h.startup) && isPos(h.active) && isPos(h.recovery) &&
      isNum(h.cancelFrom) && isNum(h.cancelTo) && isPos(h.mult) &&
      isNum(h.poise) && isNum(h.advanceM) &&
      h.cancelTo >= h.cancelFrom && h.cancelFrom >= 0,
      where,
    );
  }
  return v as unknown as ChainHit[];
}

function checkClasses(v: unknown): ClassData[] {
  check(Array.isArray(v) && v.length === 4, "classes.json");
  const ids = new Set<string>();
  for (const c of v) {
    check(
      isRec(c) && isStr(c.id) && isStr(c.name) && isStr(c.skillId) &&
      !ids.has(c.id) && isRec(c.base) &&
      isPos(c.base.maxHp) && isPos(c.base.atk) && isNum(c.base.def) &&
      isPos(c.base.stamina) && isNum(c.base.mana) && isPos(c.base.walkSpeedMps),
      "classes.json",
    );
    ids.add(c.id);
    checkChain(c.basicChain, `classes.json:${c.id}.basicChain`);
  }
  return v as unknown as ClassData[];
}

function checkSkills(v: unknown): SkillData[] {
  check(Array.isArray(v) && v.length > 0, "skills.json");
  const ids = new Set<string>();
  for (const s of v) {
    check(
      isRec(s) && isStr(s.id) && isStr(s.classId) && isStr(s.name) &&
      !ids.has(s.id) && ["damage", "heal", "taunt", "buff"].includes(s.kind as string) &&
      isPos(s.cooldownS) && isNum(s.costMana) && isPos(s.startup) &&
      isPos(s.recovery) && Array.isArray(s.active) && s.active.length > 0 &&
      Array.isArray(s.cancelInto),
      "skills.json",
    );
    ids.add(s.id);
    for (const w of s.active as Rec[]) {
      check(isRec(w) && isPos(w.from) && isPos(w.to) && (w.to as number) > (w.from as number), `skills.json:${s.id}.active`);
      checkShape(w.shape, `skills.json:${s.id}.active.shape`);
      check(isRec(w.hit), `skills.json:${s.id}.active.hit`);
    }
    // Per-kind payloads.
    if (s.kind === "damage") {
      for (const w of s.active as Rec[]) {
        check(isPos((w.hit as Rec).mult), `skills.json:${s.id}.active.hit.mult`);
      }
    } else if (s.kind === "heal") {
      check(isPos(((s.active as Rec[])[0]?.hit as Rec)?.heal), `skills.json:${s.id}.heal`);
    } else if (s.kind === "taunt") {
      const t = s.taunt as Rec | undefined;
      check(isRec(t) && isPos(t.radiusM) && isPos(t.durationS) && isPos(t.tempHp), `skills.json:${s.id}.taunt`);
    } else if (s.kind === "buff") {
      const b = s.buff as Rec | undefined;
      check(
        isRec(b) && isNum(b.damageReduction) && (b.damageReduction as number) > 0 &&
        (b.damageReduction as number) < 1 && isPos(b.durationS) && isPos(b.radiusM),
        `skills.json:${s.id}.buff`,
      );
    }
  }
  return v as unknown as SkillData[];
}

function checkMobs(v: unknown): MobData[] {
  check(Array.isArray(v) && v.length > 0, "mobs.json");
  for (const m of v) {
    check(
      isRec(m) && isStr(m.id) && isStr(m.name) && isPos(m.maxHp) &&
      isNum(m.atk) && isNum(m.def) && isPos(m.poise) &&
      isPos(m.walkSpeedMps) && isPos(m.chaseSpeedMps) &&
      isPos(m.aggroRadiusM) && isPos(m.leashRadiusM) && isPos(m.attackRangeM) &&
      isStr(m.color) && (m.color as string).startsWith("#") && isPos(m.scale) &&
      isRec(m.attack) && isPos(m.attack.windup) && isPos(m.attack.active) &&
      isPos(m.attack.recovery) && isPos(m.respawnS),
      "mobs.json",
    );
    checkShape(m.attack.shape, `mobs.json:${m.id}.attack.shape`);
    check((m.aggroRadiusM as number) > (m.attackRangeM as number), `mobs.json:${m.id}`);
  }
  return v as unknown as MobData[];
}

/** Validated, data-driven tuning. Code must read this, not hard-code numbers. */
export const ZONE: ZoneData = checkZone(zoneData);
export const CLASSES: ClassData[] = checkClasses(classesData);
export const SKILLS: SkillData[] = checkSkills(skillsData);
export const MOBS: MobData[] = checkMobs(mobsData);

// Cross-file integrity: every class points at a skill that exists.
for (const c of CLASSES) {
  if (!SKILLS.some((s) => s.id === c.skillId && s.classId === c.id)) {
    throw new Error(`classes.json: ${c.id} skill ${c.skillId} missing in skills.json`);
  }
}

export const classById = (id: string): ClassData | undefined =>
  CLASSES.find((c) => c.id === id);
export const skillById = (id: string): SkillData | undefined =>
  SKILLS.find((s) => s.id === id);
export const mobById = (id: string): MobData | undefined => MOBS.find((m) => m.id === id);
