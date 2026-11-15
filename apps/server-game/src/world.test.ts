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

  it("spawn ring never drifts: 60 sequential joins stay near the zone spawn", () => {
    // Regression: the old id-based ring grew 0.5 m per join forever, so
    // the 54th join of a city instance spawned inside the temple.
    const w = new ZoneWorld({ zoneId: "cidade_serket" });
    const spawn = w.zoneSpawn();
    for (let i = 0; i < 60; i += 1) {
      const p = w.addPlayer(`P${i}`);
      expect(Math.hypot(p.x - spawn.x, p.y - spawn.y)).toBeLessThanOrEqual(6);
      // Temple front in server coords: x in [-5.5, 5.5], y in [27.4, 32.8].
      expect(p.x > -5.5 && p.x < 5.5 && p.y > 27.4 && p.y < 32.8).toBe(false);
      w.removePlayer(p.id);
    }
  });

  it("spawn ring stays bounded with 60 simultaneous players", () => {
    // Open zones cap at 256 players, so the ring must wrap — a radius
    // based on the present-count alone would still reach the temple.
    const w = new ZoneWorld({ zoneId: "cidade_serket" });
    const spawn = w.zoneSpawn();
    const players = [];
    for (let i = 0; i < 60; i += 1) players.push(w.addPlayer(`P${i}`));
    for (const p of players) {
      expect(Math.hypot(p.x - spawn.x, p.y - spawn.y)).toBeLessThanOrEqual(6);
    }
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
    // Warm up (JIT/GC) before measuring: the budget in AGENTS.md §6 is p99.
    for (let i = 0; i < 20; i += 1) w.step();
    w.resetTickStats();
    // 400 ticks: p99 tolerates a few slow ticks from parallel-test CPU
    // contention on this shared 1.5-CPU VM; the sim itself is ~0.1 ms.
    for (let i = 0; i < 400; i += 1) w.step();
    expect(w.tickMsP99()).toBeLessThan(10);
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

  it("escorpião patrulha, persegue, telegrafa (windup) e ataca o jogador", () => {
    const w = new ZoneWorld();
    const p = w.addPlayer("A");
    p.x = 0;
    p.y = 0;
    const mob = w.spawnMob("escorpiao", 0, 10);
    expect(mob).not.toBeNull();
    let sawWindup = false;
    let sawChase = false;
    for (let i = 0; i < 60; i += 1) {
      w.step();
      if (mob?.aiState === "chase") sawChase = true;
      if (w.snapshot().some((e) => e.id === mob?.id && e.animState === 9)) sawWindup = true;
      if (p.combat.hp < 100) break;
    }
    expect(sawChase).toBe(true);
    expect(mob?.y).toBeLessThan(10); // moved toward the player
    expect(sawWindup).toBe(true); // telegraphed attack (animState 9)
    expect(p.combat.hp).toBeLessThan(100); // the attack landed
  });

  it("escorpião morre para os ataques do jogador e renasce após 8 s", () => {
    const w = new ZoneWorld();
    const a = w.addPlayer("A");
    a.x = 0;
    a.y = 0;
    a.yaw = 0;
    const mob = w.spawnMob("escorpiao", 0, 3);
    expect(mob).not.toBeNull();
    let seq = 1;
    const attackLoop = (n: number) => {
      for (let i = 0; i < n; i += 1) {
        a.combat.hp = a.combat.maxHp; // keep the tester alive
        // Face the mob every tick: the attack lunge moves the player forward,
        // so without re-aiming the mob ends up behind the swing arc.
        if (mob) a.yaw = Math.atan2(mob.x - a.x, mob.y - a.y);
        if (a.combat.state === "idle" || a.combat.state === "move") {
          w.applyInput(a.id, input(seq, 1, 0, a.yaw));
          seq += 1;
        }
        w.step();
        if (mob?.combat.state === "dead") break;
      }
    };
    attackLoop(200);
    expect(mob?.combat.state).toBe("dead");
    expect(w.drainEvents().some((e) => e.kind === "kill" && e.targetId === mob?.id)).toBe(true);
    expect(w.snapshot().some((e) => e.id === mob?.id)).toBe(false); // dead mobs leave the snapshot
    for (let i = 0; i < 170; i += 1) w.step(); // 510 frames > 480 (8 s)
    expect(mob?.combat.state).not.toBe("dead");
    expect(mob?.combat.hp).toBe(60);
    expect(w.snapshot().some((e) => e.id === mob?.id)).toBe(true);
  });

  it("taunt (Provocação) redireciona o mob para o jogador que provocou", () => {
    const w = new ZoneWorld();
    const a = w.addPlayer("A");
    a.x = 0;
    a.y = 0;
    const b = w.addPlayer("B");
    b.x = 20;
    b.y = 20;
    const mob = w.spawnMob("escorpiao", 0, 10);
    for (let i = 0; i < 10; i += 1) w.step();
    expect(mob?.targetId).toBe(a.id); // aggro on the near player first
    w.tauntMobs(b.id, 30, 5);
    for (let i = 0; i < 10; i += 1) w.step();
    expect(mob?.targetId).toBe(b.id); // taunt overrides proximity
    expect(mob?.x).toBeGreaterThan(0); // walking toward B
    for (let i = 0; i < 110; i += 1) w.step(); // taunt (5 s) expires
    // After expiry the mob keeps B only because B is now the nearest player
    // (correct AI). Move B far away: the mob must drop the target.
    b.x = 50;
    b.y = 50;
    for (let i = 0; i < 5; i += 1) w.step();
    expect(mob?.targetId).not.toBe(b.id);
  });

  it("tick com 30 mobs fica abaixo do orçamento de 10 ms p99", () => {
    const w = new ZoneWorld();
    const a = w.addPlayer("A");
    w.addPlayer("B");
    w.spawnMobs("escorpiao", 30);
    let seq = 1;
    for (let i = 0; i < 20; i += 1) w.step(); // warm-up
    w.resetTickStats();
    for (let i = 0; i < 400; i += 1) {
      if (a.combat.state === "idle" || a.combat.state === "move") {
        w.applyInput(a.id, input(seq, 1));
        seq += 1;
      }
      w.step();
    }
    console.log(
      `tick 30 mobs: avg ${w.tickMsAvg.toFixed(3)} ms, p99 ${w.tickMsP99().toFixed(3)} ms, max ${w.tickMsMax.toFixed(3)} ms`,
    );
    expect(w.tickMsP99()).toBeLessThan(10);
  });
});

