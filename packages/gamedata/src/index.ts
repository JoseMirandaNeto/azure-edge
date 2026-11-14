import zoneData from "../data/zone_dunas_serket.json" with { type: "json" };
import zonesData from "../data/zones.json" with { type: "json" };
import armorsData from "../data/armors.json" with { type: "json" };
import dungeonsData from "../data/dungeons.json" with { type: "json" };
import cityData from "../data/city.json" with { type: "json" };
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
  props: Array<{ kind: "rock" | "cactus" | "palm" | "ruin" | "tree" | "building" | "portal" | "npc"; count: number }>;
  player: { walkSpeedMps: number; runSpeedMps: number; radiusM: number; maxHp: number };
  camera: { distanceM: number; heightM: number; pitchRad: number };
  /** City (lv 1-20): safe zone, no combat, NPC markers + portals. */
  safe?: boolean;
  levelMin?: number;
  levelMax?: number;
  npcs?: Array<{ name: string; role: string; x: number; y: number }>;
  portals?: Array<{ label: string; target: string; x: number; y: number }>;
}

/** One swappable armor set: visual (colors + aura) + a small documented bonus. */
export interface ArmorData {
  id: string;
  classId: string;
  name: string;
  tier: 1 | 2 | 3;
  /** Minimum level to equip (tier 1: 1, tier 2: 8, tier 3: 16). */
  minLevel?: number;
  material?: string;
  /** Set bonus text (cosmetic effect description; the mechanical part lives in bonus). */
  setBonus?: string;
  colors: { primary: string; secondary: string; accent: string };
  aura: string;
  /** Small stat bonus (tier 1: +0, tier 2: +10, tier 3: +20 maxHp, plus atk/def/mana). */
  bonus: { maxHp: number; atk?: number; def?: number; mana?: number };
}

export interface DungeonMob {
  mobId: string;
  count: number;
  level: number;
}

export interface DungeonEncounter {
  id: string;
  name: string;
  kind: "trash" | "elite" | "boss";
  /** Telegraphs / mechanics the group must respect (see docs/INSTANCIAS.md). */
  mechanics: string[];
}

export interface DungeonLoot {
  item: string;
  rarity: "Incomum" | "Raro" | "Épico" | "Lendário";
  dropChance: number;
}

export interface DungeonData {
  id: string;
  name: string;
  levelMin: number;
  levelMax: number;
  /** Hard instance cap (8 players; the 9th join is rejected). */
  maxPlayers: number;
  mobs: DungeonMob[];
  boss: { mobId: string; name: string; level: number; hpMult: number; atkMult: number };
  entrance?: { zone: string; npc?: string; questId?: string };
  encounters?: DungeonEncounter[];
  loot?: DungeonLoot[];
  /** Hours before the same character can loot the boss again (loot lockout). */
  lockoutHours?: number;
}

