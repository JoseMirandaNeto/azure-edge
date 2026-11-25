/** Shared constants — single source of truth. Gameplay numbers live in
 *  packages/gamedata; only protocol / simulation constants live here. */
/** Bumped to 1 for the boss snapshot fields (enraged, aoes) — see EntityState. */
export const PROTOCOL_VERSION = 1;
export const TICK_RATE_HZ = 20;
export const TICK_DT_S = 1 / TICK_RATE_HZ;
/** Logical frame used by COMBAT_SPEC.md: 1 frame = 1/60 s. */
export const LOGICAL_FPS = 60;
export const MAX_INPUTS_PER_TICK = 4;
/** Interest radius (m) — AGENTS.md §4. M0 broadcasts to the whole zone. */
export const INTEREST_RADIUS_M = 60;
/** Max rewind for lag compensation (ms) — COMBAT_SPEC.md. */
export const MAX_REWIND_MS = 150;
