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

  it("every class has exactly 1 skill, all provisional names flagged", () => {
    for (const c of CLASSES) {
      const skills = SKILLS.filter((s) => s.classId === c.id);
      expect(skills).toHaveLength(1);
      expect(skills[0].id).toBe(c.skillId);
      expect(skills[0].cooldownS).toBeGreaterThan(0);
      expect(skills[0].nameProvisional).toBe(true);
      for (const w of skills[0].active) {
        expect(w.to).toBeGreaterThan(w.from);
        if (w.shape.type !== "self") {
          expect(w.shape.radius).toBeGreaterThan(0);
          expect(w.shape.angle).toBeGreaterThan(0);
        }
      }
    }
    expect(skillById("espadachim_danca_laminas")?.kind).toBe("damage");
    expect(skillById("clerigo_luz_restauradora")?.kind).toBe("heal");
    expect(skillById("clerigo_luz_restauradora")?.active[0].hit.heal).toBe(40);
  });

  it("loads the lobo test mob with sane AI tuning", () => {
    const lobo = mobById("lobo");
    expect(lobo?.name).toBe("Lobo do Deserto");
    expect(lobo?.maxHp).toBe(60);
    expect(lobo?.aggroRadiusM).toBeGreaterThan(lobo?.attackRangeM ?? 0);
    expect(lobo?.chaseSpeedMps).toBeGreaterThan(lobo?.walkSpeedMps ?? 0);
    expect(lobo?.attack.windup).toBe(30);
    expect(MOBS).toHaveLength(1);
  });
});
