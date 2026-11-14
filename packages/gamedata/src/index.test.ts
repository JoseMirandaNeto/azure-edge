import { describe, expect, it } from "vitest";
import {
  ARMORS,
  CITY,
  CLASSES,
  DUNGEONS,
  MOBS,
  SKILLS,
  ZONE,
  ZONES,
  armorById,
  armorsForClass,
  classById,
  dungeonById,
  mobById,
  skillById,
  zoneById,
} from "../src/index.js";

describe("gamedata", () => {
  it("loads the Dunas de Serket desert arena", () => {
    expect(ZONE.zone.id).toBe("dunas_serket");
    expect(ZONE.zone.subArea).toBe("Oásis dos Nômades");
    expect(ZONE.biome).toBe("desert");
    expect(ZONE.player.walkSpeedMps).toBeGreaterThan(0);
    expect(ZONE.player.maxHp).toBe(100);
    expect(ZONE.camera.distanceM).toBeGreaterThan(0);
    expect(ZONE.props.reduce((n, p) => n + p.count, 0)).toBeGreaterThan(0);
  });

  it("has the 4 launch classes with the 2026-11-13 names (Guerreiro, Curandeiro)", () => {
    expect(CLASSES.map((c) => c.id)).toEqual(["espadachim", "guerreiro", "atirador", "curandeiro"]);
    expect(classById("espadachim")?.weapon).toBe("Duas espadas");
    expect(classById("guerreiro")?.weapon).toBe("Escudo e arma");
    expect(classById("atirador")?.weapon).toBe("Espingarda");
    expect(classById("curandeiro")?.role).toMatch(/cura/i);
    // No trace of the old names.
    expect(classById("guardiao")).toBeUndefined();
    expect(classById("clerigo")).toBeUndefined();
    // Per-level growth is defined for every class (lv1 base + growth * (level - 1)).
    for (const c of CLASSES) {
      expect(c.growthPerLevel?.maxHp).toBeGreaterThan(0);
      expect(c.growthPerLevel?.atk).toBeGreaterThan(0);
    }
    expect(classById("guerreiro")?.growthPerLevel?.maxHp).toBeGreaterThan(
      classById("espadachim")?.growthPerLevel?.maxHp ?? 0,
    ); // tank gains more HP
  });

  it("Espadachim chain matches the COMBAT_SPEC frame table", () => {
    const chain = classById("espadachim")?.basicChain;
    expect(chain).toHaveLength(4);
    expect(chain?.map((h) => h.startup)).toEqual([7, 6, 9, 14]);
    expect(chain?.map((h) => h.active)).toEqual([4, 4, 5, 6]);
    expect(chain?.map((h) => h.mult)).toEqual([0.9, 1.0, 1.3, 2.0]);
    expect(chain?.[3].finisher).toBe(true);
    expect(chain?.[0].cancelFrom).toBe(10);
  });

  it("every class has exactly 4 skills, keeping the M1 signature skills", () => {
    expect(SKILLS).toHaveLength(16);
    for (const c of CLASSES) {
      const skills = SKILLS.filter((s) => s.classId === c.id);
      expect(skills).toHaveLength(4);
      expect(skills.map((s) => s.id)).toContain(c.skillId);
      for (const s of skills) {
        expect(s.cooldownS).toBeGreaterThan(0);
        expect(s.description).toBeTruthy();
        expect(s.animation).toBeTruthy();
        for (const w of s.active) {
          expect(w.to).toBeGreaterThan(w.from);
          if (w.shape.type !== "self") {
            expect(w.shape.radius).toBeGreaterThan(0);
            expect(w.shape.angle).toBeGreaterThan(0);
          }
        }
      }
    }
    const corte = skillById("espadachim_corte_crescente");
    expect(corte?.name).toBe("Corte Crescente");
    expect(corte?.kind).toBe("damage");
    expect(corte?.active[0].shape).toEqual({ angle: 140, radius: 3.2, type: "arc" });
    expect(corte?.active[0].hit.mult).toBe(2.2);
    expect(corte?.superArmor).toEqual({ from: 8, to: 18 });
    expect(corte?.nameProvisional).toBeUndefined(); // final name
    const provocacao = skillById("guerreiro_provocacao");
    expect(provocacao?.kind).toBe("taunt");
    expect(provocacao?.taunt?.radiusM).toBe(10);
    expect(provocacao?.taunt?.tempHp).toBe(30);
    const disparo = skillById("atirador_disparo_rapido");
    expect(disparo?.kind).toBe("damage");
    expect(disparo?.active).toHaveLength(2); // two shots
    const bencao = skillById("curandeiro_bencao_solar");
    expect(bencao?.kind).toBe("buff");
    expect(bencao?.buff?.damageReduction).toBe(0.3);
    expect(bencao?.buff?.radiusM).toBe(6);
    expect(bencao?.active[0].hit.heal).toBe(20); // buff + small heal on cast
    // New kinds: heal + mobility.
    expect(skillById("curandeiro_luz_curativa")?.kind).toBe("heal");
    expect(skillById("curandeiro_luz_curativa")?.active[0].hit.heal).toBe(60);
    expect(skillById("guerreiro_investida_do_touro")?.kind).toBe("mobility");
    expect(skillById("atirador_recuo_tatico")?.kind).toBe("mobility");
    // Ultimates cost the most.
    expect(skillById("espadachim_julgamento_duplo")?.cooldownS).toBe(30);
  });

  it("loads the M1 mobs plus the lv11-20 field mobs and the 2 dungeon bosses", () => {
    expect(MOBS.map((m) => m.id)).toEqual([
      "escorpiao",
      "formiga",
      "besouro",
      "mumia",
      "escorpiao_alfa",
      "mumia_ancia",
      "cultista_serket",
      "golem_areia",
      "neferet",
      "serket",
    ]);
    const esc = mobById("escorpiao");
    expect(esc?.name).toBe("Escorpião do Deserto");
    expect(esc?.maxHp).toBe(60);
    expect(esc?.aggroRadiusM).toBeGreaterThan(esc?.attackRangeM ?? 0);
    expect(esc?.chaseSpeedMps).toBeGreaterThan(esc?.walkSpeedMps ?? 0);
    expect(esc?.attack.windup).toBe(30);
    const mumia = mobById("mumia");
    expect(mumia?.maxHp).toBe(120);
    expect(mumia?.walkSpeedMps).toBeLessThan(esc?.walkSpeedMps ?? 0); // slower, tougher
    expect(mobById("besouro")?.def).toBeGreaterThan(0); // armored
    for (const m of MOBS) {
      expect(m.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(m.scale).toBeGreaterThan(0);
    }
    const serket = mobById("serket");
    expect(serket?.name).toMatch(/Serket/);
    expect(serket?.maxHp).toBeGreaterThan(mobById("neferet")?.maxHp ?? 0);
    expect(mobById("golem_areia")?.def).toBe(10);
  });

  it("has 3 armor sets per class (tiers 1-3, lv 1/8/16) with distinct visuals", () => {
    expect(ARMORS).toHaveLength(12);
    for (const c of CLASSES) {
      const sets = armorsForClass(c.id);
      expect(sets).toHaveLength(3);
      expect(sets.map((a) => a.tier)).toEqual([1, 2, 3]);
      expect(sets.map((a) => a.minLevel)).toEqual([1, 8, 16]);
      for (const a of sets) {
        expect(a.colors.primary).toMatch(/^#[0-9a-f]{6}$/i);
        expect(a.aura).toMatch(/^#[0-9a-f]{6}$/i);
        expect(a.setBonus).toBeTruthy();
        expect(a.material).toBeTruthy();
      }
    }
    expect(armorById("espadachim_dourada")?.bonus.atk).toBe(14);
    expect(armorById("guerreiro_solar")?.bonus.def).toBe(12);
    expect(armorById("curandeiro_solar")?.bonus.mana).toBe(100);
  });

  it("has 2 dungeons, both capped at 8 players, with boss encounters, loot and lockout", () => {
    expect(DUNGEONS).toHaveLength(2);
    for (const d of DUNGEONS) {
      expect(d.maxPlayers).toBe(8);
      expect(d.lockoutHours).toBeGreaterThan(0);
      expect(d.encounters?.filter((e) => e.kind === "boss")).toHaveLength(1);
      expect(d.encounters?.length).toBeGreaterThanOrEqual(4);
      expect(d.loot?.length).toBeGreaterThan(0);
      for (const e of d.encounters ?? []) {
        expect(e.mechanics.length).toBeGreaterThan(0);
      }
      expect(dungeonById(d.id)?.boss.mobId).toBeTruthy();
    }
    const tumbas = dungeonById("tumbas");
    expect(tumbas?.levelMin).toBe(5);
    expect(tumbas?.levelMax).toBe(12);
    expect(tumbas?.boss.mobId).toBe("neferet");
    expect(tumbas?.lockoutHours).toBe(8);
    const templo = dungeonById("templo");
    expect(templo?.levelMin).toBe(13);
    expect(templo?.levelMax).toBe(20);
    expect(templo?.boss.mobId).toBe("serket");
    expect(templo?.lockoutHours).toBe(24);
    expect(templo?.boss.name).toMatch(/Serket/);
  });

  it("zones include the starter city Cidade de Serket (safe, lv 1-20)", () => {
    const city = zoneById("cidade_serket");
    expect(city?.safe).toBe(true);
    expect(city?.levelMin).toBe(1);
    expect(city?.levelMax).toBe(20);
    expect(city?.biome).toBe("meadow");
    expect(city?.npcs?.map((n) => n.name)).toContain("Ferreiro Kael");
    expect(city?.portals?.map((p) => p.target)).toContain("tumbas");
    expect(ZONES.map((z) => z.zone.id)).toContain("dunas_serket");
  });

  it("city data: 5 districts, 8 NPCs, 12 chained quests lv 1-20, mob bands by level", () => {
    expect(CITY.id).toBe("cidade_serket");
    expect(CITY.levelMin).toBe(1);
    expect(CITY.levelMax).toBe(20);
    expect(CITY.lore).toMatch(/Fenda Azure/);
    expect(CITY.districts).toHaveLength(5);
    expect(CITY.npcs).toHaveLength(8);
    expect(CITY.quests).toHaveLength(12);
    const levels = CITY.quests.map((q) => q.level);
    expect(levels).toEqual([...levels].sort((a, b) => a - b)); // ascending
    expect(Math.min(...levels)).toBe(1);
    expect(Math.max(...levels)).toBe(18);
    for (const q of CITY.quests) {
      expect(CITY.npcs.some((n) => n.id === q.giver)).toBe(true);
      if (q.nextQuestId !== undefined) {
        expect(CITY.quests.some((n) => n.id === q.nextQuestId)).toBe(true);
      }
      expect(q.rewards.xp).toBeGreaterThan(0);
    }
    // Chain is one line: q01 -> ... -> q12.
    expect(CITY.quests[0].id).toBe("q01_despertar_lamina");
    expect(CITY.quests[11].id).toBe("q12_fenda_abre");
    expect(CITY.quests[11].nextQuestId).toBeUndefined();
    expect(CITY.quests[11].objective.type).toBe("boss");
    expect(CITY.quests[11].objective.target).toBe("serket");
    for (const b of CITY.mobBands) {
      for (const mobId of b.mobIds) {
        expect(mobById(mobId)).toBeTruthy();
      }
    }
    expect(CITY.mobBands.map((b) => b.minLevel)).toEqual([1, 5, 8, 11, 16]);
  });
});
