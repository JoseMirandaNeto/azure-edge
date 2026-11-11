import type { InputPayload } from "./net/messages.js";

/** Pure movement simulation shared by client prediction and server.
 *  Deterministic: same inputs + same state => same next state.
 *  No Math.random / Date.now here. Speed comes from gamedata, injected.
 */
export interface SimState {
  x: number;
  y: number;
  yaw: number;
  moving: boolean;
}

export function stepMovement(
  state: SimState,
  input: Pick<InputPayload, "moveX" | "moveY" | "yaw">,
  dtS: number,
  walkSpeedMps: number,
): SimState {
  const len = Math.hypot(input.moveX, input.moveY);
  const moving = len > 0.01;
  if (!moving) return { ...state, yaw: input.yaw, moving: false };
  const nx = input.moveX / len;
  const ny = input.moveY / len;
  // Camera-relative: yaw 0 faces -Z in world; forward = (sin(yaw), cos(yaw)) on XZ.
  // moveY = forward, moveX = strafe right.
  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);
  const worldX = nx * cos + ny * sin;
  const worldY = -nx * sin + ny * cos;
  return {
    x: state.x + worldX * walkSpeedMps * dtS,
    y: state.y + worldY * walkSpeedMps * dtS,
    yaw: input.yaw,
    moving: true,
  };
}

/** Clamp a displacement to the maximum allowed in dt (anti-cheat / validation). */
export function maxDisplacementM(walkSpeedMps: number, dtS: number): number {
  // Small tolerance for float error / tick jitter.
  return walkSpeedMps * dtS * 1.05 + 0.01;
}