describe("vertical slice: classes, armor, instances, dungeons", () => {
  it("class select gives distinct base stats (tank / ranged / support / melee)", () => {
    const w = new ZoneWorld();
    const esp = w.addPlayer("E", { classId: "espadachim" });
    const gue = w.addPlayer("G", { classId: "guerreiro" });
    const ati = w.addPlayer("A", { classId: "atirador" });
    const cur = w.addPlayer("C", { classId: "curandeiro" });
    expect(gue.combat.maxHp).toBeGreaterThan(esp.combat.maxHp); // tank
    expect(ati.atk).toBeGreaterThan(cur.atk); // ranged damage
    expect(cur.combat.maxMana).toBeGreaterThan(gue.combat.maxMana); // support
    expect(w.addPlayer("X", { classId: "inexistente" }).classId).toBe("espadachim"); // invalid -> default
  });

  it("armor set grants its documented bonus; wrong-class or unknown armor is ignored", () => {
    const w = new ZoneWorld();
    const a = w.addPlayer("A", { classId: "espadachim", armorId: "espadachim_dourada" });
    expect(a.combat.maxHp).toBe(120); // 100 + 20
    expect(a.atk).toBe(24); // 10 + 14
    expect(a.armorId).toBe("espadachim_dourada");
    const b = w.addPlayer("B", { classId: "espadachim", armorId: "guerreiro_solar" });
    expect(b.combat.maxHp).toBe(100); // wrong class: ignored
    expect(b.armorId).toBeNull();
    const c = w.addPlayer("C", { classId: "curandeiro", armorId: "curandeiro_solar" });
    expect(c.combat.maxMana).toBe(240); // 140 + 100
  });

  it("8-player instance cap: the 9th join is refused", () => {
    const w = new ZoneWorld({ zoneId: "tumbas", maxPlayers: 8 });
    for (let i = 0; i < 8; i += 1) w.addPlayer(`P${i}`);
    expect(w.isFull()).toBe(true);
    expect(() => w.addPlayer("P9")).toThrow(/instance full/);
    w.removePlayer(1);
    expect(w.isFull()).toBe(false);
    expect(w.addPlayer("P9").name).toBe("P9"); // a freed slot admits again
  });

  it("Guerreiro Provocação (Q): taunts the mob + grants 30 temp HP that absorbs damage", () => {
    const w = new ZoneWorld();
    const a = w.addPlayer("A"); // espadachim at (0,0)
    a.x = 0;
    a.y = 0;
    const b = w.addPlayer("B", { classId: "guerreiro" });
    b.x = 20;
    b.y = 20;
    const mob = w.spawnMob("escorpiao", 0, 8);
    for (let i = 0; i < 10; i += 1) w.step();
    expect(mob?.targetId).toBe(a.id); // aggro on the near player first
    b.x = 0;
    b.y = 4; // inside the 10 m taunt radius
    w.applyInput(b.id, input(1, 0, 1)); // Q = Provocação
    for (let i = 0; i < 8; i += 1) w.step();
    expect(b.combat.tempHp).toBe(30);
    expect(b.combat.mana).toBeLessThan(60); // cost 20
    expect(mob?.targetId).toBe(b.id); // taunt overrides proximity
    // Temp HP absorbs the next hit: A attacks B point-blank.
    a.x = 0;
    a.y = 2;
    a.yaw = 0; // facing B at (0,4)
    b.combat.state = "idle";
    w.applyInput(a.id, input(2, 1));
    for (let i = 0; i < 6; i += 1) w.step();
    expect(b.combat.hp).toBe(b.combat.maxHp); // no real damage
    expect(b.combat.tempHp).toBeLessThan(30); // absorbed part of the hit
  });

  it("Atirador Disparo Rápido (Q): two shots, two hits (two active windows)", () => {
    const w = new ZoneWorld();
    const a = w.addPlayer("A", { classId: "atirador" });
    const b = w.addPlayer("B");
    a.x = 0;
    a.y = 0;
    a.yaw = 0;
    b.x = 0;
    b.y = 2;
    w.applyInput(a.id, input(1, 0, 1)); // Q = Disparo Rápido
    for (let i = 0; i < 8; i += 1) w.step();
    const hits = w.drainEvents().filter((e) => e.kind === "hit" && e.targetId === b.id);
    expect(hits).toHaveLength(2);
    expect(b.combat.hp).toBeLessThan(85); // ~10 dmg per shot
    expect(a.combat.mana).toBeLessThan(80); // cost 15
  });

  it("Curandeiro Bênção Solar (Q): heals 20 + 30% protection buff that expires", () => {
    const w = new ZoneWorld();
    const c = w.addPlayer("C", { classId: "curandeiro" });
    c.combat.hp = 50;
    w.applyInput(c.id, input(1, 0, 1)); // Q = Bênção Solar
    for (let i = 0; i < 8; i += 1) w.step();
    expect(c.combat.hp).toBe(70); // +20 heal
    expect(c.combat.buffDamageReduction).toBe(0.3);
    expect(c.combat.buffUntilFrame).toBeGreaterThan(w.frame);
    expect(w.drainEvents().some((e) => e.kind === "heal" && e.amount === 20)).toBe(true);
    // Buffed hit: a basic attack deals at most 9 (crit, buffed) instead of up to 13.
    const a = w.addPlayer("A");
    a.x = 0;
    a.y = 0;
    a.yaw = 0;
    c.x = 0;
    c.y = 2;
    c.combat.state = "idle";
    w.applyInput(a.id, input(2, 1));
    for (let i = 0; i < 6; i += 1) w.step();
    expect(70 - c.combat.hp).toBeLessThanOrEqual(9);
    // After 8 s the buff is gone.
    for (let i = 0; i < 170; i += 1) w.step();
    expect(c.combat.buffDamageReduction).toBe(0);
  });

  it("dungeon mobs scale with level; spawnDungeonMobs includes the boss", () => {
    const w = new ZoneWorld({ zoneId: "tumbas", maxPlayers: 8 });
    const m12 = w.spawnMob("mumia", 0, 0, 12);
    expect(m12?.combat.maxHp).toBe(318); // 120 * (1 + 0.15 * 11)
    expect(m12?.level).toBe(12);
    const m1 = w.spawnMob("mumia", 5, 5, 1);
    expect(m1?.combat.maxHp).toBe(120); // level 1 = base stats
    const spawned = w.spawnDungeonMobs("tumbas");
    expect(spawned).toHaveLength(11); // 4 múmias + 4 formigas + 2 besouros + boss
    const boss = spawned.find((m) => m.name.includes("Neferet"));
    expect(boss?.mobId).toBe("neferet");
    expect(boss?.level).toBe(12);
    expect(boss?.combat.maxHp).toBeGreaterThan(300);
    const templo = new ZoneWorld({ zoneId: "templo", maxPlayers: 8 });
    const serket = templo.spawnDungeonMobs("templo").find((m) => m.mobId === "serket");
    expect(serket?.name).toMatch(/Serket/);
    expect(serket?.level).toBe(20);
  });

  it("snapshot carries class/armor/gender for players and level for mobs", () => {
    const w = new ZoneWorld();
    const p = w.addPlayer("A", { classId: "guerreiro", armorId: "guerreiro_solar", gender: "m" });
    const mob = w.spawnMob("escorpiao", 3, 3, 5);
    const snap = w.snapshot();
    const me = snap.find((e) => e.id === p.id);
    expect(me?.classId).toBe("guerreiro");
    expect(me?.armorId).toBe("guerreiro_solar");
    expect(me?.gender).toBe("m");
    expect(snap.find((e) => e.id === mob?.id)?.level).toBe(5);
  });
});
