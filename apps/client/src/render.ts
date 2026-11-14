import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { MOBS, ZONE, armorById, zoneById, type ArmorData, type ZoneData } from "@azure-edge/gamedata";
import { buildCharacter, disposeCharacter, type CharacterBuild } from "@azure-edge/engine-adapter";
import type { CharacterGenome } from "@azure-edge/charforge";
import {
  CAMERA_25D,
  clampCamera25DZoom,
  computeCamera25D,
  sfc32,
  type Camera25DMode,
  type EntityState,
} from "@azure-edge/shared";

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

/** Placeholder weapon per class (geometric, distinct silhouette + color). */
function makeWeapon(classId: string): THREE.Group {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.35, metalness: 0.8 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.4, metalness: 0.7 });
  const holy = new THREE.MeshStandardMaterial({ color: 0xffe98a, roughness: 0.3, metalness: 0.2, emissive: 0xaa8811 });
  const sword = (x: number): THREE.Group => {
    const s = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.75, 0.015), steel);
    blade.position.y = 0.45;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.04), gold);
    guard.position.y = 0.08;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 8), grip);
    s.add(blade, guard, handle);
    s.position.set(x, 1.0, 0.1);
    s.rotation.x = 0.35;
    return s;
  };
  if (classId === "espadachim") {
    g.add(sword(0.45), sword(-0.45));
  } else if (classId === "guerreiro") {
    g.add(sword(0.45));
    const shield = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.32, 0.04, 20),
      new THREE.MeshStandardMaterial({ color: 0x5a6a7a, roughness: 0.5, metalness: 0.6 }),
    );
    shield.rotation.x = Math.PI / 2;
    shield.position.set(-0.5, 1.05, 0.05);
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), gold);
    boss.position.set(-0.5, 1.05, -0.02);
    g.add(shield, boss);
  } else if (classId === "atirador") {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.8, 10), steel);
    barrel.rotation.x = Math.PI / 2 - 0.15;
    barrel.position.set(0.15, 1.05, -0.25);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.3), grip);
    stock.position.set(0.15, 0.95, 0.15);
    g.add(barrel, stock);
  } else {
    // curandeiro: staff + glowing orb (foco sagrado)
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 1.6, 8), grip);
    staff.position.set(0.5, 1.1, 0.05);
    staff.rotation.z = 0.1;
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), holy);
    orb.position.set(0.56, 1.95, 0.05);
    g.add(staff, orb);
  }
  return g;
}

function terrainHeightFor(zone: ZoneData, x: number, z: number): number {
  // Deterministic terrain, flattened near spawn. No Math.random.
  const d = Math.hypot(x, z);
  let flat = Math.min(1, Math.max(0, (d - 6) / 14));
  let h: number;
  if (zone.biome === "desert") {
    // Marked dunes: long low-frequency waves + sharp crests (abs term),
    // so the silhouette reads as dunes instead of gentle bumps.
    h =
      2.6 * Math.sin(x * 0.05) * Math.cos(z * 0.04) +
      0.9 * Math.abs(Math.sin(x * 0.045 + 0.7) * Math.cos(z * 0.035)) +
      0.5 * Math.sin(x * 0.13 + z * 0.09) +
      0.2 * Math.sin(x * 0.31 - z * 0.27);
  } else if (zone.zone.id === "cidade_serket") {
    // City: nearly flat (plaza + streets stay walkable, buildings sit level);
    // only a gentle rise toward the wall.
    flat = Math.min(1, Math.max(0, (d - 20) / 18));
    h = 0.5 * Math.sin(x * 0.06) * Math.cos(z * 0.05) + 0.2 * Math.sin(x * 0.21 + z * 0.17);
  } else {
    h =
      1.4 * Math.sin(x * 0.08) * Math.cos(z * 0.06) +
      0.6 * Math.sin(x * 0.23 + z * 0.17) +
      0.25 * Math.sin(x * 0.51 - z * 0.43);
  }
  return h * flat;
}

/**
 * Placeholder character: capsule + head + facing marker + class weapon.
 * Gender changes the silhouette (f: narrower shoulders, m: broader/muscular);
 * armor recolors the body and the aura ring. No external assets.
 */
function makePlaceholder(
  color: number,
  opts: { gender?: string; classId?: string; armor?: ArmorData | null } = {},
): { group: THREE.Group; bodyMat: THREE.MeshStandardMaterial; ringMat: THREE.MeshBasicMaterial } {
  const g = new THREE.Group();
  const armor = opts.armor ?? null;
  const bodyColor = armor ? Number.parseInt(armor.colors.primary.slice(1), 16) : color;
  const mat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.6, metalness: 0.1 });
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
  const auraColor = armor ? Number.parseInt(armor.aura.slice(1), 16) : color;
  const ringMat = new THREE.MeshBasicMaterial({ color: auraColor, side: THREE.DoubleSide, transparent: true, opacity: 0.7 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.55, 24), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  g.add(body, head, nose, ring);
  if (opts.classId) g.add(makeWeapon(opts.classId));
  // Gender silhouette (adults only, no nudity): f narrower, m broader/taller.
  const sx = opts.gender === "m" ? 1.12 : 0.92;
  const sy = opts.gender === "m" ? 1.04 : 0.98;
  g.scale.set(sx, sy, 1);
  return { group: g, bodyMat: mat, ringMat };
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

// ---------------------------------------------------------------------------
// Scenario helpers (city / dunes / dungeon builders in WorldView).
// ---------------------------------------------------------------------------

/** One shared material per surface for a whole zone build (no per-mesh mats). */
interface ZoneMats {
  wall: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  roofGold: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  stoneDark: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  crimson: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  jade: THREE.MeshStandardMaterial;
  leaf: THREE.MeshStandardMaterial;
  trunk: THREE.MeshStandardMaterial;
  water: THREE.MeshStandardMaterial;
  lanternGlow: THREE.MeshStandardMaterial;
  flame: THREE.MeshBasicMaterial;
  petal: THREE.MeshStandardMaterial;
  cloud: THREE.MeshBasicMaterial;
}

/** One instance placement for makeInstanced (position + optional rotation/scale). */
interface InstancedItem {
  x: number;
  y: number;
  z: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  s?: number;
}

/** Shared-geometry InstancedMesh from a placement list (one draw call). */
function makeInstanced(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  items: InstancedItem[],
): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, items.length);
  const d = new THREE.Object3D();
  items.forEach((it, i) => {
    d.position.set(it.x, it.y, it.z);
    d.rotation.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0);
    const s = it.s ?? 1;
    d.scale.set((it.sx ?? 1) * s, (it.sy ?? 1) * s, (it.sz ?? 1) * s);
    d.updateMatrix();
    m.setMatrixAt(i, d.matrix);
  });
  m.instanceMatrix.needsUpdate = true;
  return m;
}

// ---------------------------------------------------------------------------
// GLB character rig (warrior_f_r64_final.glb, Rigify DEF chain, no clips).
// The GLB has no animations, so the pose is procedural: every frame the
// animated DEF bones get a small LOCAL rotation delta on top of their rest
// quaternion (base * delta — never overwrite the rest pose). Bone axes were
// measured in Blender (wrapper space, character forward = -Z, up = +Y):
//   - measured in Blender (single-bone +0.3 rad probes, character faces
//     -Y there): thigh/shin local +X swings the foot BACKWARD and
//     upper_arm/forearm local +X swings the hand FORWARD, on BOTH sides
//     (no L/R mirror — Rigify rolls are consistent). So a forward limb
//     angle maps to -X on thigh/shin (shin "forward" = knee bend, foot
//     back) and +X on upper_arm/forearm;
//   - spine local +Y is up (pitch = X, twist = Y), hand local +Y points
//     down and hand local +Z points forward-ish.
// Angles below are in "forward space": positive = limb forward / torso
// leaning forward; glbLimbSign converts to the bone's local X sign.
// ---------------------------------------------------------------------------

