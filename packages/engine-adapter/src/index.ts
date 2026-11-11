/**
 * engine-adapter — isolates Three.js so a future native client (M8) can swap
 * the renderer without touching gameplay code (docs/ARCHITECTURE.md).
 * M0: interfaces + a capability probe. The Three.js implementation lives in
 * apps/client/src/render/ and is written against these interfaces.
 */
export type RendererBackend = "webgpu" | "webgl2";

export interface RendererStats {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

export interface RendererAdapter {
  readonly backend: RendererBackend;
  render(): void;
  resize(width: number, height: number): void;
  getStats(): RendererStats;
  dispose(): void;
}

export interface InputState {
  moveX: number;
  moveY: number;
  yaw: number;
  buttons: number;
}

/** Probe WebGPU support without creating a renderer (cheap feature check). */
export function supportsWebGPU(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "gpu" in navigator &&
    navigator.gpu !== undefined &&
    navigator.gpu !== null
  );
}

export function supportsWebGL2(): boolean {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  return canvas.getContext("webgl2") !== null;
}
