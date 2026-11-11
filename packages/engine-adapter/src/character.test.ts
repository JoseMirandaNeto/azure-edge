import { describe, expect, it } from "vitest";
import { applyClassPreset, generateGenome, HAIR_STYLES, OUTFIT_THEMES } from "@azure-edge/charforge";
import { buildCharacter, lodForDistance } from "../src/character.js";

describe("charforge mesh builder", () => {
  it("LOD0 is <= 60k tris and <= 6 draw calls", () => {
    const b = buildCharacter(generateGenome(123456), 0);
    expect(b.drawCalls).toBeLessThanOrEqual(6);
    expect(b.triangles).toBeLessThanOrEqual(60000);
    expect(b.triangles).toBeGreaterThan(500);
    expect(b.heightM).toBeGreaterThan(1.4);
    expect(b.heightM).toBeLessThan(2.2);
  });

  it("LODs shrink: tris strictly decrease 0 > 1 > 2 > 3", () => {
    const g = generateGenome(99);
    const tris = [0, 1, 2, 3].map((lod) => buildCharacter(g, lod as 0 | 1 | 2 | 3).triangles);
    expect(tris[0]).toBeGreaterThan(tris[1]!);
    expect(tris[1]).toBeGreaterThan(tris[2]!);
    expect(tris[2]).toBeGreaterThan(tris[3]!);
    expect(buildCharacter(g, 3).drawCalls).toBe(1);
  });

  it("same genome => same geometry (deterministic build)", () => {
    const a = buildCharacter(generateGenome(7), 0);
    const b = buildCharacter(generateGenome(7), 0);
    expect(a.triangles).toBe(b.triangles);
    const posOf = (b: { group: { children: unknown[] } }): Float32Array => {
      const mesh = b.group.children[0] as { geometry: { attributes: { position: { array: Float32Array } } } };
      return mesh.geometry.attributes.position.array;
    };
    const posA = posOf(a);
    const posB = posOf(b);
    expect(posA.length).toBe(posB.length);
    let sum = 0;
    for (let i = 0; i < posA.length; i += 1) sum += Math.abs(posA[i]! - posB[i]!);
    expect(sum).toBe(0);
  });

  it("200 seeds build without error", () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const b = buildCharacter(generateGenome(seed), 0);
      expect(b.drawCalls).toBe(4);
      expect(Number.isFinite(b.triangles)).toBe(true);
    }
  });

  it("all 6 hairs x 6 outfits x 2 genders x 4 classes build", () => {
    for (const hair of HAIR_STYLES) {
      for (const theme of OUTFIT_THEMES) {
        for (const gender of ["f", "m"] as const) {
          const base = generateGenome(5, { gender, hair: { style: hair }, outfit: { theme } });
          const b = buildCharacter(base, 0);
          expect(b.triangles).toBeGreaterThan(500);
          expect(b.triangles).toBeLessThanOrEqual(60000);
        }
      }
    }
    for (const classId of ["espadachim", "guardiao", "atirador", "clerigo"] as const) {
      const b = buildCharacter(applyClassPreset(generateGenome(5), classId), 0);
      expect(b.drawCalls).toBe(4);
    }
  });

  it("lodForDistance thresholds", () => {
    expect(lodForDistance(5)).toBe(0);
    expect(lodForDistance(20)).toBe(1);
    expect(lodForDistance(50)).toBe(2);
    expect(lodForDistance(100)).toBe(3);
  });
});