/** DEF bones driven by the procedural pose (base name; ".001" twin included). */
const GLB_LIMB_BONES = [
  "DEF-thigh.L",
  "DEF-thigh.R",
  "DEF-shin.L",
  "DEF-shin.R",
  "DEF-upper_arm.L",
  "DEF-upper_arm.R",
  "DEF-forearm.L",
  "DEF-forearm.R",
] as const;
/** Spine segments share the torso pitch (weights sum to 1); twist on DEF-spine only. */
const GLB_SPINE_BONES = ["DEF-spine", "DEF-spine.001", "DEF-spine.002", "DEF-spine.003"] as const;
const GLB_SPINE_PITCH_SHARE = [0.35, 0.25, 0.2, 0.2];

interface GlbPoseAngles {
  x: number;
  y: number;
  z: number;
}

/** Per-instance procedural rig state for one GLB character clone. */
interface GlbRig {
  bones: Map<string, THREE.Bone>;
  baseQuat: Map<string, THREE.Quaternion>;
  current: Map<string, GlbPoseAngles>;
  materials: THREE.MeshStandardMaterial[];
  baseColors: THREE.Color[];
  ringMat: THREE.MeshBasicMaterial;
  handR: THREE.Object3D | null;
  handL: THREE.Object3D | null;
  forearmL: THREE.Object3D | null;
  /** Walk-cycle phase (radians), advanced only while animState == 1. */
  phase: number;
  lastT: number;
}

const _poseEuler = new THREE.Euler();
const _poseQuat = new THREE.Quaternion();

/** Limb sign (measured): legs swing forward on -X, arms on +X, both sides. */
function glbLimbSign(boneName: string): number {
  return boneName.includes("DEF-thigh") || boneName.includes("DEF-shin") ? -1 : 1;
}

/**
 * Target pose for one animState (wire values: 0 idle, 1 walk, 2 attack,
 * 3 dodge, 4 guard, 5 skill; 6+ fall back to a hurt/idle pose).
 * Returns bone-local Euler deltas (radians). `tSec` drives idle breathing,
 * `phase` drives the walk cycle.
 */
function glbPoseTarget(animState: number, tSec: number, phase: number): Map<string, GlbPoseAngles> {
  // Forward-space values (positive = limb forward / torso leaning forward).
  let spinePitch = 0.02 + 0.02 * Math.sin(tSec * 1.6);
  let spineTwist = 0;
  let thighL = 0;
  let thighR = 0;
  let shinL = -0.06;
  let shinR = -0.06;
  let armL = 0.04;
  let armR = 0.04;
  let foreL = 0.22;
  let foreR = 0.22;
  if (animState === 1) {
    // Walk: legs alternate, arms counter-swing, knees bend on the trailing leg.
    const s = Math.sin(phase);
    thighL = 0.5 * s;
    thighR = -0.5 * s;
    shinL = -0.08 - 0.5 * Math.max(0, -s);
    shinR = -0.08 - 0.5 * Math.max(0, s);
    armL = -0.35 * s;
    armR = 0.35 * s;
    foreL = 0.3;
    foreR = 0.3;
    spinePitch = 0.07 + 0.02 * Math.sin(phase * 2);
    spineTwist = 0.07 * s;
  } else if (animState === 2) {
    // Attack: torso twist + lunge, right arm drives forward, left arm back.
    spinePitch = 0.18;
    spineTwist = 0.3;
    armR = 1.05;
    foreR = 0.1;
    armL = -0.35;
    foreL = 0.5;
    thighL = 0.3;
    thighR = -0.35;
    shinL = -0.15;
    shinR = -0.3;
  } else if (animState === 3) {
    // Dodge: crouch — thighs forward, knees bent, arms forward.
    spinePitch = 0.25;
    thighL = 0.45;
    thighR = 0.45;
    shinL = -0.7;
    shinR = -0.7;
    armL = 0.5;
    armR = 0.5;
    foreL = 0.6;
    foreR = 0.6;
  } else if (animState === 4) {
    // Guard: both arms raised in front, forearms up across the body.
    spinePitch = 0.08;
    armL = 0.9;
    armR = 0.9;
    foreL = 0.95;
    foreR = 0.95;
    thighL = 0.12;
    thighR = -0.12;
    shinL = -0.2;
    shinR = -0.2;
  } else if (animState === 5) {
    // Skill: bigger version of the attack (full torso twist, arm overhead).
    spinePitch = 0.22;
    spineTwist = 0.45;
    armR = 1.3;
    foreR = 0.2;
    armL = 0.6;
    foreL = 0.5;
    thighL = 0.35;
    thighR = -0.3;
    shinL = -0.25;
    shinR = -0.25;
  } else if (animState >= 6) {
    // Stagger / knockdown / dead: lean back, arms slack.
    spinePitch = -0.12;
    armL = -0.3;
    armR = -0.3;
    foreL = 0.15;
    foreR = 0.15;
  }
  const fwd: Record<string, number> = {
    "DEF-thigh.L": thighL,
    "DEF-thigh.R": thighR,
    "DEF-shin.L": shinL,
    "DEF-shin.R": shinR,
    "DEF-upper_arm.L": armL,
    "DEF-upper_arm.R": armR,
    "DEF-forearm.L": foreL,
    "DEF-forearm.R": foreR,
  };
  const out = new Map<string, GlbPoseAngles>();
  for (const name of GLB_LIMB_BONES) {
    // ".001" twins are children in the same chain: split the limb angle
    // 50/50 so the total bend below the joint equals the intended angle.
    const base = name.replace(".001", "");
    const v = fwd[base] ?? 0;
    out.set(name, { x: glbLimbSign(name) * v * 0.5, y: 0, z: 0 });
    out.set(`${name}.001`, { x: glbLimbSign(name) * v * 0.5, y: 0, z: 0 });
  }
  GLB_SPINE_BONES.forEach((name, i) => {
    const share = GLB_SPINE_PITCH_SHARE[i] ?? 0;
    out.set(name, { x: spinePitch * share, y: name === "DEF-spine" ? spineTwist : 0, z: 0 });
  });
  return out;
}

/** Hand-space weapon palette (same look as makeWeapon, built at the hand origin). */
function glbWeaponMats(): {
  steel: THREE.MeshStandardMaterial;
  grip: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  holy: THREE.MeshStandardMaterial;
} {
  return {
    steel: new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.35, metalness: 0.8 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.4, metalness: 0.7 }),
    holy: new THREE.MeshStandardMaterial({ color: 0xffe98a, roughness: 0.3, metalness: 0.2, emissive: 0xaa8811 }),
  };
}

/**
 * One-handed weapon in hand-local space: grip at the hand origin, blade
 * along +Y. The anchor is rotated X by PI so the blade points up (hand
 * local +Y points down in rest pose).
 */
function makeHandSword(mats: ReturnType<typeof glbWeaponMats>): THREE.Group {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.75, 0.015), mats.steel);
  blade.position.y = 0.48;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.04), mats.gold);
  guard.position.y = 0.09;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 8), mats.grip);
  g.add(blade, guard, handle);
  g.rotation.x = Math.PI;
  return g;
}

function makeHandStaff(mats: ReturnType<typeof glbWeaponMats>): THREE.Group {
  const g = new THREE.Group();
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 1.6, 8), mats.grip);
  staff.position.y = 0.7;
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), mats.holy);
  orb.position.y = 1.55;
  g.add(staff, orb);
  g.rotation.x = Math.PI;
  return g;
}

/**
 * Rifle in hand-local space: barrel along +Z (hand local +Z points
 * forward-ish). The anchor is yawed -0.67 rad about hand-local Y so the
 * barrel points straight forward instead of ~38° off to the side.
 */
function makeHandRifle(mats: ReturnType<typeof glbWeaponMats>): THREE.Group {
  const g = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.8, 10), mats.steel);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -0.3;
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.3), mats.grip);
  stock.position.set(0, -0.03, 0.12);
  g.add(barrel, stock);
  g.rotation.y = -0.67;
  return g;
}

function makeHandShield(mats: ReturnType<typeof glbWeaponMats>): THREE.Group {
  const g = new THREE.Group();
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 20), mats.steel);
  shield.rotation.x = Math.PI / 2;
  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), mats.gold);
  boss.position.z = -0.03;
  g.add(shield, boss);
  return g;
}

