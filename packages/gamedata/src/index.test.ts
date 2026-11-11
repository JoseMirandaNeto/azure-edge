import { describe, expect, it } from "vitest";
import { CLASSES, MOBS, SKILLS, ZONE, classById, mobById, skillById } from "../src/index.js";

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

  it("has the 4 launch classes, Espadachim first for M1", () => {
    expect(CLASSES.map((c) => c.id)).toEqual(["espadachim", "guardiao", "atirador", "clerigo"]);
    expect(classById("espadachim")?.weapon).toBe("Duas espadas");
    expect(classById("guardiao")?.weapon).toBe("Escudo e arma");
    expect(classById("atirador")?.weapon).toBe("Espingarda");
    expect(classById("clerigo")?.role).toMatch(/cura/i);
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

  it("every class has exactly 1 skill, with the final names from Jose", () => {
    expect(SKILLS.map((s) => s.id)).toEqual([
      "espadachim_corte_crescente",
      "guardiao_provocacao",
      "atirador_disparo_rapido",
      "clerigo_bencao_solar",
    ]);
    for (const c of CLASSES) {
      const skills = SKILLS.filter((s) => s.classId === c.id);
      expect(skills).toHaveLength(1);
      expect(skills[0].id).toBe(c.skillId);
      expect(skills[0].cooldownS).toBeGreaterThan(0);
      for (const w of skills[0].active) {
        expect(w.to).toBeGreaterThan(w.from);
        if (w.shape.type !== "self") {
          expect(w.shape.radius).toBeGreaterThan(0);
          expect(w.shape.angle).toBeGreaterThan(0);
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
    const provocacao = skillById("guardiao_provocacao");
    expect(provocacao?.kind).toBe("taunt");
    expect(provocacao?.taunt?.radiusM).toBe(10);
    expect(provocacao?.taunt?.tempHp).toBe(30);
    const disparo = skillById("atirador_disparo_rapido");
    expect(disparo?.kind).toBe("damage");
    expect(disparo?.active).toHaveLength(2); // two shots
    const bencao = skillById("clerigo_bencao_solar");
    expect(bencao?.kind).toBe("buff");
    expect(bencao?.buff?.damageReduction).toBe(0.3);
    expect(bencao?.buff?.radiusM).toBe(6);
  });

  it("loads the M1 mobs: escorpião is the main test mob, múmia the tough one", () => {
    expect(MOBS.map((m) => m.id)).toEqual(["escorpiao", "formiga", "besouro", "mumia"]);
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
  });
});
