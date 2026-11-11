import { TICK_DT_S } from "./constants.js";
import type { InputPayload } from "./net/messages.js";
import { stepMovement, type SimState } from "./sim.js";

/**
 * Client-side prediction helpers (pure, deterministic, no I/O).
 *
 * Why they exist: with ~100-550 ms RTT the M0 reconciliation teleported the
 * predicted position whenever the error passed 0.5 m, so the capsule visibly
 * "bounced" and the camera (which follows the predicted position) shook.
 * These helpers keep the authoritative rewind + re-apply of unacked inputs,
 * but turn the remaining error into a correction offset that glides away
 * instead of a teleport, and render remote entities from a ~100 ms
 * interpolation buffer (AGENTS.md §4) instead of chasing the latest snapshot.
 */

/** Only errors bigger than this snap the player (respawn / hard desync). */
export const RECONCILE_TELEPORT_M = 2;
/** Time constant (s) over which a reconciliation error glides to zero. */
export const RECONCILE_GLIDE_TAU_S = 0.12;
/** Interpolation buffer for remote entities (ms) — AGENTS.md §4. */
export const REMOTE_INTERP_BUFFER_MS = 100;

export interface UnackedInput {
  seq: number;
  input: InputPayload;
}

export interface ReconcileResult {
  /** Authoritative state with unacked inputs re-applied. */
  corrected: SimState;
  /** corrected - predicted (the visual error the glide has to absorb). */
  deltaX: number;
  deltaY: number;
  /** True when the error is so big the only sane option is a teleport. */
  teleport: boolean;
  /** Inputs the server has not acked yet (kept for future reconciliations). */
  stillPending: UnackedInput[];
}

/**
 * Reconcile local prediction against an authoritative snapshot.
 * Pure: same inputs => same output. Does not mutate its arguments.
 */
export function reconcilePrediction(
  predicted: SimState,
  authoritative: SimState,
  unacked: UnackedInput[],
  ackSeq: number,
  walkSpeedMps: number,
): ReconcileResult {
  const stillPending = unacked.filter((u) => u.seq > ackSeq);
  let corrected: SimState = { ...authoritative };
  for (const u of stillPending) {
    corrected = stepMovement(corrected, u.input, TICK_DT_S, walkSpeedMps);
  }
  const deltaX = corrected.x - predicted.x;
  const deltaY = corrected.y - predicted.y;
  const teleport = Math.hypot(deltaX, deltaY) > RECONCILE_TELEPORT_M;
  return { corrected, deltaX, deltaY, teleport, stillPending };
}

/**
 * Exponential decay of a reconciliation correction offset.
 * After one time constant (~120 ms by default) ~37% remains, after ~360 ms ~5%.
 */
export function decayCorrection(
  corr: number,
  dtS: number,
  tauS: number = RECONCILE_GLIDE_TAU_S,
): number {
  if (dtS <= 0) return corr;
  return corr * Math.exp(-dtS / tauS);
}

/** Shortest-arc interpolation between two yaws (radians), result in [-π, π]. */
export function lerpAngle(a: number, b: number, t: number): number {
  let diff = (b - a) % (2 * Math.PI);
  if (diff > Math.PI) diff -= 2 * Math.PI;
  if (diff < -Math.PI) diff += 2 * Math.PI;
  let out = a + diff * t;
  // Normalise to [-π, π].
  out = ((out + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return out;
}

/** One received snapshot sample of a remote entity, timestamped on receipt. */
export interface RemoteSample {
  /** Local receipt time (performance.now() clock), ms. */
  tMs: number;
  x: number;
  y: number;
  yaw: number;
  animState: number;
}

/**
 * Interpolate a remote entity at renderTimeMs from its received samples
 * (samples must be ordered by tMs ascending). Clamps to the first/last
 * sample outside the recorded range, so a stalled connection freezes the
 * entity instead of extrapolating it through walls.
 */
export function interpolateRemote(
  samples: RemoteSample[],
  renderTimeMs: number,
): RemoteSample | null {
  if (samples.length === 0) return null;
  const first = samples[0] as RemoteSample;
  if (samples.length === 1 || renderTimeMs <= first.tMs) return { ...first };
  const last = samples[samples.length - 1] as RemoteSample;
  if (renderTimeMs >= last.tMs) return { ...last };
  for (let i = 0; i < samples.length - 1; i += 1) {
    const a = samples[i] as RemoteSample;
    const b = samples[i + 1] as RemoteSample;
    if (renderTimeMs >= a.tMs && renderTimeMs <= b.tMs) {
      if (b.tMs === a.tMs) return { ...b };
      const t = (renderTimeMs - a.tMs) / (b.tMs - a.tMs);
      return {
        tMs: renderTimeMs,
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        yaw: lerpAngle(a.yaw, b.yaw, t),
        animState: b.animState,
      };
    }
  }
  return { ...last };
}
