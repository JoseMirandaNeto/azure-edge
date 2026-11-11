import { hashSeed, sfc32 } from "@azure-edge/shared";

/**
 * CharForge v1 — M2 genome (docs/CHARACTER_PIPELINE.md).
 * Deterministic genome from a seed. Adults only: every morph is clamped to
 * adult proportions, there is no youth/child preset, and `validateGenome`
 * rejects anything outside the adult ranges.
 *
 * Morphs are named -1..1 values (0 = base mesh). The mesh builder in
 * engine-adapter interprets them as per-part scale/offset transforms.
 */

// --- Catalogues (the "kit"): 6 hair styles, 6 outfits, 4 classes ---------
export const HAIR_STYLES = [
  "longBraid_03",
  "ponytail_01",
  "short_02",
  "bun_04",
  "longLoose_05",
  "topknot_06",
] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

export const OUTFIT_THEMES = [
  "hanbok_armor",
  "cheongsam_blade",
  "ninja_lite",
  "noble_robe",
  "desert_nomad",
  "oasis_guard",
] as const;
export type OutfitTheme = (typeof OUTFIT_THEMES)[number];

/** GDD §10 palette: azul-jade / vermelho-carmim / dourado, per theme. */
export const OUTFIT_PALETTES: Record<OutfitTheme, [string, string, string]> = {
  hanbok_armor: ["#0B3954", "#C8102E", "#D4AF37"],
  cheongsam_blade: ["#C8102E", "#0B3954", "#D4AF37"],
  ninja_lite: ["#1B1B2F", "#2E8B74", "#C8102E"],
  noble_robe: ["#D4AF37", "#0B3954", "#F2E6C9"],
  desert_nomad: ["#C9A86A", "#8A6D3B", "#2E8B74"],
  oasis_guard: ["#2E8B74", "#0B3954", "#D4AF37"],
};

export const SKIN_TONES = ["#F2D6C2", "#E8B88F", "#D9A066", "#B97A4E", "#8D5524", "#F7E0D0"] as const;
export const IRIS_COLORS = ["#3B6EA8", "#2E8B74", "#6C4A2F", "#1B1B2F", "#C8102E", "#7A5AC8"] as const;
export const HAIR_COLORS = ["#1B1B2F", "#3A2A1A", "#6C8CFF", "#C8102E", "#D4AF37", "#E8E0D0"] as const;

export const CLASS_IDS = ["espadachim", "guardiao", "atirador", "clerigo"] as const;
export type ClassId = (typeof CLASS_IDS)[number];

export const FACE_PRESETS = ["soft", "sharp", "mature"] as const;
export type FacePreset = (typeof FACE_PRESETS)[number];

// --- Morphs: 20 body + 20 face ------------------------------------------
export const BODY_MORPH_KEYS = [
  "height", "shoulders", "bust", "waist", "hips",
  "legLen", "armLen", "neckLen", "torsoLen", "thigh",
  "calf", "forearm", "handSize", "footSize", "muscle",
  "belly", "backWidth", "shoulderSlope", "hipWidth", "posture",
] as const;
export type BodyMorphKey = (typeof BODY_MORPH_KEYS)[number];
export type BodyMorphs = Record<BodyMorphKey, number>;

export const FACE_MORPH_KEYS = [
  "eyeSize", "eyeTilt", "eyeSpacing", "eyeDepth", "noseBridge",
  "noseWidth", "noseLen", "lipFull", "lipWidth", "mouthCorner",
  "jaw", "chin", "cheekbone", "browThick", "browAngle",
  "forehead", "earSize", "faceWidth", "faceLen", "blush",
] as const;
export type FaceMorphKey = (typeof FACE_MORPH_KEYS)[number];
export type FaceMorphs = Record<FaceMorphKey, number>;

export interface CharacterGenome {
  v: 1;
  seed: number;
  gender: "f" | "m";
  /** Playable class. Default "espadachim" (only playable class in M1/M2).
   *  Decisão de design do Jose (M2): no criador, a classe é escolhida
   *  PRIMEIRO e a customização vem depois — a classe define corpo/roupa
   *  iniciais via `applyClassPreset`. M3 desbloqueia guardiao/atirador/
   *  clerigo como jogáveis. */
  classId: ClassId;
  body: BodyMorphs;
  face: FaceMorphs & { preset: FacePreset };
  skin: { tone: string; sss: number };
  eyes: { iris: string; pupil: number };
  hair: { style: HairStyle; color: string; tips: string };
  outfit: { theme: OutfitTheme; palette: [string, string, string] };
  makeup: { lip: string; eyeliner: number };
  marks: string[];
}

export type GenomeOverrides = Partial<Omit<CharacterGenome, "body" | "face" | "skin" | "eyes" | "hair" | "outfit" | "makeup">> & {
  body?: Partial<BodyMorphs>;
  face?: Partial<FaceMorphs> & { preset?: FacePreset };
  skin?: Partial<CharacterGenome["skin"]>;
  eyes?: Partial<CharacterGenome["eyes"]>;
  hair?: Partial<CharacterGenome["hair"]>;
  outfit?: Partial<CharacterGenome["outfit"]>;
  makeup?: Partial<CharacterGenome["makeup"]>;
};

/** Truncated-gaussian-ish value in [-1, 1], centered on 0 (beauty prior:
 *  extremes are possible but rare, so random genomes stay plausible). */
function gauss(rng: () => number, amp: number): number {
  const v = ((rng() + rng() + rng() - 1.5) / 1.5) * amp;
  return Math.max(-1, Math.min(1, v));
}