export class WorldView {
  backend: Backend = "webgl2";
  renderer!: RendererLike;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** Active zone data (cidade/dunas/dungeon visuals). */
  private activeZone: ZoneData = ZONE;
  /** Dungeon id when ?dungeon= is set (tumbas/templo): own geometry, flat floor. */
  private dungeonId: string | null = null;
  /** 2.5D is the vertical-slice default; 3d restores the M0 orbit camera. */
  cameraMode: Camera25DMode = "2.5d";
  private zoom25D: number = CAMERA_25D.distanceM;
  /** Current armor set of the local player (visual + aura). */
  private currentArmor: ArmorData | null = null;
  private readonly players = new Map<number, {
    group: THREE.Group;
    guardDisc: THREE.Mesh;
    bodyMat?: THREE.MeshStandardMaterial;
    ringMat?: THREE.MeshBasicMaterial;
    classId?: string;
    /** Procedural GLB rig (null = capsule/CharForge whole-body animation). */
    rig?: GlbRig;
    /** Class the GLB weapon was attached for (weapons follow the hand bone). */
    glbWeaponClass?: string;
  }>();
  private readonly mobs = new Map<number, { group: THREE.Group; ring: THREE.Mesh }>();
  /** M2: the local player's CharForge character (LOD0). Null = capsule fallback. */
  private localCharacter: CharacterBuild | null = null;
  /** Last genome handed to setLocalGenome (gender for the GLB scale). */
  private lastGenome: CharacterGenome | null = null;
  /** GLB default character: single loaded template, cloned per player. */
  private glbTemplate: THREE.Group | null = null;
  private glbTriangles = 0;
  private glbLoadPromise: Promise<boolean> | null = null;
  /** "auto" = GLB when it loads, CharForge/capsule until then (default);
   *  "glb" = force the GLB (?char=warrior); "capsule" = never load it. */
  private charMode: "auto" | "glb" | "capsule" = "auto";
  /** GLB instance rigs, keyed by wrapper group (local + remote clones). */
  private readonly glbRigs = new WeakMap<THREE.Group, GlbRig>();
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

  /** 2.5D (fixed oblique) or 3D (orbit) camera. */
  setCameraMode(mode: Camera25DMode): void {
    this.cameraMode = mode;
  }

  /** Wheel zoom for the 2.5D camera (clamped 10–20 m). */
  setZoom25D(distanceM: number): void {
    this.zoom25D = clampCamera25DZoom(distanceM);
  }

  get zoom25DValue(): number {
    return this.zoom25D;
  }

  /** Which character mesh to use (main.ts: ?char=warrior|capsule, default auto). */
  setCharMode(mode: "auto" | "glb" | "capsule"): void {
    if (this.charMode === mode) return;
    this.charMode = mode;
    if (mode === "capsule") {
      // Back to CharForge/capsule: rebuild the local mesh from the genome.
      if (this.lastGenome) this.setLocalGenome(this.lastGenome);
      this.rebuildAllPlayers();
    } else if (this.glbTemplate) {
      this.applyGlbLocal();
      this.rebuildAllPlayers();
    }
  }

  /** Swap the local player's armor visual (body color + aura ring). */
  setArmor(armorId: string | null): void {
    this.currentArmor = armorId ? (armorById(armorId) ?? null) : null;
    if (this.localId === null) return;
    const entry = this.players.get(this.localId);
    if (!entry) return;
    if (entry.rig) {
      // GLB: light multiply-tint on the albedo (texture kept) + aura ring.
      this.applyArmorTint(entry.rig, this.currentArmor);
      if (entry.ringMat && this.currentArmor) {
        entry.ringMat.color.set(this.currentArmor.aura);
      }
      return;
    }
    if (entry.bodyMat && this.currentArmor) {
      entry.bodyMat.color.set(this.currentArmor.colors.primary);
    }
    if (entry.ringMat && this.currentArmor) {
      entry.ringMat.color.set(this.currentArmor.aura);
    }
  }

  /**
   * Light armor tint for a GLB rig: multiply the material color by a factor
   * lerped 45% from white toward the armor primary — the albedo texture is
   * kept, the hue just shifts toward the armor color. Null armor restores
   * the base colors.
   */
  private applyArmorTint(rig: GlbRig, armor: ArmorData | null): void {
    rig.materials.forEach((mat, i) => {
      const base = rig.baseColors[i];
      if (!base) return;
      if (!armor) {
        mat.color.copy(base);
        return;
      }
      const tint = new THREE.Color(1, 1, 1).lerp(new THREE.Color(armor.colors.primary), 0.45);
      mat.color.copy(base).multiply(tint);
    });
  }

  private terrainHeight(x: number, z: number): number {
    // Dungeons are flat stone floors (no dune/meadow heightfield).
    if (this.dungeonId) return 0;
    return terrainHeightFor(this.activeZone, x, z);
  }

  /** Try WebGPU first, fall back to WebGL2 (AGENTS.md: WebGPU with fallback). */
  async init(zoneId?: string, dungeonId?: string): Promise<void> {
    this.activeZone = (zoneId ? zoneById(zoneId) : undefined) ?? ZONE;
    this.dungeonId = dungeonId ?? null;
    const pal = this.activeZone.palette;
    this.scene.background = new THREE.Color(dungeonId ? "#1a1420" : pal.sky);
    this.scene.fog = new THREE.Fog(dungeonId ? "#241a2e" : pal.fog, dungeonId ? 35 : 60, dungeonId ? 130 : 160);
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
    if (this.dungeonId) {
      // Dungeon: dim cold ambient, weak warm sun leaking in — torches
      // (added in buildDungeon) do the local work, max 4 PointLights.
      const hemi = new THREE.HemisphereLight(0x8a7aa0, 0x1a1410, 0.5);
      const sun = new THREE.DirectionalLight(0xffd9a0, 0.5);
      sun.position.set(30, 50, -20);
      this.scene.add(hemi, sun);
      return;
    }
    const warmSun = this.activeZone.zone.id === "cidade_serket" ? 0xffe6b0 : this.activeZone.palette.sun;
    const hemi = new THREE.HemisphereLight(0xffe9c4, new THREE.Color(this.activeZone.palette.ground).getHex(), 1.05);
    const sun = new THREE.DirectionalLight(new THREE.Color(warmSun).getHex(), 2.0);
    sun.position.set(30, 50, -20);
    this.scene.add(hemi, sun);
  }

  private buildTerrain(): void {
    const size = this.activeZone.zone.sizeM;
    const geo = new THREE.PlaneGeometry(size, size, 64, 64);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const low = new THREE.Color(this.activeZone.palette.low);
    const high = new THREE.Color(this.activeZone.palette.high);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = this.terrainHeight(x, z);
      pos.setY(i, h);
      const t = Math.min(1, Math.max(0, h / 2));
      c.copy(low).lerp(high, t);
      if (this.dungeonId) {
        // Dark stone floor: subtle 4 m checker so the flat floor still reads.
        const checker = (Math.floor(x / 4) + Math.floor(z / 4)) % 2 === 0 ? 0 : 1;
        c.setHex(checker === 0 ? 0x4a4038 : 0x3d342c);
      } else if (this.activeZone.zone.id === "cidade_serket") {
        // Stone plaza (r < 11) + two stone streets (spawn -> portais E/O and
        // spawn -> templo N / mercado S), the rest stays meadow.
        const plaza = Math.hypot(x, z) < 11;
        const streetEW = Math.abs(z) < 2.5 && Math.abs(x) < 30;
        const streetNS = Math.abs(x) < 2.5 && Math.abs(z) < 34;
        if (plaza || streetEW || streetNS) c.setHex(0xd8cbb0);
      }
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    this.scene.add(new THREE.Mesh(geo, mat));
  }

  // -------------------------------------------------------------------------
  // Scenario builders (city / dunes / dungeon).
  // One shared material set per zone build (reused by every mesh); repetition
  // goes through InstancedMesh. Scatter uses sfc32 with a fixed seed — no
  // Math.random in gameplay or scenery. NPC markers and portal gates stay
  // in buildProps (fixed positions from gamedata, never moved).
  // -------------------------------------------------------------------------

