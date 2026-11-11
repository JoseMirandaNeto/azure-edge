import { CLASSES, ZONE, classById, mobById, skillById, type ClassData, type MobData } from "@azure-edge/gamedata";
import {
  AnimState,
  BASE_CRIT_CHANCE,
  DODGE_CANCEL_EXTRA_COST,
  DODGE_COST,
  DODGE_DISTANCE_M,
  GUARD_DAMAGE_REDUCTION,
  GUARD_DRAIN_PER_S,
  INPUT_BUFFER_FRAMES,
  KNOCKDOWN_FRAMES,
  MANA_REGEN_PER_S,
  PARRY_WINDOW_FRAMES,
  PERFECT_DODGE_MANA,
  STAGGER_FRAMES,
  TICK_DT_S,
  applyPoise,
  arcContains,
  canAttack,
  canDodge,
  canGuard,
  chainActiveRange,
  chainTotalFrames,
  comboStateBonus,
  createCombatant,
  damageAmount,
  dodgeIsIframes,
  dodgeIsPerfectWindow,
  dodgeTotalFrames,
  isInCancelWindow,
  isInFront,
  maxDisplacementM,
  rollCrit,
  rollVariance,
  sfc32,
  stepMovement,
  type CombatEvent,
  type CombatState,
  type Combatant,
  type EntityState,
  type InputPayload,
  type SimState,
} from "@azure-edge/shared";

/**
 * Authoritative zone simulation (M1). Pure simulation, no sockets here so it
 * is unit-testable. The server is the ONLY writer of positions and damage:
 * clients send inputs, the server steps them and returns snapshots + events.
 *
 * Combat runs on logical 60 fps frames: each 20 Hz tick is 3 sub-steps, and
 * hitboxes are evaluated per sub-step so a 4-frame active window is never
 * skipped between ticks (COMBAT_SPEC.md).
 */
export interface PlayerEntity extends SimState {
  id: number;
  kind: "player";
  name: string;
  classId: string;
  atk: number;
  def: number;
  combat: Combatant;
  lastSeq: number;
  /** Inputs received since the last tick, in arrival order. */
  pending: InputPayload[];
  rejected: number;
  /** Combat rejects validated at step time (sent back as Reject messages). */
  rejectsOut: Array<{ seq: number; reason: string }>;
  /** Latest movement input (consumed by the sub-steps). */
  moveInput: Pick<InputPayload, "moveX" | "moveY" | "yaw">;
  guardHeld: boolean;
  /** Buffered action (150 ms input buffer) with expiry frame. */
  buffered: { kind: "attack" | "dodge" | "skill"; skillId: number; expiresFrame: number } | null;
  dodgeDirX: number;
  dodgeDirY: number;
  /** "windowKey:targetId" pairs already hit by the current swing/skill. */
  hitDone: Set<string>;
  /** Displacement this tick that is NOT walk movement (dodge/lunge/knockback). */
  extraM: number;
  /** Frame at which a dead player respawns. */
  deadUntilFrame: number;
  /** Position before this tick (speed validation). */
  _before?: { x: number; y: number; yaw: number; moving: boolean };
}

/** Mob AI states (patrol → chase → windup → attack → recover). */
export type MobAiState = "patrol" | "chase" | "windup" | "attack" | "recover" | "stagger" | "dead";

export interface MobEntity {
  id: number;
  kind: "mob";
  mobId: string;
  name: string;
  data: MobData;
  x: number;
  y: number;
  yaw: number;
  combat: Combatant;
  def: number;
  atk: number;
  aiState: MobAiState;
  anchorX: number;
  anchorY: number;
  patrolX: number;
  patrolY: number;
  targetId: number | null;
  /** Provocação: { playerId, frame until which the mob must chase them }. */
  taunt: { byPlayerId: number; untilFrame: number } | null;
  respawnFrame: number;
  /** "windowKey:targetId" pairs already hit by the current swing. */
  hitDone: Set<string>;
  extraM: number;
}

const SUB_STEPS_PER_TICK = 3;
const FRAME_DT_S = 1 / 60;
/** Player class for M1 (no class select yet — Espadachim is the test class). */
const M1_CLASS_ID = "espadachim";
/** Fallback class (gamedata guarantees >= 1 class; fail loud otherwise). */
function firstClass(): ClassData {
  const c = CLASSES[0];
  if (!c) throw new Error("gamedata has no classes");
  return c;
}


