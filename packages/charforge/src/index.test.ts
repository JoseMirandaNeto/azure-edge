import { describe, expect, it } from "vitest";
import { generateGenome, validateGenome } from "../src/index.js";

describe("charforge v0", () => {
  it("same seed => identical genome", () => {
    expect(generateGenome(123456)).toEqual(generateGenome(123456));
  });
  it("different seeds => different genomes (usually)", () => {
    expect(generateGenome(1)).not.toEqual(generateGenome(2));
  });
  it("genomes validate and stay in adult morph range", () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const g = generateGenome(seed);
      expect(validateGenome(g)).toBe(true);
      expect(g.face.preset).not.toBe("youthful_adult");
    }
  });
});
