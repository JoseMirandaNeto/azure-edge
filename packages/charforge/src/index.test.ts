import { describe, expect, it } from "vitest";
import {
  BODY_MORPH_KEYS,
  FACE_MORPH_KEYS,
  HAIR_STYLES,
  OUTFIT_THEMES,
  generateGenome,
  generateGenomeFromName,
  validateGenome,
} from "../src/index.js";

describe("charforge v1", () => {
  it("same seed => identical genome", () => {
    expect(generateGenome(123456)).toEqual(generateGenome(123456));
  });

  it("different seeds => different genomes (usually)", () => {
    expect(generateGenome(1)).not.toEqual(generateGenome(2));
  });

  it("has 20 body + 20 face morphs, 6 hairs, 6 outfits", () => {
    expect(BODY_MORPH_KEYS).toHaveLength(20);
    expect(FACE_MORPH_KEYS).toHaveLength(20);
    expect(HAIR_STYLES).toHaveLength(6);
    expect(OUTFIT_THEMES).toHaveLength(6);
    const g = generateGenome(7);
    expect(Object.keys(g.body)).toHaveLength(20);
    expect(Object.keys(g.face).filter((k) => k !== "preset")).toHaveLength(20);
  });

  it("1000 seeds: no error, all validate, adults only", () => {
    for (let seed = 0; seed < 1000; seed += 1) {
      const g = generateGenome(seed);
      expect(validateGenome(g)).toBe(true);
      for (const k of BODY_MORPH_KEYS) {
        expect(g.body[k]).toBeGreaterThanOrEqual(-1);
        expect(g.body[k]).toBeLessThanOrEqual(1);
      }
      for (const k of FACE_MORPH_KEYS) {
        expect(g.face[k]).toBeGreaterThanOrEqual(-1);
        expect(g.face[k]).toBeLessThanOrEqual(1);
      }
      expect(g.face.preset).not.toBe("youthful_adult");
      expect(HAIR_STYLES).toContain(g.hair.style);
      expect(OUTFIT_THEMES).toContain(g.outfit.theme);
      expect(g.classId).toBe("espadachim");
    }
  });

  it("overrides (locks) survive a reroll", () => {
    const g = generateGenome(42, { gender: "f", body: { height: 0.8 }, hair: { style: "bun_04" } });
    expect(g.gender).toBe("f");
    expect(g.body.height).toBe(0.8);
    expect(g.hair.style).toBe("bun_04");
    expect(validateGenome(g)).toBe(true);
  });

  it("generateGenomeFromName is deterministic", () => {
    expect(generateGenomeFromName("Jose")).toEqual(generateGenomeFromName("Jose"));
  });

  it("rejects invalid genomes", () => {
    const good = generateGenome(1);
    expect(validateGenome({ ...good, v: 2 })).toBe(false);
    expect(validateGenome({ ...good, gender: "n" })).toBe(false);
    expect(validateGenome({ ...good, body: { ...good.body, height: 2 } })).toBe(false);
    expect(validateGenome({ ...good, hair: { ...good.hair, style: "mohawk" } })).toBe(false);
    expect(validateGenome({ ...good, face: { ...good.face, preset: "youthful_adult" } })).toBe(false);
    expect(validateGenome({ ...good, outfit: { ...good.outfit, palette: ["#fff"] } })).toBe(false);
    expect(validateGenome(null)).toBe(false);
    expect(validateGenome("nope")).toBe(false);
  });
});