  /** Shared materials for one zone build (city palette: jade/crimson/gold). */
  private makeZoneMats(dungeon: boolean): ZoneMats {
    return {
      wall: new THREE.MeshStandardMaterial({ color: dungeon ? 0x6a5a48 : 0xe8dcc0, roughness: 0.9 }),
      roof: new THREE.MeshStandardMaterial({ color: dungeon ? 0x4a3a2a : 0x2f6f6a, roughness: 0.85 }),
      roofGold: new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.4, metalness: 0.7 }),
      stone: new THREE.MeshStandardMaterial({ color: dungeon ? 0x5a4a3a : 0xcfc0a0, roughness: 1 }),
      stoneDark: new THREE.MeshStandardMaterial({ color: dungeon ? 0x3a2f26 : 0x8a7a5f, roughness: 1 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 }),
      crimson: new THREE.MeshStandardMaterial({ color: 0xa02030, roughness: 0.85 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.4, metalness: 0.7 }),
      jade: new THREE.MeshStandardMaterial({ color: 0x2e8b74, roughness: 0.8 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0x4a8a5a, roughness: 0.9 }),
      trunk: new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 }),
      water: new THREE.MeshStandardMaterial({
        color: 0x3fa8d8, roughness: 0.2, metalness: 0.1, emissive: 0x1a6a9a, emissiveIntensity: 0.6,
      }),
      lanternGlow: new THREE.MeshStandardMaterial({
        color: 0xffcc66, roughness: 0.4, emissive: 0xffb347, emissiveIntensity: 1.6,
      }),
      flame: new THREE.MeshBasicMaterial({ color: 0xff8833 }),
      petal: new THREE.MeshStandardMaterial({ color: 0xe88ab0, roughness: 0.6 }),
      cloud: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }),
    };
  }

  /**
   * Asian roof in layers: eave trim + two stacked 4-sided pyramid tiers +
   * gold ridge. The 4-sided cone is a square pyramid; rotated 45° its sides
   * align to the axes, so scale.x/z = w|d * 0.82 covers w|d with overhang
   * (half-side of the unit pyramid is 1/sqrt(2) ~= 0.707).
   */
  private asianRoof(mats: ZoneMats, w: number, d: number, y: number, tierH = 1.1): THREE.Group {
    const g = new THREE.Group();
    const trim = new THREE.Mesh(new THREE.BoxGeometry(w * 1.15, 0.1, d * 1.15), mats.roofGold);
    trim.position.y = y + 0.05;
    const tier1 = new THREE.Mesh(new THREE.ConeGeometry(1, tierH, 4), mats.roof);
    tier1.scale.set(w * 0.82, 1, d * 0.82);
    tier1.rotation.y = Math.PI / 4;
    tier1.position.y = y + 0.1 + tierH / 2;
    const tier2 = new THREE.Mesh(new THREE.ConeGeometry(1, tierH * 0.8, 4), mats.roof);
    tier2.scale.set(w * 0.45, 1, d * 0.45);
    tier2.rotation.y = Math.PI / 4;
    tier2.position.y = y + 0.1 + tierH + (tierH * 0.8) / 2;
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(w * 0.45, 0.12, 0.14), mats.roofGold);
    ridge.position.y = y + 0.1 + tierH * 1.8 + 0.05;
    g.add(trim, tier1, tier2, ridge);
    return g;
  }

  /** One house: plaster walls + layered Asian roof, facing the plaza. */
  private asianBuilding(mats: ZoneMats, w: number, h: number, d: number, x: number, z: number): void {
    const y = this.terrainHeight(x, z);
    const g = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats.wall);
    walls.position.y = h / 2;
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 0.12), mats.wood);
    door.position.set(0, 0.95, d / 2 + 0.02);
    const roof = this.asianRoof(mats, w, d, h);
    g.add(walls, door, roof);
    // Face the plaza (forward -Z rotated by atan2(x, z) points at origin).
    g.position.set(x, y, z);
    g.rotation.y = Math.atan2(x, z);
    this.scene.add(g);
  }

  /** Central lotus fountain: basin + rim + glowing blue water + lotus column.
   * Offset to (7,-7): the spawn point (0,0) sits inside the basin footprint,
   * and the 0.7 m basin wall hid the player's legs from the 2.5D camera. */
  private buildFountain(mats: ZoneMats): void {
    const fx = 7;
    const fz = -7;
    const y = this.terrainHeight(fx, fz);
    const g = new THREE.Group();
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.5, 0.7, 24), mats.stone);
    basin.position.y = 0.35;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.18, 8, 32), mats.stoneDark);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.7;
    const water = new THREE.Mesh(new THREE.CircleGeometry(2.9, 24), mats.water);
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.62;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 2.2, 10), mats.stone);
    column.position.y = 1.7;
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), mats.water);
    orb.position.y = 2.95;
    g.add(basin, rim, water, column, orb);
    // Lotus petals around the column top (6 meshes, shared petal material).
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      const petal = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 6), mats.petal);
      petal.position.set(Math.cos(a) * 0.55, 2.5, Math.sin(a) * 0.55);
      petal.rotation.z = Math.cos(a) * 0.9;
      petal.rotation.x = -Math.sin(a) * 0.9;
      g.add(petal);
    }
    g.position.set(fx, y, fz);
    this.scene.add(g);
  }

  /** Temple of the Sun, north side (z < 0): steps, columns, pediment, double roof. */
  private buildTemple(mats: ZoneMats): void {
    const cz = -30;
    const y = this.terrainHeight(0, cz);
    const g = new THREE.Group();
    const steps: Array<[number, number, number, number]> = [
      [14, 0.4, 10, 0.2],
      [12, 0.4, 8.5, 0.6],
      [10, 0.4, 7, 1.0],
    ];
    for (const [w, h, d, py] of steps) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats.stone);
      s.position.set(0, py, 0);
      g.add(s);
    }
    const floor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.3, 6), mats.stone);
    floor.position.set(0, 1.35, 0);
    const back = new THREE.Mesh(new THREE.BoxGeometry(9, 4.5, 0.6), mats.wall);
    back.position.set(0, 3.75, -2.8);
    const door = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.12), mats.wood);
    door.position.set(0, 3.0, -2.45);
    // Triangular pediment: 4-sided cone squashed flat in z, gold-trimmed.
    const pediment = new THREE.Mesh(new THREE.ConeGeometry(3.2, 1.5, 4), mats.roof);
    pediment.scale.set(1.25, 1, 0.22);
    pediment.rotation.y = Math.PI / 4;
    pediment.position.set(0, 6.7, 2.6);
    const roof = this.asianRoof(mats, 11, 8, 6.0, 1.4);
    g.add(floor, back, door, pediment, roof);
    // 6 front columns (one InstancedMesh).
    const cols: InstancedItem[] = [];
    for (let i = 0; i < 6; i += 1) cols.push({ x: -3.75 + i * 1.5, y: 3.6, z: 2.6 });
    g.add(makeInstanced(new THREE.CylinderGeometry(0.35, 0.4, 4.2, 10), mats.stone, cols));
    g.position.set(0, y, cz);
    this.scene.add(g);
  }

  /** Market stall: 4 posts, striped crimson/gold awning, counter + goods. */
  private marketStall(mats: ZoneMats, x: number, z: number, ry: number): void {
    const y = this.terrainHeight(x, z);
    const g = new THREE.Group();
    const postGeo = new THREE.CylinderGeometry(0.07, 0.09, 2.3, 6);
    for (const [px, pz] of [[-1.6, -1.3], [1.6, -1.3], [-1.6, 1.3], [1.6, 1.3]] as const) {
      const post = new THREE.Mesh(postGeo, mats.wood);
      post.position.set(px, 1.15, pz);
      g.add(post);
    }
    // Awning: 5 alternating stripes across the width (crimson/gold).
    for (let i = 0; i < 5; i += 1) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.74, 0.08, 3.1),
        i % 2 === 0 ? mats.crimson : mats.gold,
      );
      stripe.position.set(-1.48 + i * 0.74, 2.35, 0);
      g.add(stripe);
    }
    const counter = new THREE.Mesh(new THREE.BoxGeometry(3, 0.9, 1.2), mats.wood);
    counter.position.set(0, 0.45, 0.4);
    const goods: Array<[number, number, THREE.Material]> = [
      [-0.9, 1.05, mats.jade],
      [0, 1.1, mats.gold],
      [0.9, 1.05, mats.crimson],
    ];
    for (const [gx, gy, gm] of goods) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), gm);
      box.position.set(gx, gy, 0.4);
      g.add(box);
    }
    g.add(counter);
    g.position.set(x, y, z);
    g.rotation.y = ry;
    this.scene.add(g);
  }

  /**
   * Cidade de Serket — structured layout, not scatter: plaza + fountain at
   * the center, a ring of 8 Asian-roofed houses, the Temple of the Sun to
   * the north, 4 market stalls on the diagonals, a jade wall with a gate on
   * each side (east/west, on the portal axis), trees + lanterns lining the
   * stone streets, and a few flat clouds overhead. NPCs and portal gates
   * are added by buildProps from gamedata (unchanged positions).
   */
  private buildCity(mats: ZoneMats): void {
    this.buildFountain(mats);
    // Ring of 8 houses at r = 20, offset 30°/60° so the street axes stay open.
    const rng = sfc32(20261111);
    for (let i = 0; i < 8; i += 1) {
      const deg = 30 + (i % 2) * 30 + Math.floor(i / 2) * 90;
      const a = (deg * Math.PI) / 180;
      const x = Math.cos(a) * 20;
      const z = Math.sin(a) * 20;
      this.asianBuilding(mats, 4.5 + rng() * 2, 3 + rng() * 1.5, 3.6 + rng() * 1.2, x, z);
    }
    this.buildTemple(mats);
    // Market stalls on the four diagonals (between the houses, off the streets).
    this.marketStall(mats, 12, 12, Math.PI / 4);
    this.marketStall(mats, -12, 12, -Math.PI / 4);
    this.marketStall(mats, 12, -12, (3 * Math.PI) / 4);
    this.marketStall(mats, -12, -12, -(3 * Math.PI) / 4);
    // Jade wall: instanced segments around r = 44, gaps at the east/west gates.
    const wallItems: InstancedItem[] = [];
    for (let i = 0; i < 30; i += 1) {
      const a = (i / 30) * Math.PI * 2;
      const deg = (a * 180) / Math.PI;
      if (Math.min(Math.abs(deg), Math.abs(deg - 180)) < 12) continue; // gate gaps
      wallItems.push({ x: Math.cos(a) * 44, y: 1.6, z: Math.sin(a) * 44, ry: -a - Math.PI / 2 });
    }
    this.scene.add(makeInstanced(new THREE.BoxGeometry(4.6, 3.2, 1.1), mats.jade, wallItems));
    // Gate towers flanking each gate (4 towers, 2 meshes each).
    for (const [gx, gz] of [[44, -3.5], [44, 3.5], [-44, -3.5], [-44, 3.5]] as const) {
      const gy = this.terrainHeight(gx, gz);
      const tower = new THREE.Mesh(new THREE.BoxGeometry(2.5, 6.5, 2.5), mats.stone);
      tower.position.set(gx, gy + 3.25, gz);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.4, 4), mats.roof);
      cap.rotation.y = Math.PI / 4;
      cap.position.set(gx, gy + 7.2, gz);
      this.scene.add(tower, cap);
    }
    // Trees lining the streets (24, instanced trunk + two-tier canopy so
    // they read as trees instead of single cones).
    const treePos: Array<[number, number]> = [];
    for (const s of [-28, -20, -12, 12, 20, 28]) {
      treePos.push([6.5, s], [-6.5, s], [s, 6.5], [s, -6.5]);
    }
    this.scene.add(
      makeInstanced(
        new THREE.CylinderGeometry(0.18, 0.28, 2.6, 6),
        mats.trunk,
        treePos.map(([x, z]) => ({ x, y: this.terrainHeight(x, z) + 1.3, z })),
      ),
    );
    this.scene.add(
      makeInstanced(
        new THREE.ConeGeometry(1.6, 2.4, 8),
        mats.leaf,
        treePos.map(([x, z]) => ({ x, y: this.terrainHeight(x, z) + 3.6, z })),
      ),
    );
    this.scene.add(
      makeInstanced(
        new THREE.ConeGeometry(1.0, 1.6, 8),
        mats.leaf,
        treePos.map(([x, z]) => ({ x, y: this.terrainHeight(x, z) + 5.0, z })),
      ),
    );
    // Lanterns along both streets (28, instanced post + small glowing box + cap).
    const lampPos: Array<[number, number]> = [];
    for (let s = -24; s <= 24; s += 8) {
      lampPos.push([3.4, s], [-3.4, s], [s, 3.4], [s, -3.4]);
    }
    this.scene.add(
      makeInstanced(
        new THREE.CylinderGeometry(0.05, 0.07, 2.4, 6),
        mats.wood,
        lampPos.map(([x, z]) => ({ x, y: this.terrainHeight(x, z) + 1.2, z })),
      ),
    );
    this.scene.add(
      makeInstanced(
        new THREE.BoxGeometry(0.32, 0.4, 0.32),
        mats.lanternGlow,
        lampPos.map(([x, z]) => ({ x, y: this.terrainHeight(x, z) + 2.5, z })),
      ),
    );
    this.scene.add(
      makeInstanced(
        new THREE.ConeGeometry(0.28, 0.22, 4),
        mats.roofGold,
        lampPos.map(([x, z]) => ({ x, y: this.terrainHeight(x, z) + 2.8, z, ry: Math.PI / 4 })),
      ),
    );
    // Cheap sky: 6 flat translucent cloud blobs high above the city.
    const clouds: InstancedItem[] = [];
    const crng = sfc32(20261112);
    for (let i = 0; i < 6; i += 1) {
      clouds.push({
        x: (crng() * 2 - 1) * 40,
        y: 32 + crng() * 8,
        z: (crng() * 2 - 1) * 40,
        sx: 5 + crng() * 4,
        sy: 1.2,
        sz: 2.5 + crng() * 2,
      });
    }
    this.scene.add(makeInstanced(new THREE.SphereGeometry(1, 10, 8), mats.cloud, clouds));
    // Rocks near the wall (6, instanced).
    const rocks: InstancedItem[] = [];
    const rrng = sfc32(20261113);
    for (let i = 0; i < 6; i += 1) {
      const a = rrng() * Math.PI * 2;
      const r = 38 + rrng() * 4;
      rocks.push({
        x: Math.cos(a) * r,
        y: this.terrainHeight(Math.cos(a) * r, Math.sin(a) * r) + 0.3,
        z: Math.sin(a) * r,
        ry: rrng() * Math.PI,
        s: 0.6 + rrng() * 0.9,
      });
    }
    this.scene.add(makeInstanced(new THREE.DodecahedronGeometry(0.7, 0), mats.stoneDark, rocks));
  }

  /**
   * Dunas de Serket — marked dunes (terrain heightfield), an oasis with
   * grouped palms, a ruined arch + broken columns, and rocks/cacti kept off
   * the paths (spawn radius and the east-west track stay clear).
   */
  private buildDunes(mats: ZoneMats): void {
    const rng = sfc32(20261111);
    const clearOfPaths = (x: number, z: number, margin: number): boolean =>
      Math.hypot(x, z) > 8 + margin && Math.abs(z) > 3 + margin;
    // Oasis at (20, 16): water disc + sand ring + 8 grouped palms.
    const ox = 20;
    const oz = 16;
    const oy = this.terrainHeight(ox, oz);
    const water = new THREE.Mesh(new THREE.CircleGeometry(6, 28), mats.water);
    water.rotation.x = -Math.PI / 2;
    water.position.set(ox, oy + 0.15, oz);
    const sand = new THREE.Mesh(
      new THREE.RingGeometry(6, 7.5, 28),
      new THREE.MeshStandardMaterial({ color: 0xecd29b, roughness: 1 }),
    );
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(ox, oy + 0.08, oz);
    this.scene.add(water, sand);
    const palmPos: Array<[number, number]> = [];
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2 + rng() * 0.4;
      const r = 8 + rng() * 2.5;
      palmPos.push([ox + Math.cos(a) * r, oz + Math.sin(a) * r]);
    }
    for (let i = 0; i < 4; i += 1) {
      palmPos.push([(rng() * 2 - 1) * 45, (rng() * 2 - 1) * 45]);
    }
    this.scene.add(
      makeInstanced(
        new THREE.CylinderGeometry(0.18, 0.28, 2.6, 6),
        mats.trunk,
        palmPos.map(([x, z]) => ({
          x,
          y: this.terrainHeight(x, z) + 1.3,
          z,
          rz: (rng() - 0.5) * 0.3,
        })),
      ),
    );
    this.scene.add(
      makeInstanced(
        new THREE.ConeGeometry(1.5, 1.4, 8),
        mats.leaf,
        palmPos.map(([x, z]) => ({ x, y: this.terrainHeight(x, z) + 3.0, z })),
      ),
    );
    // Ruined arch + broken columns at (-22, -18).
    const ax = -22;
    const az = -18;
    const ay = this.terrainHeight(ax, az);
    const pillarGeo = new THREE.BoxGeometry(1, 5, 1);
    for (const dx of [-2.5, 2.5]) {
      const p = new THREE.Mesh(pillarGeo, mats.stone);
      p.position.set(ax + dx, ay + 2.5, az);
      this.scene.add(p);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(6.5, 1, 1.2), mats.stone);
    lintel.position.set(ax, ay + 5.4, az);
    this.scene.add(lintel);
    const broken: InstancedItem[] = [];
    for (let i = 0; i < 6; i += 1) {
      const bx = ax - 6 + rng() * 12;
      const bz = az + 4 + rng() * 8;
      broken.push({
        x: bx,
        y: this.terrainHeight(bx, bz) + 0.4 + rng() * 0.8,
        z: bz,
        rz: (rng() - 0.5) * 0.25,
        sy: 0.4 + rng() * 0.8,
      });
    }
    this.scene.add(makeInstanced(new THREE.CylinderGeometry(0.4, 0.45, 1.8, 8), mats.stone, broken));
    // Rocks (24) and cacti (10), off the paths.
    const rocks: InstancedItem[] = [];
    let guard = 0;
    while (rocks.length < 24 && guard < 300) {
      guard += 1;
      const x = (rng() * 2 - 1) * 55;
      const z = (rng() * 2 - 1) * 55;
      if (!clearOfPaths(x, z, 0)) continue;
      if (Math.hypot(x - ox, z - oz) < 11) continue;
      rocks.push({ x, y: this.terrainHeight(x, z) + 0.3, z, ry: rng() * Math.PI, s: 0.5 + rng() * 1.2 });
    }
    this.scene.add(makeInstanced(new THREE.DodecahedronGeometry(0.7, 0), mats.stoneDark, rocks));
    const cacti: InstancedItem[] = [];
    guard = 0;
    while (cacti.length < 10 && guard < 200) {
      guard += 1;
      const x = (rng() * 2 - 1) * 50;
      const z = (rng() * 2 - 1) * 50;
      if (!clearOfPaths(x, z, 0)) continue;
      if (Math.hypot(x - ox, z - oz) < 11) continue;
      cacti.push({ x, y: this.terrainHeight(x, z) + 0.9, z, sy: 0.8 + rng() * 0.6 });
    }
    this.scene.add(makeInstanced(new THREE.CylinderGeometry(0.25, 0.3, 1.8, 8), mats.leaf, cacti));
    this.scene.add(
      makeInstanced(
        new THREE.SphereGeometry(0.25, 8, 6),
        mats.leaf,
        cacti.map((c) => ({ x: c.x, y: c.y + 0.9 * (c.sy ?? 1), z: c.z })),
      ),
    );
  }

  /**
   * Dungeons (tumbas / templo) — flat dark stone floor (terrain), stone
   * walls around a 76 x 76 m hall with an entrance gap to the south, two
   * rows of pillars, torches on 4 pillars (flame + max 4 PointLights),
   * and an altar with a boss ring at the far (north) end. Tumbas adds
   * sarcophagi; templo adds gold altar trim. No ceiling.
   */
  private buildDungeon(mats: ZoneMats): void {
    const isTemplo = this.dungeonId === "templo";
    // Perimeter walls (instanced), entrance gap |x| < 4 on the south side.
    const wallItems: InstancedItem[] = [];
    const half = 38;
    for (let s = -half; s < half; s += 4.6) {
      wallItems.push({ x: s + 2.3, y: 2.5, z: -half, ry: 0 });
      if (Math.abs(s + 2.3) > 4) wallItems.push({ x: s + 2.3, y: 2.5, z: half, ry: 0 });
      wallItems.push({ x: -half, y: 2.5, z: s + 2.3, ry: Math.PI / 2 });
      wallItems.push({ x: half, y: 2.5, z: s + 2.3, ry: Math.PI / 2 });
    }
    this.scene.add(makeInstanced(new THREE.BoxGeometry(4.6, 5, 1.2), mats.stoneDark, wallItems));
    // Two rows of pillars (12) + capitals (instanced).
    const pillars: InstancedItem[] = [];
    for (const px of [-12, 12]) {
      for (let z = -30; z <= 30; z += 12) pillars.push({ x: px, y: 2.5, z });
    }
    this.scene.add(makeInstanced(new THREE.CylinderGeometry(0.6, 0.7, 5, 10), mats.stone, pillars));
    this.scene.add(
      makeInstanced(
        new THREE.BoxGeometry(1.6, 0.4, 1.6),
        mats.stoneDark,
        pillars.map((p) => ({ x: p.x, y: 5.2, z: p.z })),
      ),
    );
    // Torches on 4 pillars: holder + emissive flame + 4 PointLights (max).
    const torchPos: Array<[number, number]> = [[-12, -18], [12, -18], [-12, 18], [12, 18]];
    this.scene.add(
      makeInstanced(
        new THREE.CylinderGeometry(0.08, 0.08, 0.7, 6),
        mats.wood,
        torchPos.map(([x, z]) => ({ x: x + 0.8, y: 3.4, z })),
      ),
    );
    this.scene.add(
      makeInstanced(
        new THREE.ConeGeometry(0.22, 0.6, 8),
        mats.flame,
        torchPos.map(([x, z]) => ({ x: x + 0.8, y: 3.9, z })),
      ),
    );
    for (const [x, z] of torchPos) {
      const light = new THREE.PointLight(0xff7733, 40, 30, 1.8);
      light.position.set(x + 0.8, 3.9, z);
      this.scene.add(light);
    }
    // Altar at the far (north) end + crimson boss ring on the floor.
    const az = -32;
    const step1 = new THREE.Mesh(new THREE.BoxGeometry(10, 0.4, 6), mats.stone);
    step1.position.set(0, 0.2, az);
    const step2 = new THREE.Mesh(new THREE.BoxGeometry(8, 0.4, 4.5), mats.stone);
    step2.position.set(0, 0.6, az);
    const altar = new THREE.Mesh(new THREE.BoxGeometry(3, 1.2, 1.5), isTemplo ? mats.gold : mats.stoneDark);
    altar.position.set(0, 1.4, az);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.5, 4.2, 32),
      new THREE.MeshBasicMaterial({ color: 0xff2a3a, side: THREE.DoubleSide, transparent: true, opacity: 0.6 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.05, az);
    this.scene.add(step1, step2, altar, ring);
    if (!isTemplo) {
      // Tumbas: 4 sarcophagi along the side walls.
      this.scene.add(
        makeInstanced(
          new THREE.BoxGeometry(2, 1, 1),
          mats.stone,
          [
            { x: -30, y: 0.5, z: -10 },
            { x: -30, y: 0.5, z: 10 },
            { x: 30, y: 0.5, z: -10 },
            { x: 30, y: 0.5, z: 10 },
          ],
        ),
      );
    }
    // Rubble (8, instanced).
    const rng = sfc32(20261114);
    const rubble: InstancedItem[] = [];
    for (let i = 0; i < 8; i += 1) {
      rubble.push({
        x: (rng() * 2 - 1) * 30,
        y: 0.2,
        z: (rng() * 2 - 1) * 30,
        ry: rng() * Math.PI,
        s: 0.4 + rng() * 0.7,
      });
    }
    this.scene.add(makeInstanced(new THREE.DodecahedronGeometry(0.7, 0), mats.stoneDark, rubble));
  }

  private buildProps(): void {
    const mats = this.makeZoneMats(this.dungeonId !== null);
    if (this.dungeonId) {
      this.buildDungeon(mats);
    } else if (this.activeZone.zone.id === "cidade_serket") {
      this.buildCity(mats);
    } else {
      this.buildDunes(mats);
    }
    // City NPC markers + portals from the zone data (fixed positions).
    // NPCs read as robed figures (cone robe + head), not green capsules.
    for (const npc of this.activeZone.npcs ?? []) {
      const [nx, , nz] = WORLD_TO_THREE(npc.x, npc.y);
      const ny = this.terrainHeight(nx, nz);
      const robe = new THREE.Mesh(
        new THREE.ConeGeometry(0.45, 1.5, 8),
        new THREE.MeshStandardMaterial({ color: 0x2e8b74, roughness: 0.7 }),
      );
      robe.position.set(nx, ny + 0.75, nz);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0xf2d6c2, roughness: 0.5 }),
      );
      head.position.set(nx, ny + 1.65, nz);
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.6, 0.75, 24),
        new THREE.MeshBasicMaterial({ color: 0xffd75a, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }),
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.set(nx, ny + 0.03, nz);
      this.scene.add(robe, head, halo);
    }
    for (const portal of this.activeZone.portals ?? []) {
      const [px, , pz] = WORLD_TO_THREE(portal.x, portal.y);
      const py = this.terrainHeight(px, pz);
      const gate = new THREE.Mesh(
        new THREE.TorusGeometry(1.8, 0.18, 10, 28),
        new THREE.MeshBasicMaterial({ color: 0x66d8ff, transparent: true, opacity: 0.7 }),
      );
      gate.position.set(px, py + 2, pz);
      this.scene.add(gate);
    }
  }


  /**
   * Clear the local character mesh. GLB instances share geometry/materials
   * with the template, so they are only removed from the scene — never
   * disposed (disposeCharacter would free the template's buffers). CharForge
   * builds own their geometry and are disposed.
   */
  private clearLocalCharacter(): void {
    if (!this.localCharacter) return;
    this.scene.remove(this.localCharacter.group);
    if (!this.glbRigs.has(this.localCharacter.group)) disposeCharacter(this.localCharacter);
    this.localCharacter = null;
  }

  /**
   * Set (or clear) the local player's CharForge genome. When the GLB
   * template is already loaded (and the mode allows it) the GLB is used
   * instead of the CharForge build — the genome still supplies class,
   * gender and armor. Null = capsule fallback.
   */
  setLocalGenome(genome: CharacterGenome | null): void {
    this.lastGenome = genome;
    if (genome && this.glbTemplate && this.charMode !== "capsule") {
      this.applyGlbLocal();
      return;
    }
    this.clearLocalCharacter();
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

  /** Drop every player mesh so the next updatePlayer rebuilds it (GLB swap). */
  private rebuildAllPlayers(): void {
    for (const [, entry] of this.players) {
      this.scene.remove(entry.group);
      if (!this.glbRigs.has(entry.group)) {
        disposeCharacter({ group: entry.group, drawCalls: 0, triangles: 0, heightM: 0 });
      }
    }
    this.players.clear();
  }

  /**
   * Build one GLB character instance from the loaded template: a
   * SkeletonUtils clone (own skeleton, shared geometry), inner scene
   * rotated PI (forward becomes -Z, like CharForge) and scaled to ~1.75 m
   * (m = 1.08x wider, 1.03x taller). Materials are cloned per instance so
   * the armor tint of one player never leaks into another's; skinned meshes
   * are never frustum-culled (their bounds don't follow bone animation).
   * Returns null when the template hasn't loaded yet.
   */
  private makeGlbInstance(opts: { gender?: string | undefined; armor?: ArmorData | null }): {
    group: THREE.Group;
    rig: GlbRig;
  } | null {
    if (!this.glbTemplate) return null;
    const inner = cloneSkinned(this.glbTemplate) as THREE.Group;
    inner.rotation.y = Math.PI;
    const wrapper = new THREE.Group();
    wrapper.add(inner);
    const isMale = opts.gender === "m";
    wrapper.scale.set(1.75 * (isMale ? 1.08 : 1), 1.75 * (isMale ? 1.03 : 1), 1.75 * (isMale ? 1.08 : 1));
    const bones = new Map<string, THREE.Bone>();
    const baseQuat = new Map<string, THREE.Quaternion>();
    const materials: THREE.MeshStandardMaterial[] = [];
    const baseColors: THREE.Color[] = [];
    inner.traverse((o) => {
      if (o instanceof THREE.Bone && o.name.startsWith("DEF-")) {
        bones.set(o.name, o);
        baseQuat.set(o.name, o.quaternion.clone());
      }
      if (o instanceof THREE.Mesh) {
        o.frustumCulled = false;
        if (o.material instanceof THREE.MeshStandardMaterial) {
          const cloned = o.material.clone();
          o.material = cloned;
          materials.push(cloned);
          baseColors.push(cloned.color.clone());
        }
      }
    });
    const auraColor = opts.armor ? Number.parseInt(opts.armor.aura.slice(1), 16) : 0x2f7de1;
    const ringMat = new THREE.MeshBasicMaterial({ color: auraColor, side: THREE.DoubleSide, transparent: true, opacity: 0.7 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.55, 24), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    wrapper.add(ring);
    const rig: GlbRig = {
      bones,
      baseQuat,
      current: new Map(),
      materials,
      baseColors,
      ringMat,
      handR: bones.get("DEF-hand.R") ?? null,
      handL: bones.get("DEF-hand.L") ?? null,
      forearmL: bones.get("DEF-forearm.L") ?? null,
      phase: 0,
      lastT: performance.now(),
    };
    if (opts.armor) this.applyArmorTint(rig, opts.armor);
    this.glbRigs.set(wrapper, rig);
    return { group: wrapper, rig };
  }

  /** Attach the class weapon to the hand bone(s) of a GLB rig. */
  private attachGlbWeapons(rig: GlbRig, classId: string): void {
    const mats = glbWeaponMats();
    if (classId === "espadachim") {
      if (rig.handR) rig.handR.add(makeHandSword(mats));
      if (rig.handL) rig.handL.add(makeHandSword(mats));
    } else if (classId === "guerreiro") {
      if (rig.handR) rig.handR.add(makeHandSword(mats));
      if (rig.forearmL) {
        const shield = makeHandShield(mats);
        shield.position.y = 0.12;
        rig.forearmL.add(shield);
      }
    } else if (classId === "atirador") {
      if (rig.handR) rig.handR.add(makeHandRifle(mats));
    } else {
      // curandeiro: staff + glowing orb (foco sagrado)
      if (rig.handR) rig.handR.add(makeHandStaff(mats));
    }
  }

  /** Use the GLB as the local player's mesh (fresh instance, own skeleton). */
  private applyGlbLocal(): void {
    if (!this.glbTemplate) return;
    const inst = this.makeGlbInstance({ gender: this.lastGenome?.gender });
    if (!inst) return;
    this.clearLocalCharacter();
    this.localCharacter = { group: inst.group, drawCalls: 1, triangles: this.glbTriangles, heightM: 1.75 };
    if (this.localId !== null) {
      const entry = this.players.get(this.localId);
      if (entry) {
        this.scene.remove(entry.group);
        this.players.delete(this.localId);
      }
    }
  }

  /**
   * Load the GLB template once (cached promise — remotes clone it, never
   * re-fetch). On success the local mesh and every remote placeholder are
   * rebuilt as GLB clones. Returns false on load failure; the caller keeps
   * the CharForge/capsule fallback.
   */
  async loadGlbCharacter(url: string): Promise<boolean> {
    if (this.glbTemplate) return true;
    if (!this.glbLoadPromise) {
      const p = (async (): Promise<boolean> => {
        try {
          const gltf = await new GLTFLoader().loadAsync(url);
          let triangles = 0;
          gltf.scene.traverse((o) => {
            if (o instanceof THREE.Mesh) {
              const geo = o.geometry as THREE.BufferGeometry;
              const posCount = geo.attributes.position?.count ?? 0;
              triangles += (geo.index ? geo.index.count : posCount) / 3;
            }
          });
          this.glbTemplate = gltf.scene;
          this.glbTriangles = Math.round(triangles);
          if (this.charMode !== "capsule") {
            this.applyGlbLocal();
            this.rebuildAllPlayers();
          }
          return true;
        } catch (err) {
          console.warn("GLB character failed to load, falling back to genome:", err);
          this.glbLoadPromise = null;
          return false;
        }
      })();
      this.glbLoadPromise = p;
    }
    return this.glbLoadPromise;
  }

  /**
   * GLB character (M2.5 test): loads a rigged glTF character and uses it as
   * the local player's mesh instead of the CharForge build. Kept for the
   * `?char=warrior` alias — new code should use loadGlbCharacter, which
   * also upgrades remote players. Returns false if the file fails to load.
   */
  async useGlbCharacter(url: string): Promise<boolean> {
    this.setCharMode("glb");
    return this.loadGlbCharacter(url);
  }

  /**
   * Procedural bone animation for one GLB rig: eases every animated DEF
   * bone from its current delta toward the target pose for the entity's
   * animState (~70 ms time constant), so state changes blend instead of
   * snapping. The walk phase only advances while walking.
   */
  private animateGlbRig(rig: GlbRig, animState: number, nowMs: number): void {
    const dt = Math.min(0.1, Math.max(0, (nowMs - rig.lastT) / 1000));
    rig.lastT = nowMs;
    if (animState === 1) rig.phase += dt * 7.5;
    const target = glbPoseTarget(animState, nowMs / 1000, rig.phase);
    const k = 1 - Math.exp(-dt / 0.07);
    for (const [name, bone] of rig.bones) {
      const tgt = target.get(name);
      if (!tgt) continue;
      const base = rig.baseQuat.get(name);
      if (!base) continue;
      const cur = rig.current.get(name) ?? { x: 0, y: 0, z: 0 };
      cur.x += (tgt.x - cur.x) * k;
      cur.y += (tgt.y - cur.y) * k;
      cur.z += (tgt.z - cur.z) * k;
      rig.current.set(name, cur);
      bone.quaternion.copy(base).multiply(_poseQuat.setFromEuler(_poseEuler.set(cur.x, cur.y, cur.z)));
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
      // Local player with a character renders it (CharForge build or GLB
      // instance); remote players clone the loaded GLB template when it is
      // available, and use the capsule placeholder until it arrives (or
      // when ?char=capsule forces the placeholder).
      const armor = isLocal ? this.currentArmor : e.armorId ? (armorById(e.armorId) ?? null) : null;
      let group: THREE.Group;
      let bodyMat: THREE.MeshStandardMaterial | undefined;
      let ringMat: THREE.MeshBasicMaterial | undefined;
      let rig: GlbRig | undefined;
      let glbWeaponClass: string | undefined;
      if (isLocal && this.localCharacter) {
        group = this.localCharacter.group;
        const localRig = this.glbRigs.get(group);
        if (localRig) {
          rig = localRig;
          ringMat = localRig.ringMat;
        }
      } else if (!isLocal && this.glbTemplate && this.charMode !== "capsule") {
        const inst = this.makeGlbInstance({ gender: e.gender, armor });
        if (inst) {
          group = inst.group;
          rig = inst.rig;
          ringMat = inst.rig.ringMat;
        } else {
          const phOpts: { gender?: string; classId?: string; armor?: ArmorData | null } = { armor };
          if (e.gender !== undefined) phOpts.gender = e.gender;
          if (e.classId !== undefined) phOpts.classId = e.classId;
          const built = makePlaceholder(color, phOpts);
          group = built.group;
          bodyMat = built.bodyMat;
          ringMat = built.ringMat;
        }
      } else {
        // exactOptionalPropertyTypes: only pass keys that are present.
        const phOpts: { gender?: string; classId?: string; armor?: ArmorData | null } = { armor };
        if (e.gender !== undefined) phOpts.gender = e.gender;
        if (e.classId !== undefined) phOpts.classId = e.classId;
        const built = makePlaceholder(color, phOpts);
        group = built.group;
        bodyMat = built.bodyMat;
        ringMat = built.ringMat;
      }
      // GLB rigs get the class weapon on the hand bone(s) + armor tint.
      if (rig && e.classId !== undefined) {
        this.attachGlbWeapons(rig, e.classId);
        glbWeaponClass = e.classId;
        if (armor) this.applyArmorTint(rig, armor);
      }
      if (isLocal) this.localId = e.id;
      this.scene.add(group);
      const [x, , z] = WORLD_TO_THREE(e.x, e.y);
      group.position.set(x, this.terrainHeight(x, z), z);
      const guardDisc = new THREE.Mesh(
        new THREE.CircleGeometry(0.9, 24),
        new THREE.MeshBasicMaterial({ color: 0x4aa8ff, side: THREE.DoubleSide, transparent: true, opacity: 0.35 }),
      );
      guardDisc.visible = false;
      group.add(guardDisc);
      const created: {
        group: THREE.Group;
        guardDisc: THREE.Mesh;
        bodyMat?: THREE.MeshStandardMaterial;
        ringMat?: THREE.MeshBasicMaterial;
        classId?: string;
        rig?: GlbRig;
        glbWeaponClass?: string;
      } = { group, guardDisc };
      if (bodyMat !== undefined) created.bodyMat = bodyMat;
      if (ringMat !== undefined) created.ringMat = ringMat;
      if (e.classId !== undefined) created.classId = e.classId;
      if (rig !== undefined) created.rig = rig;
      if (glbWeaponClass !== undefined) created.glbWeaponClass = glbWeaponClass;
      entry = created;
      this.players.set(e.id, entry);
    }
    if (!entry) return; // narrowing: entry is always set above
    const [tx, , tz] = WORLD_TO_THREE(e.x, e.y);
    const ty = this.terrainHeight(tx, tz);
    entry.group.position.set(tx, ty, tz);
    // Mesh forward is -Z; world yaw maps to rotation.y = -yaw.
    entry.group.rotation.y = -e.yaw;
    if (entry.rig) {
      // GLB rig: bones carry the pose (walk/attack/dodge/guard); the group
      // itself stays upright, and dodge crouches the whole body a little.
      this.animateGlbRig(entry.rig, e.animState, performance.now());
      entry.group.rotation.x = 0;
    } else {
      // Slight forward lean while moving (whole-body animation; M2 has no rig).
      entry.group.rotation.x = e.animState === 1 ? 0.05 : 0;
    }
    // Simple walk bob so movement reads on screen.
    const bob = e.animState === 1 ? Math.sin(performance.now() / 90) * 0.05 : 0;
    const crouch = entry.rig && e.animState === 3 ? 0.12 : 0;
    entry.group.position.y = ty + bob - crouch;
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
    const ty = this.terrainHeight(tx, tz);
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
    const ty = this.terrainHeight(tx, tz);
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
    this.projV.set(tx, this.terrainHeight(tx, tz) + heightM, tz).project(this.camera);
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
   * 2.5D mode: fixed oblique camera (38° elevation, fixed distance, due
   * south of the player — no orbit; yaw/pitch are ignored). 3D mode: the
   * M0 orbit camera (pitch = orbit elevation 0.05 … 1.25).
   */
  updateCamera(playerX: number, playerY: number, yaw: number, pitch: number, dt: number): void {
    const [px, , pz] = WORLD_TO_THREE(playerX, playerY);
    const py = this.terrainHeight(px, pz);
    if (this.cameraMode === "2.5d") {
      const pose = computeCamera25D(playerX, playerY, this.zoom25D);
      // World (x, y north) -> three (x, z = -y); camZ is height above ground.
      this.camPosTarget.set(pose.camX, py + pose.camZ, -pose.camY);
      this.camFocusTarget.set(pose.focusX, py + pose.focusZ, -pose.focusY);
    } else {
      const { distanceM } = this.activeZone.camera;
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      this.camPosTarget.set(
        px - Math.sin(yaw) * cp * distanceM,
        py + 1.4 + sp * distanceM,
        pz + Math.cos(yaw) * cp * distanceM,
      );
      this.camFocusTarget.set(px, py + 1.4, pz);
    }
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
