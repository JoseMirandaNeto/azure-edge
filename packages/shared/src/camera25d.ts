/**
 * 2.5D camera (vertical slice): fixed oblique camera, no free orbit.
 * Elevation ~38°, fixed distance, follows the player; the camera sits
 * south of the player looking north, so W (forward) is screen-up.
 * Pure math — shared so the client and the tests agree on the numbers.
 *
 * World coords: x east, y north (three.js: x, z = -y).
 */

/** 2.5D camera tuning (data-driven defaults, overridable per zone). */
export const CAMERA_25D = {
  /** Fixed oblique elevation. */
  elevationDeg: 38,
  /** Fixed follow distance (m). */
  distanceM: 14,
  /** Wheel zoom range (m). */
  zoomMinM: 10,
  zoomMaxM: 20,
  /** Height of the focus point above the ground (m). */
  focusHeightM: 1.4,
} as const;

export type Camera25DMode = "2.5d" | "3d";

/** Clamp a wheel-zoom distance into the allowed 2.5D range. */
export function clampCamera25DZoom(distanceM: number): number {
  return Math.min(CAMERA_25D.zoomMaxM, Math.max(CAMERA_25D.zoomMinM, distanceM));
}

export interface Camera25DPose {
  /** Camera world position (x, y north, height z). */
  camX: number;
  camY: number;
  camZ: number;
  /** Focus point (the player, at chest height). */
  focusX: number;
  focusY: number;
  focusZ: number;
}

/**
 * Fixed oblique pose for a player at (playerX, playerY): the camera is
 * `distanceM` away at `elevationDeg`, due south of the player.
 */
export function computeCamera25D(
  playerX: number,
  playerY: number,
  distanceM: number = CAMERA_25D.distanceM,
  elevationDeg: number = CAMERA_25D.elevationDeg,
): Camera25DPose {
  const dist = clampCamera25DZoom(distanceM);
  const el = (elevationDeg * Math.PI) / 180;
  return {
    camX: playerX,
    camY: playerY - dist * Math.cos(el),
    camZ: dist * Math.sin(el),
    focusX: playerX,
    focusY: playerY,
    focusZ: CAMERA_25D.focusHeightM,
  };
}

/** Parse `?camera=2.5d|3d` (default 2.5d, the new vertical-slice default). */
export function parseCameraMode(raw: string | null | undefined): Camera25DMode {
  return raw === "3d" ? "3d" : "2.5d";
}
