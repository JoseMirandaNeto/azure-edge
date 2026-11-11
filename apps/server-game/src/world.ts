import { CLASSES, ZONE, classById, skillById, type ClassData } from "@azure-edge/gamedata";
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
  private nextId = 1;
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

  private stagger(p: PlayerEntity): void {
    const c = p.combat;
    if (c.state === "dead") return;
    c.state = "stagger";
    c.stateFrame = 0;
    c.guardSinceFrame = null;
  }

  private knockdown(p: PlayerEntity): void {
    const c = p.combat;
    if (c.state === "dead") return;
    c.state = "knockdown";
    c.stateFrame = 0;
    c.guardSinceFrame = null;
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
   * Resolve one hit window against every other living player in the arc.
   * Each target is hit at most once per window (windowKey). Mobs join the
   * target list in the next step; PvP uses the same rules.
   */
  private resolveHit(
    sourceId: number,
    windowKey: string,
    sx: number,
    sy: number,
    syaw: number,
    atk: number,
    radius: number,
    angleDeg: number,
    mult: number,
    poiseDmg: number,
    finisher: boolean,
    effect?: "knockback" | "knockdown",
  ): void {
    for (const t of this.players.values()) {
      if (t.id === sourceId || t.combat.state === "dead") continue;
      const key = `${windowKey}:${t.id}`;
      const attacker = this.players.get(sourceId);
      if (!attacker || attacker.hitDone.has(key)) continue;
      if (!arcContains(sx, sy, syaw, t.x, t.y, { type: "arc", radius, angle: angleDeg })) continue;
      attacker.hitDone.add(key);
      this.applyHitToPlayer(sourceId, sx, sy, syaw, atk, mult, poiseDmg, finisher, effect, t);
    }
  }

  private applyHitToPlayer(
    sourceId: number,
    sx: number,
    sy: number,
    syaw: number,
    atk: number,
    mult: number,
    poiseDmg: number,
    finisher: boolean,
    effect: "knockback" | "knockdown" | undefined,
    t: PlayerEntity,
  ): void {
    const c = t.combat;
    // Dodge i-frames: a hit in the perfect window (f3–f8) is a perfect dodge.
    if (c.state === "dodge" && dodgeIsIframes(c.stateFrame)) {
      if (dodgeIsPerfectWindow(c.stateFrame)) {
        c.mana = Math.min(c.maxMana, c.mana + PERFECT_DODGE_MANA);
        this.emit({ kind: "perfect", sourceId, targetId: t.id, amount: 0, crit: false, x: t.x, y: t.y });
      }
      return;
    }
    // Guard: frontal only. First 8 frames of the guard = parry.
    let dmgMult = 1;
    let finalPoise = poiseDmg;
    if (c.state === "guard" && isInFront(t.x, t.y, t.yaw, sx, sy)) {
      const guardAge = this.frame - (c.guardSinceFrame ?? this.frame);
      if (guardAge <= PARRY_WINDOW_FRAMES) {
        this.emit({ kind: "parry", sourceId, targetId: t.id, amount: 0, crit: false, x: t.x, y: t.y });
        const attacker = this.players.get(sourceId);
        if (attacker) this.stagger(attacker);
        return;
      }
      dmgMult = 1 - GUARD_DAMAGE_REDUCTION;
      finalPoise = poiseDmg * dmgMult;
    }
    const crit = rollCrit(this.rng, BASE_CRIT_CHANCE);
    const bonus = comboStateBonus(c.state, c.comboHits);
    const dmg = Math.max(1, Math.round(damageAmount(atk, mult, t.def, crit, rollVariance(this.rng), bonus) * dmgMult));
    c.hp = Math.max(0, c.hp - dmg);
    c.comboHits += 1;
    c.lastHitFrame = this.frame;
    this.emit({ kind: "hit", sourceId, targetId: t.id, amount: dmg, crit, finisher, x: t.x, y: t.y });
    if (effect === "knockback") this.pushBack(t, syaw, 0.6);
    if (applyPoise(c, finalPoise, this.frame, this.targetSuperArmor(t)) === "stagger") this.stagger(t);
    if (finisher && c.state !== "dead") this.knockdown(t);
    if (effect === "knockdown" && c.state !== "dead") this.knockdown(t);
    if (c.hp <= 0) {
      c.hp = 0;
      c.state = "dead";
      c.stateFrame = 0;
      t.deadUntilFrame = this.frame + 300; // respawn after 5 s
      this.emit({ kind: "kill", sourceId, targetId: t.id, amount: 0, crit, x: t.x, y: t.y });
    }
  }

  private pushBack(t: PlayerEntity, yaw: number, distM: number): void {
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
            this.resolveHit(p.id, `atk${c.chainIndex}`, p.x, p.y, p.yaw, p.atk, 2.5, 140, hit.mult, hit.poise, hit.finisher === true);
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
                  p.id, `sk${w.from}`, p.x, p.y, p.yaw, p.atk,
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
    return [...this.players.values()].map((p) => ({
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
  }
}
