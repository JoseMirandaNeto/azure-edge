/**
 * Deterministic PRNG (sfc32). Simulation code MUST use this with an injected
 * seed — Math.random() / Date.now() are forbidden in gameplay (AGENTS.md §3).
 */
export function sfc32(seed: number): () => number {
  let a = seed >>> 0;
  let b = (seed ^ 0x9e3779b9) >>> 0;
  let c = (seed ^ 0x85ebca6b) >>> 0;
  let d = (seed ^ 0xc2b2ae35) >>> 0;
  return () => {
    const t = (a + b) | 0;
    a = (b ^ (b >>> 9)) >>> 0;
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const u = (t + d) | 0;
    c = (c + u) | 0;
    return (u >>> 0) / 4294967296;
  };
}

/** Deterministic float in [min, max) from a PRNG. */
export function randRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** FNV-1a hash of a string — stable seed derivation (e.g. CharForge seeds). */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