function animFor(state: CombatState): number {
  switch (state) {
    case "idle": return AnimState.idle;
    case "move": return AnimState.move;
    case "attack": return AnimState.attack;
    case "dodge": return AnimState.dodge;
    case "guard": return AnimState.guard;
    case "skill": return AnimState.skill;
    case "stagger": return AnimState.stagger;
    case "knockdown": return AnimState.knockdown;
    case "dead": return AnimState.dead;
  }
}

export class ZoneWorld {
  readonly tickRate = 20;
  tick = 0;
  /** Logical 60 fps frame counter (3 per tick). */
  frame = 0;
  readonly players = new Map<number, PlayerEntity>();
  /** Mobs live in a separate id space (10000+). */
  readonly mobs = new Map<number, MobEntity>();
  private nextId = 1;
  private nextMobId = 10000;
  private nextEventId = 1;
  private events: Array<CombatEvent & { eventId: number }> = [];
  /** Seeded RNG for crit/variance — deterministic per world seed. */
  private readonly rng = sfc32(20261111);
  /** Tick duration stats (ms) for the F3 / metrics log. */
  tickMsLast = 0;
  tickMsMax = 0;
  private tickMsSum = 0;
  private tickCount = 0;
  private tickMsSamples: number[] = [];

  addPlayer(name: string): PlayerEntity {
    const id = this.nextId;
    this.nextId += 1;
    const cls = classById(M1_CLASS_ID) ?? firstClass();
    // Deterministic spawn ring around the zone spawn — no Math.random.
    const angle = (id - 1) * 2.399963; // golden angle
    const radius = 1.5 + (id - 1) * 0.5;
    const p: PlayerEntity = {
      id,
      kind: "player",
      name: name || `Player${id}`,
      classId: cls.id,
      atk: cls.base.atk,
      def: cls.base.def,
      combat: createCombatant(cls.base.maxHp, cls.base.stamina, cls.base.mana, 40),
      x: ZONE.zone.spawn.x + Math.cos(angle) * radius,
      y: ZONE.zone.spawn.y + Math.sin(angle) * radius,
      yaw: 0,
      moving: false,
      lastSeq: 0,
      pending: [],
      rejected: 0,
      rejectsOut: [],
      moveInput: { moveX: 0, moveY: 0, yaw: 0 },
      guardHeld: false,
      buffered: null,
      dodgeDirX: 0,
      dodgeDirY: 1,
      hitDone: new Set(),
      extraM: 0,
      deadUntilFrame: -1,
    };
    this.players.set(id, p);
    return p;
  }

  removePlayer(id: number): void {
    this.players.delete(id);
  }

  // --- Mobs ---

  /** Spawn one mob of a data-driven type at an anchor point. */
  spawnMob(mobId: string, anchorX: number, anchorY: number): MobEntity | null {
    const data = mobById(mobId);
    if (!data) return null;
    const id = this.nextMobId;
    this.nextMobId += 1;
    const m: MobEntity = {
      id,
      kind: "mob",
      mobId,
      name: data.name,
      data,
      x: anchorX,
      y: anchorY,
      yaw: 0,
      combat: createCombatant(data.maxHp, 100, 0, data.poise),
      def: data.def,
      atk: data.atk,
      aiState: "patrol",
      anchorX,
      anchorY,
      patrolX: anchorX,
      patrolY: anchorY,
      targetId: null,
      taunt: null,
      respawnFrame: -1,
      hitDone: new Set(),
      extraM: 0,
    };
    this.mobs.set(id, m);
    return m;
  }

  /** Spawn `count` mobs of one type, spread deterministically around the zone. */
  spawnMobs(mobId: string, count: number): MobEntity[] {
    const out: MobEntity[] = [];
    for (let i = 0; i < count; i += 1) {
      const angle = i * 2.399963;
      const radius = 10 + (i % 5) * 6;
      const m = this.spawnMob(mobId, Math.cos(angle) * radius, Math.sin(angle) * radius);
      if (m) out.push(m);
    }
    return out;
  }

  /** Default M1 arena mix (Oásis dos Nômades): escorpião é o mob principal. */
  spawnArenaMobs(): void {
    const mix: Array<[string, number, number]> = [
      ["escorpiao", 12, 6],
      ["escorpiao", -10, 12],
      ["escorpiao", 8, -14],
      ["formiga", -14, -8],
      ["besouro", 18, -6],
      ["mumia", -8, 18],
    ];
    for (const [id, x, y] of mix) this.spawnMob(id, x, y);
  }

