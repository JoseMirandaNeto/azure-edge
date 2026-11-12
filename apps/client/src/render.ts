import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MOBS, ZONE } from "@azure-edge/gamedata";
import { buildCharacter, disposeCharacter, type CharacterBuild } from "@azure-edge/engine-adapter";
import type { CharacterGenome } from "@azure-edge/charforge";
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
  // Deterministic terrain, flattened near spawn. No Math.random.
  const d = Math.hypot(x, z);
  const flat = Math.min(1, Math.max(0, (d - 6) / 14));
  let h: number;
  if (ZONE.biome === "desert") {
    // Smooth dunes: long low-frequency waves, no sharp rocks.
    h =
      1.8 * Math.sin(x * 0.05) * Math.cos(z * 0.04) +
      0.5 * Math.sin(x * 0.13 + z * 0.09) +
      0.2 * Math.sin(x * 0.31 - z * 0.27);
  } else {
    h =
      1.4 * Math.sin(x * 0.08) * Math.cos(z * 0.06) +
      0.6 * Math.sin(x * 0.23 + z * 0.17) +
      0.25 * Math.sin(x * 0.51 - z * 0.43);
  }
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

/**
 * Procedural mob placeholder (M1): color/scale come from gamedata.
 * Insectoids (escorpião/formiga/besouro) are horizontal with a stinger/tail;
 * the múmia stands upright like a player capsule. No external assets.
 * Returns the group plus the telegraph ring (shown during windup, animState 9).
 */