/** Starter city lv 1-20: lore, districts, NPCs with a function, chained quests. */
export interface CityData {
  id: string;
  name: string;
  levelMin: number;
  levelMax: number;
  lore: string;
  districts: Array<{ id: string; name: string; description: string }>;
  npcs: Array<{ id: string; name: string; role: string; function: string; district: string }>;
  quests: Array<{
    id: string;
    name: string;
    level: number;
    giver: string;
    objective: { type: "kill" | "collect" | "talk" | "enter" | "boss"; target: string; count: number };
    rewards: { xp: number; gold: number; item?: string };
    nextQuestId?: string;
  }>;
  mobBands: Array<{ minLevel: number; maxLevel: number; mobIds: string[]; area: string }>;
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

export interface ClassGrowth {
  maxHp: number;
  atk: number;
  def: number;
  stamina: number;
  mana: number;
}

export interface ClassData {
  id: string;
  name: string;
  role: string;
  weapon: string;
  base: ClassBase;
  /** Stat gain per level (lv1 base + growth * (level - 1)). */
  growthPerLevel?: ClassGrowth;
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
  kind: "damage" | "heal" | "taunt" | "buff" | "mobility";
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
  /** Designer-facing text: what the skill does and how it looks in motion. */
  description?: string;
  animation?: string;
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
    (v.biome === "desert" || v.biome === "meadow") &&
    isRec(pal) && ["sky", "fog", "low", "high", "sun", "ground"].every((k) => isStr(pal[k])) &&
    Array.isArray(v.props) &&
    v.props.every((pr) => isRec(pr) && isStr(pr.kind) && isPos(pr.count)),
    "zone_dunas_serket.json",
  );
  checkOptionalZoneExtras(v, "zone");
  return v as unknown as ZoneData;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Optional city fields (npcs/portals/safe/level range), validated when present. */
function checkOptionalZoneExtras(v: Rec, where: string): void {
  if (v.npcs !== undefined) {
    check(
      Array.isArray(v.npcs) && v.npcs.every((n) => isRec(n) && isStr(n.name) && isStr(n.role) && isNum(n.x) && isNum(n.y)),
      `${where}.npcs`,
    );
  }
  if (v.portals !== undefined) {
    check(
      Array.isArray(v.portals) && v.portals.every((p) => isRec(p) && isStr(p.label) && isStr(p.target) && isNum(p.x) && isNum(p.y)),
      `${where}.portals`,
    );
  }
  if (v.safe !== undefined) check(typeof v.safe === "boolean", `${where}.safe`);
  if (v.levelMin !== undefined) check(isPos(v.levelMin), `${where}.levelMin`);
  if (v.levelMax !== undefined) check(isPos(v.levelMax) && (v.levelMax as number) >= (v.levelMin as number), `${where}.levelMax`);
}

function checkArmors(v: unknown): ArmorData[] {
  check(Array.isArray(v) && v.length > 0, "armors.json");
  const ids = new Set<string>();
  for (const a of v) {
    check(
      isRec(a) && isStr(a.id) && !ids.has(a.id) && isStr(a.classId) && isStr(a.name) &&
      [1, 2, 3].includes(a.tier as number) && isRec(a.colors) &&
      HEX.test(a.colors.primary as string) && HEX.test(a.colors.secondary as string) &&
      HEX.test(a.colors.accent as string) && HEX.test(a.aura as string) &&
      isRec(a.bonus) && isNum(a.bonus.maxHp) && (a.bonus.maxHp as number) >= 0,
      "armors.json",
    );
    const b = a.bonus as Rec;
    for (const k of ["atk", "def", "mana"]) {
      check(b[k] === undefined || (isNum(b[k]) && (b[k] as number) >= 0), `armors.json:${a.id}.bonus.${k}`);
    }
    if (a.minLevel !== undefined) check(isPos(a.minLevel), `armors.json:${a.id}.minLevel`);
    if (a.material !== undefined) check(isStr(a.material), `armors.json:${a.id}.material`);
    if (a.setBonus !== undefined) check(isStr(a.setBonus), `armors.json:${a.id}.setBonus`);
    ids.add(a.id);
  }
  return v as unknown as ArmorData[];
}

function checkDungeons(v: unknown): DungeonData[] {
  check(Array.isArray(v) && v.length > 0, "dungeons.json");
  const ids = new Set<string>();
  for (const d of v) {
    check(
      isRec(d) && isStr(d.id) && !ids.has(d.id) && isStr(d.name) &&
      isPos(d.levelMin) && isPos(d.levelMax) && (d.levelMax as number) >= (d.levelMin as number) &&
      isNum(d.maxPlayers) && (d.maxPlayers as number) >= 1 && (d.maxPlayers as number) <= 8 &&
      Array.isArray(d.mobs) && d.mobs.length > 0 &&
      d.mobs.every((m) => isRec(m) && isStr(m.mobId) && isPos(m.count) && isPos(m.level) &&
        (m.level as number) >= (d.levelMin as number) && (m.level as number) <= (d.levelMax as number)) &&
      isRec(d.boss) && isStr(d.boss.mobId) && isStr(d.boss.name) && isPos(d.boss.level) &&
      isPos(d.boss.hpMult) && isPos(d.boss.atkMult),
      "dungeons.json",
    );
    if (d.entrance !== undefined) {
      const e = d.entrance as Rec;
      check(isRec(e) && isStr(e.zone), `dungeons.json:${d.id}.entrance`);
      if (e.npc !== undefined) check(isStr(e.npc), `dungeons.json:${d.id}.entrance.npc`);
      if (e.questId !== undefined) check(isStr(e.questId), `dungeons.json:${d.id}.entrance.questId`);
    }
    if (d.encounters !== undefined) {
      check(
        Array.isArray(d.encounters) && (d.encounters as unknown[]).length > 0 &&
        (d.encounters as Rec[]).every((en) => isRec(en) && isStr(en.id) && isStr(en.name) &&
          ["trash", "elite", "boss"].includes(en.kind as string) &&
          Array.isArray(en.mechanics) && (en.mechanics as unknown[]).every((m) => isStr(m))),
        `dungeons.json:${d.id}.encounters`,
      );
      check(
        (d.encounters as Rec[]).some((en) => en.kind === "boss"),
        `dungeons.json:${d.id}.encounters needs a boss`,
      );
    }
    if (d.loot !== undefined) {
      check(
        Array.isArray(d.loot) && (d.loot as unknown[]).length > 0 &&
        (d.loot as Rec[]).every((l) => isRec(l) && isStr(l.item) &&
          ["Incomum", "Raro", "Épico", "Lendário"].includes(l.rarity as string) &&
          isNum(l.dropChance) && (l.dropChance as number) > 0 && (l.dropChance as number) <= 1),
        `dungeons.json:${d.id}.loot`,
      );
    }
    if (d.lockoutHours !== undefined) check(isPos(d.lockoutHours), `dungeons.json:${d.id}.lockoutHours`);
    ids.add(d.id);
  }
  return v as unknown as DungeonData[];
}

function checkCity(v: unknown): CityData {
  check(isRec(v), "city.json");
  check(
    isStr(v.id) && isStr(v.name) && isStr(v.lore) &&
    isPos(v.levelMin) && isPos(v.levelMax) && (v.levelMax as number) >= (v.levelMin as number) &&
    Array.isArray(v.districts) && (v.districts as unknown[]).length > 0 &&
    (v.districts as Rec[]).every((d) => isStr(d.id) && isStr(d.name) && isStr(d.description)) &&
    Array.isArray(v.npcs) && (v.npcs as unknown[]).length > 0 &&
    (v.npcs as Rec[]).every((n) => isStr(n.id) && isStr(n.name) && isStr(n.role) &&
      isStr(n.function) && isStr(n.district)) &&
    Array.isArray(v.quests) && (v.quests as unknown[]).length >= 8 &&
    (v.quests as Rec[]).every((q) => {
      const o = q.objective as Rec | undefined;
      const r = q.rewards as Rec | undefined;
      return isStr(q.id) && isStr(q.name) && isPos(q.level) && isStr(q.giver) &&
        isRec(o) && ["kill", "collect", "talk", "enter", "boss"].includes(o.type as string) &&
        isStr(o.target) && isNum(o.count) && (o.count as number) >= 1 &&
        isRec(r) && isNum(r.xp) && (r.xp as number) >= 0 && isNum(r.gold) && (r.gold as number) >= 0;
    }) &&
    Array.isArray(v.mobBands) && (v.mobBands as unknown[]).length > 0 &&
    (v.mobBands as Rec[]).every((b) => isPos(b.minLevel) && isPos(b.maxLevel) &&
      (b.maxLevel as number) >= (b.minLevel as number) &&
      Array.isArray(b.mobIds) && (b.mobIds as unknown[]).length > 0 && isStr(b.area)),
    "city.json",
  );
  return v as unknown as CityData;
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
    if (c.growthPerLevel !== undefined) {
      const g = c.growthPerLevel as Rec;
      check(
        isNum(g.maxHp) && (g.maxHp as number) > 0 && isNum(g.atk) && (g.atk as number) > 0 &&
        isNum(g.def) && (g.def as number) >= 0 && isNum(g.stamina) && (g.stamina as number) > 0 &&
        isNum(g.mana) && (g.mana as number) >= 0,
        `classes.json:${c.id}.growthPerLevel`,
      );
    }
  }
  return v as unknown as ClassData[];
}