  /**
   * Provocação (Guardião): mobs in radius redirect to the taunting player
   * for durationS. The cast itself arrives with the Guardião (M3); the
   * mob-side reaction is implemented and tested here.
   */
  tauntMobs(playerId: number, radiusM: number, durationS: number): void {
    const p = this.players.get(playerId);
    if (!p) return;
    for (const m of this.mobs.values()) {
      if (m.combat.state === "dead") continue;
      if (Math.hypot(m.x - p.x, m.y - p.y) <= radiusM) {
        m.taunt = { byPlayerId: playerId, untilFrame: this.frame + Math.round(durationS * 60) };
      }
    }
  }

  private nearestPlayer(x: number, y: number, maxDist: number): number | null {
    let best: number | null = null;
    let bestDist = maxDist;
    for (const p of this.players.values()) {
      if (p.combat.state === "dead") continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= bestDist) {
        bestDist = d;
        best = p.id;
      }
    }
    return best;
  }

  private pickPatrolPoint(m: MobEntity): void {
    const angle = this.rng() * Math.PI * 2;
    const radius = 4 + this.rng() * 16;
    const half = ZONE.zone.sizeM / 2 - 2;
    m.patrolX = Math.max(-half, Math.min(half, m.anchorX + Math.cos(angle) * radius));
    m.patrolY = Math.max(-half, Math.min(half, m.anchorY + Math.sin(angle) * radius));
  }

  private moveMobToward(m: MobEntity, tx: number, ty: number, speedMps: number): void {
    const dx = tx - m.x;
    const dy = ty - m.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-6) return;
    const step = Math.min(dist, speedMps * FRAME_DT_S);
    m.x += (dx / dist) * step;
    m.y += (dy / dist) * step;
    m.yaw = Math.atan2(dx, dy);
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

  /** Combat rejects validated during step() (client rolls the visual back). */
  drainRejects(): Array<{ playerId: number; seq: number; reason: string }> {
    const out: Array<{ playerId: number; seq: number; reason: string }> = [];
    for (const p of this.players.values()) {
      for (const r of p.rejectsOut) out.push({ playerId: p.id, seq: r.seq, reason: r.reason });
      p.rejectsOut = [];
    }
    return out;
  }

  /** Combat events since the last drain (sent as Event messages). */
  drainEvents(): Array<CombatEvent & { eventId: number }> {
    const out = this.events;
    this.events = [];
    return out;
  }

  private emit(e: CombatEvent): void {
    this.events.push({ ...e, eventId: this.nextEventId });
    this.nextEventId += 1;
  }

  private reject(p: PlayerEntity, seq: number, reason: string): void {
    // seq 0 = server-side buffered action, not a client input: no Reject.
    if (seq > 0) p.rejectsOut.push({ seq, reason });
  }

  // --- Combat actions (validated; invalid ones become Reject messages) ---

  private tryAttack(p: PlayerEntity, seq: number): void {
    const c = p.combat;
    const cls = classById(p.classId) ?? firstClass();
    if (c.state === "guard") this.exitGuard(p);
    if (!canAttack(c, cls.basicChain)) {
      if (c.state === "attack") {
        p.buffered = { kind: "attack", skillId: 0, expiresFrame: this.frame + INPUT_BUFFER_FRAMES };
        return;
      }
      this.reject(p, seq, "state");
      return;
    }
    if (c.state === "attack") {
      // Inside the cancel window: chain into the next hit.
      const hit = cls.basicChain[c.chainIndex];
      if (hit && isInCancelWindow(hit, c.stateFrame)) {
        c.chainIndex = Math.min(c.chainIndex + 1, cls.basicChain.length - 1);
      }
    } else {
      c.chainIndex = 0;
    }
    c.state = "attack";
    c.stateFrame = 0;
    c.guardSinceFrame = null;
    p.hitDone = new Set();
  }

  private tryDodge(p: PlayerEntity, seq: number): void {
    const c = p.combat;
    const cls = classById(p.classId) ?? firstClass();
    // Dodge cancels attack recovery only (spec), not startup/active.
    if (c.state === "attack") {
      const hit = cls.basicChain[c.chainIndex];
      if (!hit || c.stateFrame < hit.startup + hit.active) {
        this.reject(p, seq, "state");
        return;
      }
    } else if (!canDodge(c)) {
      this.reject(p, seq, "state");
      return;
    }
    const cancellingAttack = c.state === "attack";
    const cost = DODGE_COST + (cancellingAttack ? DODGE_CANCEL_EXTRA_COST : 0);
    if (c.stamina < cost) {
      this.reject(p, seq, "stamina");
      return;
    }
    c.stamina -= cost;
    this.exitGuard(p);
    // Dodge in the movement direction, or facing if standing still.
    const len = Math.hypot(p.moveInput.moveX, p.moveInput.moveY);
    if (len > 0.01) {
      const sin = Math.sin(p.moveInput.yaw);
      const cos = Math.cos(p.moveInput.yaw);
      const nx = p.moveInput.moveX / len;
      const ny = p.moveInput.moveY / len;
      p.dodgeDirX = nx * cos + ny * sin;
      p.dodgeDirY = -nx * sin + ny * cos;
    } else {
      p.dodgeDirX = Math.sin(p.yaw);
      p.dodgeDirY = Math.cos(p.yaw);
    }
    c.state = "dodge";
    c.stateFrame = 0;
  }

  private trySkill(p: PlayerEntity, skillId: number, seq: number): void {
    const c = p.combat;
    const cls = classById(p.classId) ?? firstClass();
    // skillId 1 = the class skill slot (only skill in M1).
    const skill = skillId === 1 ? skillById(cls.skillId) : undefined;
    if (!skill || skill.classId !== p.classId) {
      this.reject(p, seq, "skill");
      return;
    }
    if (c.state !== "idle" && c.state !== "move") {
      this.reject(p, seq, "state");
      return;
    }
    if (c.mana < skill.costMana) {
      this.reject(p, seq, "mana");
      return;
    }
    if (this.frame < (c.skillReadyFrame[skill.id] ?? 0)) {
      this.reject(p, seq, "cooldown");
      return;
    }
    c.mana -= skill.costMana;
    c.skillReadyFrame[skill.id] = this.frame + Math.round(skill.cooldownS * 60);
    this.exitGuard(p);
    c.state = "skill";
    c.stateFrame = 0;
    p.hitDone = new Set();
    this.emit({
      kind: "skill", sourceId: p.id, targetId: p.id, amount: 0, crit: false, x: p.x, y: p.y,
    });
  }

  private exitGuard(p: PlayerEntity): void {
    p.combat.guardSinceFrame = null;
    if (p.combat.state === "guard") {
      p.combat.state = "idle";
      p.combat.stateFrame = 0;
    }
  }

  /** Is the target inside a skill's super-armor window right now? */
  private targetSuperArmor(t: PlayerEntity): boolean {
    const c = t.combat;
    if (c.state !== "skill") return false;
    const skill = skillById(classById(t.classId)?.skillId ?? "");
    if (!skill?.superArmor) return false;
    return c.stateFrame >= skill.superArmor.from && c.stateFrame <= skill.superArmor.to;
  }

  // --- Hit resolution ---

  /**
   * Resolve one hit window against every other living entity in the arc.
   * Each target is hit at most once per window (windowKey). `hitMobs` is
   * false for mob attacks (mobs don't fight each other).
   */
  private resolveHit(
    source: { id: number; x: number; y: number; yaw: number; atk: number; hitDone: Set<string> },
    windowKey: string,
    radius: number,
    angleDeg: number,
    mult: number,
    poiseDmg: number,
    finisher: boolean,
    effect?: "knockback" | "knockdown",
    hitMobs = true,
  ): void {
    for (const t of this.players.values()) {
      if (t.id === source.id || t.combat.state === "dead") continue;
      const key = `${windowKey}:${t.id}`;
      if (source.hitDone.has(key)) continue;
      if (!arcContains(source.x, source.y, source.yaw, t.x, t.y, { type: "arc", radius, angle: angleDeg })) continue;
      source.hitDone.add(key);
      this.applyHit(source, mult, poiseDmg, finisher, effect, t);
    }
    if (!hitMobs) return;
    for (const m of this.mobs.values()) {
      if (m.combat.state === "dead") continue;
      const key = `${windowKey}:m${m.id}`;
      if (source.hitDone.has(key)) continue;
      if (!arcContains(source.x, source.y, source.yaw, m.x, m.y, { type: "arc", radius, angle: angleDeg })) continue;
      source.hitDone.add(key);
      this.applyHit(source, mult, poiseDmg, finisher, effect, m);
    }
  }

  /** Shared damage path for players and mobs (dodge/guard only apply to players). */
  private applyHit(
    source: { id: number; x: number; y: number; yaw: number; atk: number },
    mult: number,
    poiseDmg: number,
    finisher: boolean,
    effect: "knockback" | "knockdown" | undefined,
    t: PlayerEntity | MobEntity,
  ): void {
    const c = t.combat;
    if (t.kind === "player") {
      // Dodge i-frames: a hit in the perfect window (f3–f8) is a perfect dodge.
      if (c.state === "dodge" && dodgeIsIframes(c.stateFrame)) {
        if (dodgeIsPerfectWindow(c.stateFrame)) {
          c.mana = Math.min(c.maxMana, c.mana + PERFECT_DODGE_MANA);
          this.emit({ kind: "perfect", sourceId: source.id, targetId: t.id, amount: 0, crit: false, x: t.x, y: t.y });
        }
        return;
      }
      // Guard: frontal only. First 8 frames of the guard = parry.
      if (c.state === "guard" && isInFront(t.x, t.y, t.yaw, source.x, source.y)) {
        const guardAge = this.frame - (c.guardSinceFrame ?? this.frame);
        if (guardAge <= PARRY_WINDOW_FRAMES) {
          this.emit({ kind: "parry", sourceId: source.id, targetId: t.id, amount: 0, crit: false, x: t.x, y: t.y });
          this.staggerAttacker(source.id);
          return;
        }
      }
    }
    let dmgMult = 1;
    let finalPoise = poiseDmg;
    if (t.kind === "player" && c.state === "guard" && isInFront(t.x, t.y, t.yaw, source.x, source.y)) {
      dmgMult = 1 - GUARD_DAMAGE_REDUCTION;
      finalPoise = poiseDmg * dmgMult;
    }
    const crit = rollCrit(this.rng, BASE_CRIT_CHANCE);
    const bonus = comboStateBonus(c.state, c.comboHits);
    const dmg = Math.max(1, Math.round(damageAmount(source.atk, mult, t.def, crit, rollVariance(this.rng), bonus) * dmgMult));
    c.hp = Math.max(0, c.hp - dmg);
    c.comboHits += 1;
    c.lastHitFrame = this.frame;
    this.emit({ kind: "hit", sourceId: source.id, targetId: t.id, amount: dmg, crit, finisher, x: t.x, y: t.y });
    if (effect === "knockback") this.pushBack(t, source.yaw, 0.6);
    const superArmor = t.kind === "player" && this.targetSuperArmor(t);
    if (applyPoise(c, finalPoise, this.frame, superArmor) === "stagger") this.staggerTarget(t);
    if (finisher && c.state !== "dead") this.knockdownTarget(t);
    if (effect === "knockdown" && c.state !== "dead") this.knockdownTarget(t);
    if (c.hp <= 0) this.killTarget(t, source.id, crit);
  }

  /** Parry staggers whoever attacked — a player or a mob. */
  private staggerAttacker(sourceId: number): void {
    const attacker = this.players.get(sourceId);
    if (attacker) {
      this.staggerTarget(attacker);
      return;
    }
    const mob = this.mobs.get(sourceId);
    if (mob) this.staggerTarget(mob);
  }

  private staggerTarget(t: PlayerEntity | MobEntity): void {
    const c = t.combat;
    if (c.state === "dead") return;
    c.state = "stagger";
    c.stateFrame = 0;
    c.guardSinceFrame = null;
    if (t.kind === "mob") t.aiState = "stagger";
  }

  private knockdownTarget(t: PlayerEntity | MobEntity): void {
    const c = t.combat;
    if (c.state === "dead") return;
    c.state = "knockdown";
    c.stateFrame = 0;
    c.guardSinceFrame = null;
    if (t.kind === "mob") t.aiState = "stagger"; // mobs recover from knockdown as stagger
  }

  private killTarget(t: PlayerEntity | MobEntity, sourceId: number, crit: boolean): void {
    const c = t.combat;
    c.hp = 0;
    c.state = "dead";
    c.stateFrame = 0;
    this.emit({ kind: "kill", sourceId, targetId: t.id, amount: 0, crit, x: t.x, y: t.y });
    if (t.kind === "player") {
      t.deadUntilFrame = this.frame + 300; // respawn after 5 s
    } else {
      t.respawnFrame = this.frame + Math.round(t.data.respawnS * 60);
      t.aiState = "dead";
    }
  }

  private pushBack(t: { x: number; y: number; extraM: number }, yaw: number, distM: number): void {
    const half = ZONE.zone.sizeM / 2;
    t.x = Math.max(-half, Math.min(half, t.x + Math.sin(yaw) * distM));
    t.y = Math.max(-half, Math.min(half, t.y + Math.cos(yaw) * distM));
    t.extraM += distM;
  }

  // --- Tick ---

  /** One fixed 20 Hz tick: apply one queued input per player, then 3 sub-steps. */
  step(): void {
    const started = performance.now();
    this.tick += 1;
    for (const p of this.players.values()) {
      const input = p.pending.shift();
      p.extraM = 0;
      p._before = { x: p.x, y: p.y, yaw: p.yaw, moving: p.moving };
      if (!input) {
        p.moveInput = { moveX: 0, moveY: 0, yaw: p.yaw };
        p.guardHeld = false;
        continue;
      }
      p.moveInput = { moveX: input.moveX, moveY: input.moveY, yaw: input.yaw };
      p.guardHeld = (input.buttons & 4) !== 0;
      // Action edges (validated now; failures become Reject messages).
      if (p.combat.state !== "dead") {
        if ((input.buttons & 1) !== 0) this.tryAttack(p, input.seq);
        if ((input.buttons & 2) !== 0) this.tryDodge(p, input.seq);
        if (input.skillId > 0) this.trySkill(p, input.skillId, input.seq);
      }
      if (p.guardHeld && canGuard(p.combat)) {
        if (p.combat.state !== "guard") {
          p.combat.state = "guard";
          p.combat.stateFrame = 0;
          p.combat.guardSinceFrame = this.frame;
        }
      } else if (p.combat.state === "guard") {
        this.exitGuard(p);
      }
    }
    for (let s = 0; s < SUB_STEPS_PER_TICK; s += 1) {
      this.frame += 1;
      this.subStep();
      for (const m of this.mobs.values()) this.stepMob(m);
    }
    // Server-side speed validation (walk cap + dodge/lunge/knockback allowance).
    for (const p of this.players.values()) {
      const before = p._before;
      if (!before) continue;
      const moved = Math.hypot(p.x - before.x, p.y - before.y);
      const cls = classById(p.classId) ?? firstClass();
      const cap = maxDisplacementM(cls.base.walkSpeedMps, TICK_DT_S) + p.extraM;
      if (moved > cap) {
        p.rejected += 1;
        p.x = before.x;
        p.y = before.y;
      }
      const half = ZONE.zone.sizeM / 2;
      p.x = Math.max(-half, Math.min(half, p.x));
      p.y = Math.max(-half, Math.min(half, p.y));
      delete p._before;
    }
    const ms = performance.now() - started;
    this.tickMsLast = ms;
    this.tickMsMax = Math.max(this.tickMsMax, ms);
    this.tickMsSum += ms;
    this.tickCount += 1;
    this.tickMsSamples.push(ms);
    if (this.tickMsSamples.length > 600) this.tickMsSamples.shift();
  }

  private subStep(): void {
    for (const p of this.players.values()) {
      const c = p.combat;
      // Respawn after death.
      if (c.state === "dead") {
        if (this.frame >= p.deadUntilFrame) {
          c.hp = c.maxHp;
          c.poise = c.poiseMax;
          c.state = "idle";
          c.stateFrame = 0;
          p.x = ZONE.zone.spawn.x;
          p.y = ZONE.zone.spawn.y;
        } else {
          continue;
        }
      }
      c.stateFrame += 1;
      // Regen (per frame).
      c.stamina = Math.min(c.maxStamina, c.stamina + (20 / 60));
      c.mana = Math.min(c.maxMana, c.mana + (MANA_REGEN_PER_S / 60));
      c.poise = Math.min(c.poiseMax, c.poise + (5 / 60));
      if (this.frame - c.lastHitFrame > 120) c.comboHits = 0;
      // Buffered action (150 ms): consume when the state allows it.
      if (p.buffered && this.frame <= p.buffered.expiresFrame) {
        const b = p.buffered;
        if (b.kind === "attack") {
          const cls = classById(p.classId) ?? firstClass();
          if (canAttack(c, cls.basicChain)) {
            p.buffered = null;
            this.tryAttack(p, 0);
          }
        } else if (b.kind === "dodge" && canDodge(c)) {
          p.buffered = null;
          this.tryDodge(p, 0);
        }
      } else if (p.buffered) {
        p.buffered = null;
      }

      switch (c.state) {
        case "attack": {
          const cls = classById(p.classId) ?? firstClass();
          const hit = cls.basicChain[c.chainIndex];
          if (!hit) {
            c.state = "idle";
            c.stateFrame = 0;
            break;
          }
          const [a0, a1] = chainActiveRange(hit);
          if (c.stateFrame >= a0 && c.stateFrame < a1) {
            // Lunge across the active frames; resolve the hit every active
            // frame (each target once per swing, via hitDone keys).
            const perFrame = hit.advanceM / hit.active;
            p.x += Math.sin(p.yaw) * perFrame;
            p.y += Math.cos(p.yaw) * perFrame;
            p.extraM += perFrame;
            this.resolveHit(p, `atk${c.chainIndex}`, 2.5, 140, hit.mult, hit.poise, hit.finisher === true);
          }
          if (c.stateFrame >= chainTotalFrames(hit)) {
            c.state = "idle";
            c.stateFrame = 0;
            c.chainIndex = 0;
          }
          break;
        }
        case "skill": {
          const skill = skillById(classById(p.classId)?.skillId ?? "");
          if (!skill) {
            c.state = "idle";
            c.stateFrame = 0;
            break;
          }
          const activeEnd = Math.max(...skill.active.map((w) => w.to));
          for (const w of skill.active) {
            if (c.stateFrame >= w.from && c.stateFrame < w.to) {
              if (skill.kind === "heal") {
                const key = `heal:${w.from}`;
                if (!p.hitDone.has(key)) {
                  p.hitDone.add(key);
                  const healed = Math.min(w.hit.heal ?? 0, c.maxHp - c.hp);
                  c.hp += healed;
                  this.emit({ kind: "heal", sourceId: p.id, targetId: p.id, amount: healed, crit: false, x: p.x, y: p.y });
                }
              } else if (skill.kind === "damage") {
                this.resolveHit(
                  p, `sk${w.from}`,
                  w.shape.radius ?? 2.5, w.shape.angle ?? 140,
                  w.hit.mult ?? 1, w.hit.poise ?? 0, false, w.hit.effect,
                );
              }
              // kind "taunt"/"buff": applied by tauntMobs/applyBuff (mobs commit);
              // unreachable in M1 (only the Espadachim damage skill is castable).
            }
          }
          if (c.stateFrame >= activeEnd + skill.recovery) {
            c.state = "idle";
            c.stateFrame = 0;
          }
          break;
        }
        case "dodge": {
          const perFrame = DODGE_DISTANCE_M / dodgeTotalFrames();
          p.x += p.dodgeDirX * perFrame;
          p.y += p.dodgeDirY * perFrame;
          p.extraM += perFrame;
          if (c.stateFrame >= dodgeTotalFrames()) {
            c.state = "idle";
            c.stateFrame = 0;
          }
          break;
        }
        case "guard": {
          c.stamina = Math.max(0, c.stamina - GUARD_DRAIN_PER_S / 60);
          if (c.stamina <= 0 || !p.guardHeld) this.exitGuard(p);
          break;
        }
        case "stagger": {
          if (c.stateFrame >= STAGGER_FRAMES) {
            c.state = "idle";
            c.stateFrame = 0;
          }
          break;
        }
        case "knockdown": {
          if (c.stateFrame >= KNOCKDOWN_FRAMES) {
            c.state = "idle";
            c.stateFrame = 0;
          }
          break;
        }
        case "idle":
        case "move": {
          // Walk movement (guard is stationary — see the "guard" case).
          const cls = classById(p.classId) ?? firstClass();
          const next = stepMovement(
            { x: p.x, y: p.y, yaw: p.yaw, moving: p.moving },
            p.moveInput,
            FRAME_DT_S,
            cls.base.walkSpeedMps,
          );
          p.x = next.x;
          p.y = next.y;
          p.yaw = next.yaw;
          p.moving = next.moving;
          c.state = p.moving ? "move" : "idle";
          break;
        }
      }
    }
  }

  private stepMob(m: MobEntity): void {
    const c = m.combat;
    const d = m.data;
    if (c.state === "dead") {
      if (this.frame >= m.respawnFrame) {
        c.hp = c.maxHp;
        c.poise = c.poiseMax;
        c.state = "idle";
        c.stateFrame = 0;
        m.x = m.anchorX;
        m.y = m.anchorY;
        m.aiState = "patrol";
        m.targetId = null;
        m.taunt = null;
      }
      return;
    }
    c.stateFrame += 1;
    c.poise = Math.min(c.poiseMax, c.poise + (d.poiseRegenPerS / 60));
    if (this.frame - c.lastHitFrame > 120) c.comboHits = 0;
    // Stagger / knockdown pause the AI.
    if (c.state === "stagger" || c.state === "knockdown") {
      const total = c.state === "stagger" ? STAGGER_FRAMES : KNOCKDOWN_FRAMES;
      if (c.stateFrame >= total) {
        c.state = "idle";
        c.stateFrame = 0;
        m.aiState = "chase";
      }
      return;
    }
    // Target selection: an active taunt overrides everything.
    if (m.taunt && this.frame >= m.taunt.untilFrame) m.taunt = null;
    const taunted = m.taunt ? this.players.get(m.taunt.byPlayerId) : undefined;
    if (taunted && taunted.combat.state !== "dead") {
      m.targetId = taunted.id;
    } else {
      if (m.taunt) m.taunt = null;
      if (m.targetId === null) {
        m.targetId = this.nearestPlayer(m.x, m.y, d.aggroRadiusM);
      } else {
        const t = this.players.get(m.targetId);
        if (!t || t.combat.state === "dead" || Math.hypot(t.x - m.x, t.y - m.y) > d.leashRadiusM) {
          m.targetId = null;
        }
      }
    }
    const target = m.targetId !== null ? this.players.get(m.targetId) : undefined;

    switch (m.aiState) {
      case "patrol": {
        if (target) {
          m.aiState = "chase";
          break;
        }
        const distAnchor = Math.hypot(m.x - m.anchorX, m.y - m.anchorY);
        if (distAnchor > d.leashRadiusM) {
          this.moveMobToward(m, m.anchorX, m.anchorY, d.walkSpeedMps);
          if (Math.hypot(m.x - m.anchorX, m.y - m.anchorY) < 2) c.hp = c.maxHp;
        } else {
          if (Math.hypot(m.x - m.patrolX, m.y - m.patrolY) < 0.5) this.pickPatrolPoint(m);
          this.moveMobToward(m, m.patrolX, m.patrolY, d.walkSpeedMps);
        }
        break;
      }
      case "chase": {
        if (!target) {
          m.aiState = "patrol";
          break;
        }
        if (Math.hypot(target.x - m.x, target.y - m.y) <= d.attackRangeM) {
          m.aiState = "windup";
          c.stateFrame = 0;
          break;
        }
        this.moveMobToward(m, target.x, target.y, d.chaseSpeedMps);
        break;
      }
      case "windup": {
        if (!target) {
          m.aiState = "patrol";
          break;
        }
        m.yaw = Math.atan2(target.x - m.x, target.y - m.y);
        if (Math.hypot(target.x - m.x, target.y - m.y) > d.attackRangeM * 2.5) {
          m.aiState = "chase";
          break;
        }
        if (c.stateFrame >= d.attack.windup) {
          m.aiState = "attack";
          c.stateFrame = 0;
          m.hitDone = new Set();
        }
        break;
      }
      case "attack": {
        if (c.stateFrame < d.attack.active) {
          this.resolveHit(
            m, "mobatk",
            d.attack.shape.radius ?? 2, d.attack.shape.angle ?? 90,
            d.attack.mult, d.attack.poise, false, undefined, false,
          );
        }
        if (c.stateFrame >= d.attack.active + d.attack.recovery) {
          m.aiState = "recover";
          c.stateFrame = 0;
        }
        break;
      }
      case "recover": {
        if (c.stateFrame >= 12) {
          m.aiState = target ? "chase" : "patrol";
          c.stateFrame = 0;
        }
        break;
      }
      case "stagger":
      case "dead":
        break;
    }
  }

  get tickMsAvg(): number {
    return this.tickCount === 0 ? 0 : this.tickMsSum / this.tickCount;
  }

  /** p99 tick time over the last ≤600 ticks (ms). */
  tickMsP99(): number {
    if (this.tickMsSamples.length === 0) return 0;
    const sorted = [...this.tickMsSamples].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0;
  }

  snapshot(): EntityState[] {
    const players = [...this.players.values()].map((p) => ({
      id: p.id,
      kind: "player" as const,
      name: p.name,
      x: p.x,
      y: p.y,
      yaw: p.yaw,
      animState: animFor(p.combat.state),
      hpPct: Math.round((p.combat.hp / p.combat.maxHp) * 100),
      staminaPct: Math.round((p.combat.stamina / p.combat.maxStamina) * 100),
      manaPct: Math.round((p.combat.mana / p.combat.maxMana) * 100),
    }));
    const mobs = [...this.mobs.values()]
      .filter((m) => m.combat.state !== "dead")
      .map((m) => ({
        id: m.id,
        kind: "mob" as const,
        name: m.name,
        mobId: m.mobId,
        x: m.x,
        y: m.y,
        yaw: m.yaw,
        animState: mobAnim(m),
        hpPct: Math.round((m.combat.hp / m.combat.maxHp) * 100),
      }));
    return [...players, ...mobs];
  }
}

/** Mob animState: windup (9) is the telegraph the client renders as a red ring. */
function mobAnim(m: MobEntity): number {
  const c = m.combat;
  if (c.state === "stagger") return AnimState.stagger;
  if (c.state === "knockdown") return AnimState.knockdown;
  if (c.state === "dead") return AnimState.dead;
  if (m.aiState === "windup") return 9;
  if (m.aiState === "attack") return AnimState.attack;
  if (m.aiState === "chase" || m.aiState === "patrol") return AnimState.move;
  return AnimState.idle;
}