function makeMob(color: number, scale: number, upright: boolean): { group: THREE.Group; ring: THREE.Mesh } {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05 });
  if (upright) {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.9, 4, 12), mat);
    body.position.y = 0.95;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), mat);
    head.position.y = 1.85;
    g.add(body, head);
  } else {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.7, 4, 10), mat);
    body.rotation.x = Math.PI / 2;
    body.position.y = 0.45;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), mat);
    head.position.set(0, 0.5, -0.65);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.7, 8), mat);
    tail.rotation.x = Math.PI / 2 + 0.5;
    tail.position.set(0, 0.75, 0.75);
    g.add(body, head, tail);
  }
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.1, 32),
    new THREE.MeshBasicMaterial({ color: 0xff2a1a, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.visible = false;
  g.add(ring);
  g.scale.setScalar(scale);
  return { group: g, ring };
}

export class WorldView {
  backend: Backend = "webgl2";
  renderer!: RendererLike;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly players = new Map<number, { group: THREE.Group; guardDisc: THREE.Mesh }>();
  private readonly mobs = new Map<number, { group: THREE.Group; ring: THREE.Mesh }>();
  /** M2: the local player's CharForge character (LOD0). Null = capsule fallback. */
  private localCharacter: CharacterBuild | null = null;
  private localId: number | null = null;
  /** Swing arc effects: one translucent sector per attacker, fading out. */
  private readonly swings = new Map<number, { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; until: number }>();
  private readonly camPos = new THREE.Vector3();
  private readonly camFocus = new THREE.Vector3();
  private readonly camPosTarget = new THREE.Vector3();
  private readonly camFocusTarget = new THREE.Vector3();
  private camReady = false;
  /** Camera juice: shake amplitude (decays) and FOV pulse (decays). */
  private shakeAmp = 0;
  private fovPulse = 0;
  private readonly baseFov = 60;
  private readonly projV = new THREE.Vector3();

  constructor(private readonly container: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, 1, 0.1, 500);
    this.scene.background = new THREE.Color(ZONE.palette.sky);
    this.scene.fog = new THREE.Fog(ZONE.palette.fog, 60, 160);
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
    const hemi = new THREE.HemisphereLight(0xffe9c4, new THREE.Color(ZONE.palette.ground).getHex(), 0.9);
    const sun = new THREE.DirectionalLight(new THREE.Color(ZONE.palette.sun).getHex(), 1.8);
    sun.position.set(30, 50, -20);
    this.scene.add(hemi, sun);
  }

  private buildTerrain(): void {
    const size = ZONE.zone.sizeM;
    const geo = new THREE.PlaneGeometry(size, size, 64, 64);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const low = new THREE.Color(ZONE.palette.low);
    const high = new THREE.Color(ZONE.palette.high);
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
    // Deterministic scatter from the zone data (desert: rocks, cacti, dry
    // palms, broken pillars). No Math.random.
    const rng = sfc32(20261111);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a7a5f, roughness: 1 });
    const cactusMat = new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 0.9 });
    const palmMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
    const palmLeafMat = new THREE.MeshStandardMaterial({ color: 0x7a7a3a, roughness: 0.9 });
    const ruinMat = new THREE.MeshStandardMaterial({ color: 0xb09a7a, roughness: 1 });
    for (const spec of ZONE.props) {
      for (let i = 0; i < spec.count; i += 1) {
        const x = (rng() * 2 - 1) * 55;
        const z = (rng() * 2 - 1) * 55;
        if (Math.hypot(x, z) < 8) continue;
        const y = terrainHeight(x, z);
        if (spec.kind === "rock") {
          const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5 + rng() * 1.2, 0), rockMat);
          rock.position.set(x, y + 0.4, z);
          rock.rotation.y = rng() * Math.PI;
          this.scene.add(rock);
        } else if (spec.kind === "cactus") {
          const cactus = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 1.6 + rng(), 8), cactusMat);
          cactus.position.set(x, y + 0.9, z);
          const top = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), cactusMat);
          top.position.set(x, y + 1.8, z);
          this.scene.add(cactus, top);
        } else if (spec.kind === "palm") {
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 2.6, 6), palmMat);
          trunk.position.set(x, y + 1.3, z);
          trunk.rotation.z = (rng() - 0.5) * 0.3;
          const leaves = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1.2, 8), palmLeafMat);
          leaves.position.set(x, y + 2.9, z);
          this.scene.add(trunk, leaves);
        } else if (spec.kind === "ruin") {
          const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.5 + rng() * 1.5, 0.8), ruinMat);
          pillar.position.set(x, y + 0.9, z);
          pillar.rotation.y = rng() * Math.PI;
          this.scene.add(pillar);
        }
      }
    }
  }

  /**
   * Set (or clear) the local player's CharForge genome. The character mesh
   * replaces the capsule placeholder for the local player only — remote
   * players stay capsules until M4 syncs genomes. Null = capsule fallback.
   */
  setLocalGenome(genome: CharacterGenome | null): void {
    if (this.localCharacter) {
      this.scene.remove(this.localCharacter.group);
      disposeCharacter(this.localCharacter);
      this.localCharacter = null;
    }
    if (genome) this.localCharacter = buildCharacter(genome, 0);
    // Force the local player mesh to be rebuilt on the next updatePlayer.
    if (this.localId !== null) {
      const entry = this.players.get(this.localId);
      if (entry) {
        this.scene.remove(entry.group);
        this.players.delete(this.localId);
      }
    }
  }

  /**
   * GLB character (M2.5 test): loads a rigged glTF character and uses it as
   * the local player's mesh instead of the CharForge build. The GLB faces
   * +Z (glTF convention) and is 1.0 m tall, so the inner scene is rotated
   * PI (forward becomes -Z, like CharForge) and scaled to ~1.75 m. Returns
   * false if the file fails to load — the caller falls back to the genome.
   * The rig has no animations yet, so the character stands in rest pose;
   * movement still reads via the whole-body bob/lean in updatePlayer.
   */
  async useGlbCharacter(url: string): Promise<boolean> {
    let gltf: Awaited<ReturnType<GLTFLoader["loadAsync"]>>;
    try {
      gltf = await new GLTFLoader().loadAsync(url);
    } catch (err) {
      console.warn("GLB character failed to load, falling back to genome:", err);
      return false;
    }
    if (this.localCharacter) {
      this.scene.remove(this.localCharacter.group);
      disposeCharacter(this.localCharacter);
      this.localCharacter = null;
    }
    const wrapper = new THREE.Group();
    const inner = gltf.scene;
    inner.rotation.y = Math.PI;
    wrapper.add(inner);
    wrapper.scale.setScalar(1.75);
    let triangles = 0;
    wrapper.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const geo = o.geometry as THREE.BufferGeometry;
        const posCount = geo.attributes.position?.count ?? 0;
        triangles += (geo.index ? geo.index.count : posCount) / 3;
      }
    });
    this.localCharacter = { group: wrapper, drawCalls: 1, triangles: Math.round(triangles), heightM: 1.75 };
    if (this.localId !== null) {
      const entry = this.players.get(this.localId);
      if (entry) {
        this.scene.remove(entry.group);
        this.players.delete(this.localId);
      }
    }
    return true;
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
      // Local player with a CharForge genome renders the character (4 draw
      // calls); everyone else (and no-genome fallback) keeps the capsule.
      const group = isLocal && this.localCharacter ? this.localCharacter.group : makePlaceholder(color);
      if (isLocal) this.localId = e.id;
      this.scene.add(group);
      const [x, , z] = WORLD_TO_THREE(e.x, e.y);
      group.position.set(x, terrainHeight(x, z), z);
      const guardDisc = new THREE.Mesh(
        new THREE.CircleGeometry(0.9, 24),
        new THREE.MeshBasicMaterial({ color: 0x4aa8ff, side: THREE.DoubleSide, transparent: true, opacity: 0.35 }),
      );
      guardDisc.visible = false;
      group.add(guardDisc);
      entry = { group, guardDisc };
      this.players.set(e.id, entry);
    }
    const [tx, , tz] = WORLD_TO_THREE(e.x, e.y);
    const ty = terrainHeight(tx, tz);
    entry.group.position.set(tx, ty, tz);
    // Mesh forward is -Z; world yaw maps to rotation.y = -yaw.
    entry.group.rotation.y = -e.yaw;
    // Slight forward lean while moving (whole-body animation; M2 has no rig).
    entry.group.rotation.x = e.animState === 1 ? 0.05 : 0;
    // Simple walk bob so movement reads on screen.
    const bob = e.animState === 1 ? Math.sin(performance.now() / 90) * 0.05 : 0;
    entry.group.position.y = ty + bob;
    // Guard disc: faces the attacker (in front of the player).
    entry.guardDisc.visible = e.animState === 4;
    if (entry.guardDisc.visible) {
      entry.guardDisc.position.set(0, 1.1, -0.7);
      entry.guardDisc.rotation.set(0, 0, 0);
    }
  }

  /** Mob placeholder from gamedata (color/scale by mobId); ring = windup telegraph. */
  updateMob(e: EntityState): void {
    let entry = this.mobs.get(e.id);
    if (!entry) {
      const data = MOBS.find((m) => m.id === e.mobId) ?? MOBS[0];
      const color = data ? Number.parseInt(data.color.slice(1), 16) : 0x888888;
      const scale = data?.scale ?? 1;
      const { group, ring } = makeMob(color, scale, e.mobId === "mumia");
      this.scene.add(group);
      entry = { group, ring };
      this.mobs.set(e.id, entry);
    }
    const [tx, , tz] = WORLD_TO_THREE(e.x, e.y);
    const ty = terrainHeight(tx, tz);
    entry.group.position.set(tx, ty, tz);
    entry.group.rotation.y = -e.yaw;
    entry.ring.visible = e.animState === 9;
    if (entry.ring.visible) {
      const pulse = 0.85 + Math.sin(performance.now() / 90) * 0.15;
      entry.ring.scale.setScalar(pulse);
    }
  }

  removeEntity(id: number): void {
    const p = this.players.get(id);
    if (p) {
      this.scene.remove(p.group);
      this.players.delete(id);
    }
    const m = this.mobs.get(id);
    if (m) {
      this.scene.remove(m.group);
      this.mobs.delete(id);
    }
    const s = this.swings.get(id);
    if (s) {
      this.scene.remove(s.mesh);
      this.swings.delete(id);
    }
  }

  /** Swing arc tied to an attacker id (replaces any previous arc of theirs). */
  showSwingFor(id: number, x: number, y: number, yaw: number, radius: number, angleDeg: number, color = 0x9fd8ff): void {
    const old = this.swings.get(id);
    if (old) {
      this.scene.remove(old.mesh);
      old.mesh.geometry.dispose();
      old.mat.dispose();
    }
    const [tx, , tz] = WORLD_TO_THREE(x, y);
    const ty = terrainHeight(tx, tz);
    const mat = new THREE.MeshBasicMaterial({
      color, side: THREE.DoubleSide, transparent: true, opacity: 0.55, depthWrite: false,
    });
    const geo = new THREE.CircleGeometry(radius, 24, Math.PI / 2 - (angleDeg * Math.PI) / 360, (angleDeg * Math.PI) / 180);
    const mesh = new THREE.Mesh(geo, mat);
    // YXZ order: lay flat first (local +Y -> world -Z = forward), then yaw.
    mesh.rotation.order = "YXZ";
    mesh.rotation.set(-Math.PI / 2, -yaw, 0);
    mesh.position.set(tx, ty + 0.4, tz);
    this.scene.add(mesh);
    this.swings.set(id, { mesh, mat, until: performance.now() + 180 });
  }

  /** Fade a swing arc out over 80 ms (visual rollback when the server rejects). */
  cancelSwing(id: number): void {
    const s = this.swings.get(id);
    if (s) s.until = Math.min(s.until, performance.now() + 80);
  }

  /** Camera juice: small shake (≤ 0.15 per spec) and a light FOV pulse. */
  addShake(amount: number): void {
    this.shakeAmp = Math.min(0.15, this.shakeAmp + amount);
  }

  addFovPulse(amount: number): void {
    this.fovPulse = Math.min(4, this.fovPulse + amount);
  }

  /** Project a world position to screen pixels (for damage numbers / HP bars). */
  worldToScreen(x: number, y: number, heightM = 2): { sx: number; sy: number; behind: boolean } {
    const [tx, , tz] = WORLD_TO_THREE(x, y);
    this.projV.set(tx, terrainHeight(tx, tz) + heightM, tz).project(this.camera);
    return {
      sx: (this.projV.x * 0.5 + 0.5) * window.innerWidth,
      sy: (-this.projV.y * 0.5 + 0.5) * window.innerHeight,
      behind: this.projV.z > 1,
    };
  }

  /** Pointer lock for mouse-look: click the canvas to capture the mouse. */
  requestPointerLock(): void {
    try {
      const el = this.renderer.domElement as HTMLCanvasElement;
      const r = el.requestPointerLock() as unknown;
      if (r instanceof Promise) r.catch(() => {});
    } catch {
      // Pointer lock unavailable (iframe permissions, etc.) — drag still works.
    }
  }

  isPointerLocked(): boolean {
    return document.pointerLockElement === this.renderer.domElement;
  }

  /**
   * Smoothed camera: the focus point and the camera position glide toward
   * their targets (~90 ms time constant) instead of snapping to the predicted
   * position every frame, so reconciliation corrections don't shake the screen.
   * pitch = orbit elevation (0.05 near-horizontal … 1.25 high above).
   */
  updateCamera(playerX: number, playerY: number, yaw: number, pitch: number, dt: number): void {
    const { distanceM } = ZONE.camera;
    const [px, , pz] = WORLD_TO_THREE(playerX, playerY);
    const py = terrainHeight(px, pz);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    this.camPosTarget.set(
      px - Math.sin(yaw) * cp * distanceM,
      py + 1.4 + sp * distanceM,
      pz + Math.cos(yaw) * cp * distanceM,
    );
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
    // Camera shake: deterministic sine wobble (visual only), decaying.
    const t = performance.now() / 1000;
    this.shakeAmp *= Math.exp(-Math.max(0, dt) / 0.12);
    if (this.shakeAmp < 0.001) this.shakeAmp = 0;
    const shX = Math.sin(t * 97.3) * this.shakeAmp;
    const shY = Math.sin(t * 113.7) * this.shakeAmp;
    this.camera.position.set(this.camPos.x + shX, this.camPos.y + shY, this.camPos.z);
    this.camera.lookAt(this.camFocus);
    // FOV pulse (light, decays back to base).
    this.fovPulse *= Math.exp(-Math.max(0, dt) / 0.15);
    if (this.fovPulse < 0.05) this.fovPulse = 0;
    const fov = this.baseFov + this.fovPulse;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  render(): void {
    // Fade out finished swing arcs.
    const now = performance.now();
    for (const [id, s] of [...this.swings.entries()]) {
      const remain = s.until - now;
      if (remain <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mat.dispose();
        this.swings.delete(id);
      } else if (remain < 80) {
        s.mat.opacity = 0.55 * (remain / 80);
      }
    }
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