function clampAdult(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

function buildMorphs<K extends string>(keys: readonly K[], rng: () => number, amp: number): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of keys) out[k] = gauss(rng, amp);
  return out;
}

export function generateGenome(seed: number, overrides: GenomeOverrides = {}): CharacterGenome {
  const rng = sfc32(seed >>> 0);
  const pick = <T>(arr: readonly T[]): T => {
    const v = arr[Math.floor(rng() * arr.length)];
    if (v === undefined) throw new Error("empty pick");
    return v;
  };
  const gender = overrides.gender ?? (rng() < 0.5 ? "f" : "m");
  const theme = overrides.outfit?.theme ?? pick(OUTFIT_THEMES);
  const genome: CharacterGenome = {
    v: 1,
    seed: seed >>> 0,
    gender,
    classId: overrides.classId ?? "espadachim",
    body: { ...buildMorphs(BODY_MORPH_KEYS, rng, 0.6), ...overrides.body },
    face: {
      ...buildMorphs(FACE_MORPH_KEYS, rng, 0.5),
      preset: pick(FACE_PRESETS),
      ...overrides.face,
    },
    skin: { tone: pick(SKIN_TONES), sss: 0.4, ...overrides.skin },
    eyes: { iris: pick(IRIS_COLORS), pupil: 0.5, ...overrides.eyes },
    hair: {
      style: pick(HAIR_STYLES),
      color: pick(HAIR_COLORS),
      tips: pick(HAIR_COLORS),
      ...overrides.hair,
    },
    outfit: { theme, palette: OUTFIT_PALETTES[theme], ...overrides.outfit },
    makeup: { lip: "#C2185B", eyeliner: gauss(rng, 0.6), ...overrides.makeup },
    marks: overrides.marks ?? (rng() < 0.25 ? ["beauty_mark_left"] : []),
  };
  // Adult-only clamp, applied after overrides too (a saved/edited genome
  // can never smuggle a child proportion past the validator).
  for (const k of BODY_MORPH_KEYS) genome.body[k] = clampAdult(genome.body[k]);
  for (const k of FACE_MORPH_KEYS) genome.face[k] = clampAdult(genome.face[k]);
  return genome;
}

export function generateGenomeFromName(name: string): CharacterGenome {
  return generateGenome(hashSeed(name));
}

/**
 * Class presets: picking a class first sets the starting body shape and
 * outfit theme (the player then customizes from there). Values are morph
 * offsets applied on top of the seeded genome.
 */
export const CLASS_PRESETS: Record<ClassId, { theme: OutfitTheme; body: Partial<BodyMorphs> }> = {
  espadachim: { theme: "cheongsam_blade", body: { shoulders: 0.1, muscle: 0.2 } },
  guardiao: { theme: "hanbok_armor", body: { shoulders: 0.5, muscle: 0.5, waist: 0.1 } },
  atirador: { theme: "desert_nomad", body: { shoulders: 0.2, muscle: 0.1, legLen: 0.1 } },
  clerigo: { theme: "noble_robe", body: { shoulders: -0.2, muscle: -0.2, hips: 0.1 } },
};

/** Return a copy of the genome with the class preset applied. */
export function applyClassPreset(genome: CharacterGenome, classId: ClassId): CharacterGenome {
  const preset = CLASS_PRESETS[classId];
  const out: CharacterGenome = {
    ...genome,
    classId,
    body: { ...genome.body, ...preset.body },
    outfit: { theme: preset.theme, palette: OUTFIT_PALETTES[preset.theme] },
  };
  for (const k of BODY_MORPH_KEYS) out.body[k] = clampAdult(out.body[k]);
  return out;
}

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

function inRange(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= -1 && v <= 1;
}

/** Validate a genome: version, enums, every morph in [-1, 1], adult-only. */
export function validateGenome(g: unknown): g is CharacterGenome {
  if (typeof g !== "object" || g === null) return false;
  const genome = g as Partial<CharacterGenome>;
  if (genome.v !== 1 || typeof genome.seed !== "number" || !Number.isFinite(genome.seed)) return false;
  if (genome.gender !== "f" && genome.gender !== "m") return false;
  if (!CLASS_IDS.includes(genome.classId as ClassId)) return false;
  const body = genome.body;
  const face = genome.face;
  if (!body || !face) return false;
  for (const k of BODY_MORPH_KEYS) if (!inRange(body[k])) return false;
  for (const k of FACE_MORPH_KEYS) if (!inRange(face[k])) return false;
  if (!FACE_PRESETS.includes(face.preset as FacePreset)) return false;
  if (!genome.skin || !HEX_COLOR.test(genome.skin.tone ?? "")) return false;
  if (!genome.eyes || !HEX_COLOR.test(genome.eyes.iris ?? "")) return false;
  if (!genome.hair || !HAIR_STYLES.includes(genome.hair.style as HairStyle)) return false;
  if (!HEX_COLOR.test(genome.hair.color ?? "") || !HEX_COLOR.test(genome.hair.tips ?? "")) return false;
  if (!genome.outfit || !OUTFIT_THEMES.includes(genome.outfit.theme as OutfitTheme)) return false;
  if (!Array.isArray(genome.outfit.palette) || genome.outfit.palette.length !== 3) return false;
  if (!genome.outfit.palette.every((c) => HEX_COLOR.test(c))) return false;
  if (!genome.makeup || !HEX_COLOR.test(genome.makeup.lip ?? "")) return false;
  if (!Array.isArray(genome.marks)) return false;
  return true;
}
