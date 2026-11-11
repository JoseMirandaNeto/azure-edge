import * as THREE from "three";
import { ZONE } from "@azure-edge/gamedata";
import { sfc32, type EntityState } from "@azure-edge/shared";

export type Backend = "webgpu" | "webgl2";

export interface RendererLike {
  domElement: HTMLCanvasElement;
  setSize(w: number, h: number): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  setAnimationLoop(cb: ((time: number) => void) | null): void | Promise<void>;
  // WebGPU has drawCalls (per-frame); WebGL2 only has calls (per-frame).
  info: { render: { calls: number; drawCalls?: number; triangles: number } };
}

const WORLD_TO_THREE = (x: number, y: number): [number, number, number] => [x, 0, -y];

function terrainHeight(x: number, z: number): number {
  // Deterministic rolling hills, flattened near spawn. No Math.random.
  const d = Math.hypot(x, z);
  const flat = Math.min(1, Math.max(0, (d - 6) / 14));
  const h =
    1.4 * Math.sin(x * 0.08) * Math.cos(z * 0.06) +
    0.6 * Math.sin(x * 0.23 + z * 0.17) +
    0.25 * Math.sin(x * 0.51 - z * 0.43);
  return h * flat;
}

/** Placeholder character: capsule + head + facing marker. No external assets. */
function makePlaceholder(color: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.9, 4, 12), mat);
  body.position.y = 0.95;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xf2d6c2, roughness: 0.5 }),
  );
  head.position.y = 1.85;
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.09, 0.3, 8),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4 }),
  );
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, 1.85, -0.32);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.55, 24),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  g.add(body, head, nose, ring);
  return g;
}

export class WorldView {
  backend: Backend = "webgl2";
  renderer!: RendererLike;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly players = new Map<number, { group: THREE.Group }>();
  private readonly camPos = new THREE.Vector3();
  private readonly camFocus = new THREE.Vector3();
  private readonly camPosTarget = new THREE.Vector3();
  private readonly camFocusTarget = new THREE.Vector3();
  private camReady = false;

  constructor(private readonly container: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    this.scene.background = new THREE.Color(0x87bfe8);
    this.scene.fog = new THREE.Fog(0x87bfe8, 60, 160);
  }