function checkSkills(v: unknown): SkillData[] {
  check(Array.isArray(v) && v.length > 0, "skills.json");
  const ids = new Set<string>();
  for (const s of v) {
    check(
      isRec(s) && isStr(s.id) && isStr(s.classId) && isStr(s.name) &&
      !ids.has(s.id) && ["damage", "heal", "taunt", "buff", "mobility"].includes(s.kind as string) &&
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
export const ZONES: ZoneData[] = ((): ZoneData[] => {
  check(Array.isArray(zonesData) && zonesData.length > 0, "zones.json");
  return zonesData.map((z) => checkZone(z));
})();
export const ARMORS: ArmorData[] = checkArmors(armorsData);
export const DUNGEONS: DungeonData[] = checkDungeons(dungeonsData);
export const CITY: CityData = checkCity(cityData);
export const CLASSES: ClassData[] = checkClasses(classesData);
export const SKILLS: SkillData[] = checkSkills(skillsData);
export const MOBS: MobData[] = checkMobs(mobsData);

// Cross-file integrity: every class points at a skill that exists.
for (const c of CLASSES) {
  if (!SKILLS.some((s) => s.id === c.skillId && s.classId === c.id)) {
    throw new Error(`classes.json: ${c.id} skill ${c.skillId} missing in skills.json`);
  }
}
// Every armor belongs to a real class; every dungeon mob/boss is a real mob.
for (const a of ARMORS) {
  if (!CLASSES.some((c) => c.id === a.classId)) {
    throw new Error(`armors.json: ${a.id} class ${a.classId} missing in classes.json`);
  }
}
for (const d of DUNGEONS) {
  for (const m of d.mobs) {
    if (!MOBS.some((mob) => mob.id === m.mobId)) {
      throw new Error(`dungeons.json: ${d.id} mob ${m.mobId} missing in mobs.json`);
    }
  }
  if (!MOBS.some((mob) => mob.id === d.boss.mobId)) {
    throw new Error(`dungeons.json: ${d.id} boss mob ${d.boss.mobId} missing in mobs.json`);
  }
}
// Zones: the legacy ZONE (dunas) must exist in zones.json too.
if (!ZONES.some((z) => z.zone.id === ZONE.zone.id)) {
  throw new Error(`zones.json: missing zone ${ZONE.zone.id}`);
}
// City: every quest giver and mob-band district/mob must exist; quest chain links resolve.
for (const q of CITY.quests) {
  if (!CITY.npcs.some((n) => n.id === q.giver)) {
    throw new Error(`city.json: quest ${q.id} giver ${q.giver} missing in npcs`);
  }
  if (q.nextQuestId !== undefined && !CITY.quests.some((n) => n.id === q.nextQuestId)) {
    throw new Error(`city.json: quest ${q.id} next ${q.nextQuestId} missing`);
  }
}
for (const b of CITY.mobBands) {
  for (const mobId of b.mobIds) {
    if (!MOBS.some((m) => m.id === mobId)) {
      throw new Error(`city.json: mob band mob ${mobId} missing in mobs.json`);
    }
  }
}
for (const n of CITY.npcs) {
  if (!CITY.districts.some((d) => d.id === n.district)) {
    throw new Error(`city.json: npc ${n.id} district ${n.district} missing`);
  }
}
// Dungeons: every encounter boss must be the dungeon boss; lockout must be set.
for (const d of DUNGEONS) {
  if (d.encounters !== undefined) {
    const bossEnc = d.encounters.filter((e) => e.kind === "boss");
    if (bossEnc.length !== 1) {
      throw new Error(`dungeons.json: ${d.id} must have exactly 1 boss encounter`);
    }
    if (d.lockoutHours === undefined) {
      throw new Error(`dungeons.json: ${d.id} missing lockoutHours`);
    }
  }
}

export const classById = (id: string): ClassData | undefined =>
  CLASSES.find((c) => c.id === id);
export const skillById = (id: string): SkillData | undefined =>
  SKILLS.find((s) => s.id === id);
export const mobById = (id: string): MobData | undefined => MOBS.find((m) => m.id === id);
export const zoneById = (id: string): ZoneData | undefined =>
  ZONES.find((z) => z.zone.id === id);
export const armorById = (id: string): ArmorData | undefined =>
  ARMORS.find((a) => a.id === id);
export const armorsForClass = (classId: string): ArmorData[] =>
  ARMORS.filter((a) => a.classId === classId).sort((a, b) => a.tier - b.tier);
export const dungeonById = (id: string): DungeonData | undefined =>
  DUNGEONS.find((d) => d.id === id);
