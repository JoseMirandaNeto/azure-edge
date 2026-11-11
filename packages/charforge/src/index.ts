import { hashSeed, sfc32 } from "@azure-edge/shared";

/**
 * CharForge v0 — M0 stub (full pipeline is M2, docs/CHARACTER_PIPELINE.md).
 * Deterministic genome generation from a seed. Adults only: presets are
 * clamped to adult proportions; there is no child/youth preset by design.
 */
export interface CharacterGenome {
  v: 1;
  seed: number;
  gender: "f" | "m";
  morphs: { height: number; shoulders: number; waist: number; hips: number };
  face: { eyeSize: number; jaw: number; preset: "soft" | "sharp" | "mature" };
  hair: { style: string; color: string };
  outfit: { theme: string; palette: string[] };
}

const HAIR_STYLES = ["longBraid_03", "ponytail_01", "short_02", "bun_04"] as const;
const HAIR_COLORS = ["#1B1B2F", "#3A2A1A", "#6C8CFF", "#C8102E"] as const;
const OUTFIT_THEMES = ["hanbok_armor", "cheongsam_blade", "ninja_lite", "noble_robe"] as const;

function clampAdult(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

export function generateGenome(seed: number): CharacterGenome {
  const rng = sfc32(seed >>> 0);
  const pick = <T>(arr: readonly T[]): T => {
    const v = arr[Math.floor(rng() * arr.length)];
    if (v === undefined) throw new Error("empty pick");
    return v;
  };
  return {
    v: 1,
    seed: seed >>> 0,
    gender: rng() < 0.5 ? "f" : "m",
    morphs: {
      height: clampAdult(rng() * 0.6 - 0.3),
      shoulders: clampAdult(rng() * 0.6 - 0.3),
      waist: clampAdult(rng() * 0.6 - 0.3),
      hips: clampAdult(rng() * 0.6 - 0.3),
    },
    face: {
      eyeSize: clampAdult(rng() * 0.6 - 0.1),
      jaw: clampAdult(rng() * 0.6 - 0.3),
      preset: pick(["soft", "sharp", "mature"] as const),
    },
    hair: { style: pick(HAIR_STYLES), color: pick(HAIR_COLORS) },
    outfit: {
      theme: pick(OUTFIT_THEMES),
      palette: ["#0B3954", "#C8102E", "#D4AF37"],
    },
  };
}

export function generateGenomeFromName(name: string): CharacterGenome {
  return generateGenome(hashSeed(name));
}

/** Validate a genome: version, ranges, adult-only presets. */
export function validateGenome(g: unknown): g is CharacterGenome {
  if (typeof g !== "object" || g === null) return false;
  const genome = g as Partial<CharacterGenome>;
  if (genome.v !== 1 || typeof genome.seed !== "number") return false;
  const m = genome.morphs;
  if (!m) return false;
  return [m.height, m.shoulders, m.waist, m.hips].every(
    (v) => typeof v === "number" && Number.isFinite(v) && v >= -1 && v <= 1,
  );
}