  /** Try WebGPU first, fall back to WebGL2 (AGENTS.md: WebGPU with fallback). */
  async init(): Promise<void> {
    const canvas = document.createElement("canvas");
    let renderer: RendererLike | null = null;
    if (typeof navigator !== "undefined" && "gpu" in navigator) {
      try {
        const { WebGPURenderer } = await import("three/webgpu");
        const r = new WebGPURenderer({ canvas, antialias: true });
        await r.init();
        renderer = r as unknown as RendererLike;
        this.backend = "webgpu";
      } catch (err) {
        console.warn("WebGPU init failed, falling back to WebGL2:", err);
      }
    }
    if (renderer === null) {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true }) as unknown as RendererLike;
      this.backend = "webgl2";
    }
    this.renderer = renderer;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.container.appendChild(this.renderer.domElement);
    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer?.setSize(window.innerWidth, window.innerHeight);
    });
    this.buildLights();
    this.buildTerrain();
    this.buildProps();
  }

  private buildLights(): void {
    const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x3a5f3a, 0.9);
    const sun = new THREE.DirectionalLight(0xfff2d9, 1.6);
    sun.position.set(30, 50, -20);
    this.scene.add(hemi, sun);
  }

  private buildTerrain(): void {
    const size = ZONE.zone.sizeM;
    const geo = new THREE.PlaneGeometry(size, size, 64, 64);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const low = new THREE.Color(0x4f8f4a);
    const high = new THREE.Color(0x8a7a5a);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      const t = Math.min(1, Math.max(0, h / 2));
      c.copy(low).lerp(high, t);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    this.scene.add(new THREE.Mesh(geo, mat));
  }

  private buildProps(): void {
    // Deterministic scatter: 24 rocks + 16 "trees" (cone + cylinder).
    const rng = sfc32(20261111);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 1 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f7a3d, roughness: 0.9 });
    for (let i = 0; i < 40; i += 1) {
      const x = (rng() * 2 - 1) * 55;
      const z = (rng() * 2 - 1) * 55;
      if (Math.hypot(x, z) < 8) continue;
      const y = terrainHeight(x, z);
      if (i < 24) {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5 + rng() * 1.2, 0), rockMat);
        rock.position.set(x, y + 0.4, z);
        rock.rotation.y = rng() * Math.PI;
        this.scene.add(rock);
      } else {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 1.6, 6), trunkMat);
        trunk.position.set(x, y + 0.8, z);
        const leaves = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.4, 8), leafMat);
        leaves.position.set(x, y + 2.6, z);
        this.scene.add(trunk, leaves);
      }
    }
  }

  /**
   * Positions come pre-smoothed from main.ts: the local player from
   * prediction + reconciliation glide, remotes from the ~100 ms snapshot
   * interpolation buffer. This method just places the mesh (plus walk bob) —
   * no extra lerp here, or the entity would lag twice (buffer + lerp).
   */
  updatePlayer(e: EntityState, isLocal: boolean): void {
    let entry = this.players.get(e.id);
    if (!entry) {
      const color = isLocal ? 0x2f7de1 : 0xe15a2f;
      const group = makePlaceholder(color);
      this.scene.add(group);
      const [x, , z] = WORLD_TO_THREE(e.x, e.y);
      group.position.set(x, terrainHeight(x, z), z);
      entry = { group };
      this.players.set(e.id, entry);
    }
    const [tx, , tz] = WORLD_TO_THREE(e.x, e.y);
    const ty = terrainHeight(tx, tz);
    entry.group.position.set(tx, ty, tz);
    // Mesh forward is -Z; world yaw maps to rotation.y = -yaw.
    entry.group.rotation.y = -e.yaw;
    // Simple walk bob so movement reads on screen.
    const bob = e.animState === 1 ? Math.sin(performance.now() / 90) * 0.05 : 0;
    entry.group.position.y = ty + bob;
  }

  removePlayer(id: number): void {
    const entry = this.players.get(id);
    if (entry) {
      this.scene.remove(entry.group);
      this.players.delete(id);
    }
  }

  /**
   * Smoothed camera: the focus point and the camera position glide toward
   * their targets (~90 ms time constant) instead of snapping to the predicted
   * position every frame, so reconciliation corrections don't shake the screen.
   */
  updateCamera(playerX: number, playerY: number, yaw: number, dt: number): void {
    const { distanceM, heightM } = ZONE.camera;
    const [px, , pz] = WORLD_TO_THREE(playerX, playerY);
    const py = terrainHeight(px, pz);
    this.camPosTarget.set(px - Math.sin(yaw) * distanceM, py + heightM, pz + Math.cos(yaw) * distanceM);
    this.camFocusTarget.set(px, py + 1.4, pz);
    if (!this.camReady) {
      this.camPos.copy(this.camPosTarget);
      this.camFocus.copy(this.camFocusTarget);
      this.camReady = true;
    } else {
      const k = 1 - Math.exp(-Math.max(0, dt) / 0.09);
      this.camPos.lerp(this.camPosTarget, k);
      this.camFocus.lerp(this.camFocusTarget, k);
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camFocus);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  getStats(): { calls: number; triangles: number } {
    // three 0.182 WebGPURenderer: info.render.calls is CUMULATIVE since the
    // app started (it counts render() invocations = frames), NOT per-frame
    // draw calls — the F3 panel used to show 1742–4374 "draw calls" while the
    // scene only draws ~65 meshes. The per-frame count is drawCalls (the
    // WebGL2 fallback has no drawCalls field, so fall back to calls there).
    const info = this.renderer.info.render;
    return {
      calls: info.drawCalls ?? info.calls,
      triangles: info.triangles,
    };
  }
}
