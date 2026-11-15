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
import {
  applyFresnelRim,
  asianRoofGeo,
  bandGeo,
  bladeGeo,
  cactusGeo,
  capitalGeo,
  chamferedBoxGeo,
  domeGeo,
  eggGeo,
  fountainBasinGeo,
  fountainColumnGeo,
  fractalHeight,
  gothicPillar,
  humanoidTorsoGeo,
  lanternBodyGeo,
  lanternPostGeo,
  latheProfile,
  limbGeo,
  npcRobeGeo,
  organicCanopyGeo,
  organicCloudGeo,
  organicMaterial,
  organicRockGeo,
  organicTrunkGeo,
  palmFrondGeo,
  palmTrunkGeo,
  pedimentGeo,
  portalRingGeo,
  rboxGeo,
  ridgeBeamGeo,
  rimShellOf,
  sarcophagusGeo,
  shieldGeo,
  spikeGeo,
  swordBladeGeo,
} from "./procedural.js";

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
    const blade = new THREE.Mesh(swordBladeGeo(), steel);
    blade.position.y = 0.45;
    const guard = new THREE.Mesh(chamferedBoxGeo(0.16, 0.03, 0.04, 0.008), gold);
    guard.position.y = 0.08;
    const handle = new THREE.Mesh(limbGeo(0.02, 0.02, 0.16, 8), grip);
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
      shieldGeo(),
      new THREE.MeshStandardMaterial({ color: 0x5a6a7a, roughness: 0.5, metalness: 0.6 }),
    );
    // Domo da face externa para -Z (para frente, como o boss).
    shield.rotation.x = -Math.PI / 2;
    shield.position.set(-0.5, 1.05, 0.05);
    const boss = new THREE.Mesh(domeGeo(0.08, 0.06), gold);
    boss.rotation.x = -Math.PI / 2;
    boss.position.set(-0.5, 1.05, 0.02);
    g.add(shield, boss);
  } else if (classId === "atirador") {
    const barrel = new THREE.Mesh(limbGeo(0.035, 0.035, 0.8, 10), steel);
    barrel.rotation.x = Math.PI / 2 - 0.15;
    barrel.position.set(0.15, 1.05, -0.25);
    const stock = new THREE.Mesh(chamferedBoxGeo(0.08, 0.14, 0.3, 0.02), grip);
    stock.position.set(0.15, 0.95, 0.15);
    g.add(barrel, stock);
  } else {
    // curandeiro: staff + glowing orb (foco sagrado)
    const staff = new THREE.Mesh(limbGeo(0.028, 0.022, 1.6, 8), grip);
    staff.position.set(0.5, 1.1, 0.05);
    staff.rotation.z = 0.1;
    const orb = new THREE.Mesh(eggGeo(0.09, 0.09, 0, 12, 10), holy);
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
    // Detalhe fractal (procedural.ts): 4 oitavas de value noise sobre a
    // forma larga das dunas — o chão deixa de ser uma onda lisa.
    h = fractalHeight(x, z, h, 20261114, 0.22, 0.12);
  } else if (zone.zone.id === "cidade_serket") {
    // City: nearly flat (plaza + streets stay walkable, buildings sit level);
    // only a gentle rise toward the wall.
    flat = Math.min(1, Math.max(0, (d - 20) / 18));
    h = 0.5 * Math.sin(x * 0.06) * Math.cos(z * 0.05) + 0.2 * Math.sin(x * 0.21 + z * 0.17);
    h = fractalHeight(x, z, h, 20261115, 0.06, 0.15);
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
  const body = new THREE.Mesh(humanoidTorsoGeo(), mat);
  body.position.y = 0.15;
  const head = new THREE.Mesh(
    eggGeo(0.28, 0.3, 0, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xf2d6c2, roughness: 0.5 }),
  );
  head.position.y = 1.85;
  const nose = new THREE.Mesh(
    spikeGeo(0.09, 0.3, 8),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4 }),
  );
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, 1.85, -0.17);
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

// ---------------------------------------------------------------------------
// Zero Primitivas (Regra Anti-Blocos, permanente): nenhum mob usa primitiva
// nua visível (Box/Cylinder/Cone/Sphere/Capsule/Torus). Corpos são
// LatheGeometry de perfis anatômicos subdivididos; membros, mandíbulas e
// chifres são extrusões chanfradas ou lathes afilados; o rim light vem de
// um termo Fresnel injetado no material (WebGL2) + um shell invertido
// (BackSide) que carrega o rim sob o WebGPURenderer. Os anéis planos no
// chão (mobRing/eliteRing) são indicadores de gameplay, não partes do
// modelo, e ficam. O kit orgânico dos mobs (eggGeo, limbGeo, bladeGeo,
// applyFresnelRim, rimShellOf, ...) vive em ./procedural.ts (fonte única);
// o helper local de torno agora é latheProfile, importado de lá.
// ---------------------------------------------------------------------------

/**
 * Detailed procedural scorpion (escorpião): segmented body, tail arched
 * over the back with a stinger, two pincers, 8 legs, glowing eyes.
 * Forward is -Z (like the old placeholder: head at -Z, tail at +Z).
 * Returns the group, the telegraph ring, and the tail group (animated).
 */
function makeScorpion(color: number, scale: number): { group: THREE.Group; ring: THREE.Mesh; tail: THREE.Group } {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a1a0e, roughness: 0.7 });
  const plate = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.5, metalness: 0.2 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff3020, roughness: 0.3, emissive: 0xcc1100, emissiveIntensity: 1.8 });
  applyFresnelRim(shell, 0xff5040, 0.5);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  // Segmented body: cephalothorax + two abdomen segments (lathe ellipsoids
  // with anatomical profiles, not flattened spheres).
  const ceph = add(eggGeo(0.5, 0.31), shell, 0, 0.42, -0.2);
  ceph.scale.set(1.05, 1, 1.15);
  rimShellOf(ceph, 0xff5040, 0.28);
  const abd1 = add(eggGeo(0.46, 0.28), plate, 0, 0.42, 0.35);
  abd1.scale.set(1, 1, 0.9);
  const abd2 = add(eggGeo(0.38, 0.23), shell, 0, 0.44, 0.78);
  abd2.scale.set(0.95, 1, 0.85);
  // Eyes: two glowing red domes on the front of the cephalothorax.
  for (const side of [-1, 1]) {
    const eye = add(domeGeo(0.06, 0.05, 8), eyeMat, side * 0.13, 0.62, -0.62);
    eye.rotation.x = -Math.PI / 2;
  }
  // Tail: 4 segments rising almost vertically off the rear + stinger spike.
  // Near-vertical on purpose (top ~1.9 m): the old forward-leaning arch
  // foreshortened into the body from the fixed south camera and the tail
  // vanished. A tall rear arch reads as a scorpion from any angle.
  const tail = new THREE.Group();
  const tailSegs: Array<[number, number, number, number]> = [
    [0, 0.62, 1.02, 0.19],
    [0, 1.0, 1.08, 0.17],
    [0, 1.38, 1.02, 0.15],
    [0, 1.66, 0.82, 0.13],
  ];
  for (const [x, y, z, r] of tailSegs) {
    const s = new THREE.Mesh(eggGeo(r, r * 0.9, 0, 10), shell);
    s.position.set(x, y, z);
    tail.add(s);
  }
  const stinger = new THREE.Mesh(spikeGeo(0.12, 0.55, 8), dark);
  stinger.position.set(0, 1.94, 0.33);
  stinger.rotation.x = Math.PI * 0.7; // tip points forward-down
  tail.add(stinger);
  g.add(tail);
  // Pincers: tapered arm + chamfered palm + curved claw blades, both sides.
  const clawPts: Array<[number, number]> = [
    [0, 0],
    [0.05, 0.08],
    [0.045, 0.22],
    [0.01, 0.32],
    [-0.03, 0.2],
    [-0.045, 0.06],
  ];
  for (const side of [-1, 1]) {
    const arm = add(limbGeo(0.11, 0.09, 0.55, 8), shell, side * 0.55, 0.42, -0.6);
    arm.rotation.set(Math.PI / 2 - 0.25, 0, side * 0.5);
    const palm = add(rboxGeo(0.16, 0.12, 0.34, 0.03), plate, side * 0.78, 0.42, -1.0);
    palm.rotation.y = side * 0.15;
    const clawFixed = add(bladeGeo(clawPts, 0.04), dark, side * 0.82, 0.44, -1.28);
    clawFixed.rotation.x = -Math.PI / 2;
    const clawMove = add(bladeGeo(clawPts, 0.04), dark, side * 0.72, 0.48, -1.26);
    clawMove.rotation.x = -Math.PI / 2;
    clawMove.rotation.z = side * 0.35;
  }
  // 8 legs: one tapered limb each, angled down-out (4 per side).
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i += 1) {
      const z = -0.45 + i * 0.42;
      const leg = add(limbGeo(0.03, 0.045, 0.75, 6), dark, side * 0.62, 0.28, z);
      leg.rotation.z = side * 1.05;
      leg.rotation.x = (i - 1.5) * 0.12;
    }
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
  return { group: g, ring, tail };
}

/**
 * Detailed procedural mummy (múmia): upright bandaged body, wrap strips
 * around torso/head, arms raised forward, glowing eyes, tattered strips
 * hanging from the waist. Forward is -Z.
 */
function makeMummy(color: number, scale: number): { group: THREE.Group; ring: THREE.Mesh } {
  const g = new THREE.Group();
  const wrap = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
  const wrapDark = new THREE.MeshStandardMaterial({ color: 0xb8a888, roughness: 0.95 });
  const wrapLight = new THREE.MeshStandardMaterial({ color: 0xe8dfc8, roughness: 0.9 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffd24a, roughness: 0.3, emissive: 0xffb400, emissiveIntensity: 2.2 });
  applyFresnelRim(wrap, 0xfff2cc, 0.4);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  // Bandaged body: lathe with a waist and rounded shoulders (not a capsule).
  const body = add(
    latheProfile([
      [0.001, 0],
      [0.28, 0.03],
      [0.36, 0.18],
      [0.37, 0.5],
      [0.35, 0.85],
      [0.37, 1.15],
      [0.33, 1.4],
      [0.22, 1.55],
      [0.001, 1.62],
    ]),
    wrap, 0, 0.13, 0,
  );
  rimShellOf(body, 0xfff2cc, 0.25);
  // Wrap strips around the torso: only 4, thin, so they read as bandages
  // on a body instead of a stack of rings (the first version looked like
  // a beehive). Alternating tones, slightly proud of the body.
  const stripYs = [0.62, 0.9, 1.18, 1.44];
  stripYs.forEach((y, i) => {
    add(bandGeo(0.375, 0.035, 16), i % 2 === 0 ? wrapDark : wrapLight, 0, y, 0);
  });
  // Two diagonal strips across the chest.
  const diag1 = add(rboxGeo(0.09, 0.85, 0.04, 0.02), wrapLight, 0.08, 1.2, -0.33);
  diag1.rotation.z = 0.6;
  const diag2 = add(rboxGeo(0.09, 0.85, 0.04, 0.02), wrapDark, -0.08, 1.2, -0.33);
  diag2.rotation.z = -0.6;
  // Head + wrap bands + glowing eyes (bigger, so they read at 8.5 m).
  add(eggGeo(0.3, 0.32), wrap, 0, 1.85, 0);
  const brow = add(bandGeo(0.29, 0.04, 16), wrapDark, 0, 1.97, 0);
  brow.rotation.x = -0.35;
  const chin = add(bandGeo(0.28, 0.04, 16), wrapLight, 0, 1.72, 0);
  chin.rotation.x = 0.2;
  for (const side of [-1, 1]) {
    const eye = add(domeGeo(0.08, 0.06, 8), eyeMat, side * 0.11, 1.88, -0.26);
    eye.rotation.x = -Math.PI / 2;
  }
  // Arms raised forward (classic shambling pose), bandaged, thicker so the
  // reach reads at distance.
  for (const side of [-1, 1]) {
    const arm = add(limbGeo(0.1, 0.11, 0.72, 8), wrap, side * 0.32, 1.28, -0.32);
    arm.rotation.x = -1.25;
    add(eggGeo(0.11, 0.12, 0, 8), wrapDark, side * 0.32, 1.42, -0.62);
    const cuff = add(bandGeo(0.12, 0.035, 10), wrapLight, side * 0.32, 1.18, -0.18);
    cuff.rotation.x = -1.25;
  }
  // Loose sash from the shoulder: breaks the torso's symmetry so the
  // silhouette isn't just stacked bands.
  const sash = add(rboxGeo(0.12, 0.95, 0.03, 0.015), wrapDark, 0.2, 1.05, -0.38);
  sash.rotation.z = 0.35;
  // Legs (bandaged, slightly apart) + tattered waist strips.
  add(limbGeo(0.1, 0.12, 0.55, 8), wrapDark, -0.16, 0.3, 0);
  add(limbGeo(0.1, 0.12, 0.55, 8), wrapDark, 0.16, 0.3, 0);
  const tatXs = [-0.25, 0, 0.25];
  tatXs.forEach((x, i) => {
    const strip = add(rboxGeo(0.09, 0.4 + i * 0.08, 0.02, 0.01), i % 2 === 0 ? wrapDark : wrapLight, x, 0.42, -0.36);
    strip.rotation.x = 0.1;
    strip.rotation.z = (i - 1) * 0.12;
  });
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
/** Shared telegraph ring for procedural mobs (shown during windup). */
function mobRing(): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.1, 32),
    new THREE.MeshBasicMaterial({ color: 0xff2a1a, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.visible = false;
  return ring;
}

/** Gold elite ring for bosses (always visible, under the telegraph ring). */
function eliteRing(radius: number): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius, radius + 0.18, 40),
    new THREE.MeshBasicMaterial({ color: 0xffc94a, side: THREE.DoubleSide, transparent: true, opacity: 0.6 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  return ring;
}

/**
 * Detailed procedural giant ant (formiga gigante): three body segments,
 * mandibles, antennae, 6 legs, amber eyes. Forward is -Z.
 */
function makeAnt(color: number, scale: number): { group: THREE.Group; ring: THREE.Mesh } {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a1408, roughness: 0.7 });
  const band = new THREE.MeshStandardMaterial({ color: 0xd8a05a, roughness: 0.5, metalness: 0.2 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffb400, roughness: 0.3, emissive: 0xcc8800, emissiveIntensity: 2.0 });
  applyFresnelRim(shell, 0xffb400, 0.45);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  // Abdomen: big lathe egg at the rear, with two pale bands so the segments read.
  const abd = add(eggGeo(0.55, 0.43), shell, 0, 0.5, 0.75);
  abd.scale.set(1, 1, 1.35);
  rimShellOf(abd, 0xffb400, 0.28);
  for (const [z, r] of [[0.45, 0.5], [0.95, 0.52]] as Array<[number, number]>) {
    const b = add(bandGeo(r, 0.055, 18), band, 0, 0.5, z);
    b.rotation.x = -Math.PI / 2;
  }
  // Thorax (middle) + head (front).
  const thorax = add(eggGeo(0.32, 0.26), shell, 0, 0.55, -0.1);
  thorax.scale.set(0.9, 1, 1.15);
  add(eggGeo(0.34, 0.31), dark, 0, 0.55, -0.6);
  // Mandibles: two curved chamfered blades pointing forward-inward (the ant's weapon).
  const mandPts: Array<[number, number]> = [
    [0, 0],
    [0.06, 0.1],
    [0.05, 0.28],
    [0.01, 0.4],
    [-0.04, 0.22],
    [-0.05, 0.05],
  ];
  for (const side of [-1, 1]) {
    const mand = add(bladeGeo(mandPts, 0.05), dark, side * 0.2, 0.5, -0.95);
    mand.rotation.x = -Math.PI / 2;
    mand.rotation.z = side * -0.45;
    const eye = add(domeGeo(0.075, 0.06, 8), eyeMat, side * 0.16, 0.68, -0.85);
    eye.rotation.x = -Math.PI / 2;
  }
  // Antennae: thin tapered stalks with tip knobs, sweeping forward.
  for (const side of [-1, 1]) {
    const ant = add(limbGeo(0.015, 0.02, 0.6, 6), dark, side * 0.18, 0.85, -0.85);
    ant.rotation.x = -0.9;
    ant.rotation.z = side * 0.35;
    add(eggGeo(0.05, 0.05, 0, 6), dark, side * 0.3, 1.05, -1.12);
  }
  // 6 legs: 3 per side, angled down-out (front pair from thorax, rear from abdomen).
  const legZ = [-0.35, 0.05, 0.5];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i += 1) {
      const leg = add(limbGeo(0.025, 0.04, 0.85, 6), dark, side * 0.55, 0.32, legZ[i] ?? 0);
      leg.rotation.z = side * 1.1;
      leg.rotation.x = (i - 1) * 0.15;
    }
  }
  const ring = mobRing();
  g.add(ring);
  g.scale.setScalar(scale);
  return { group: g, ring };
}

/**
 * Detailed procedural desert beetle (besouro): domed metallic carapace with
 * elytra split + bronze trim, forked rhinoceros horn, 6 thick legs.
 * Forward is -Z.
 */
function makeBeetle(color: number, scale: number): { group: THREE.Group; ring: THREE.Mesh } {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.6, metalness: 0.3 });
  const bronze = new THREE.MeshStandardMaterial({ color: 0xb08d3e, roughness: 0.35, metalness: 0.75 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff7a20, roughness: 0.3, emissive: 0xcc4400, emissiveIntensity: 2.0 });
  applyFresnelRim(shell, 0xd8b25a, 0.6);
  applyFresnelRim(bronze, 0xffe9a0, 0.7);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  // Domed carapace (lathe ellipsoid, not a flattened sphere) + bronze rim
  // at its base + elytra split down the middle.
  const cara = add(eggGeo(0.72, 0.45), shell, 0, 0.55, 0.15);
  cara.scale.set(1.1, 1, 1.3);
  rimShellOf(cara, 0xd8b25a, 0.3);
  const rim = add(bandGeo(0.78, 0.045, 24), bronze, 0, 0.42, 0.15);
  rim.scale.set(1.1, 1, 1.3);
  const split = add(rboxGeo(0.05, 0.06, 1.35, 0.02), dark, 0, 0.98, 0.15);
  split.rotation.x = 0.06;
  // Head + forked rhinoceros horn (the silhouette that says "beetle").
  // The horn leans UP, not forward: from the fixed 2.5D camera a forward
  // horn foreshortens into the carapace and vanishes.
  add(eggGeo(0.3, 0.3), dark, 0, 0.5, -0.78);
  const horn = add(spikeGeo(0.14, 1.1, 8), bronze, 0, 0.42, -0.81);
  horn.rotation.x = -0.25;
  const tinePts: Array<[number, number]> = [
    [0, 0],
    [0.04, 0.06],
    [0.035, 0.18],
    [0.01, 0.26],
    [-0.03, 0.14],
    [-0.035, 0.04],
  ];
  for (const side of [-1, 1]) {
    const tine = add(spikeGeo(0.06, 0.5, 6), bronze, side * 0.12, 1.05, -1.03);
    tine.rotation.x = -0.2;
    tine.rotation.z = side * -0.4;
    const eye = add(domeGeo(0.07, 0.06, 8), eyeMat, side * 0.18, 0.58, -0.98);
    eye.rotation.x = -Math.PI / 2;
    const mand = add(bladeGeo(tinePts, 0.04), dark, side * 0.14, 0.42, -1.08);
    mand.rotation.x = -Math.PI / 2;
  }
  // 6 thick legs with bronze knee joints.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i += 1) {
      const z = -0.45 + i * 0.55;
      const leg = add(limbGeo(0.05, 0.07, 0.8, 6), dark, side * 0.68, 0.3, z);
      leg.rotation.z = side * 1.0;
      leg.rotation.x = (i - 1) * 0.14;
      add(eggGeo(0.09, 0.09, 0, 8), bronze, side * 0.62, 0.48, z);
    }
  }
  const ring = mobRing();
  g.add(ring);
  g.scale.setScalar(scale);
  return { group: g, ring };
}

/**
 * Detailed procedural sand golem (golem de areia): rounded sandstone
 * boulder-body, glowing eyes under a heavy brow, boulder fists, back
 * spikes. Retrabalho (merge rodada 3): a versão anterior lia como robô
 * de blocos — torso, membros, cabeça e punhos eram caixas chanfradas.
 * Agora nenhuma caixa: torso em lathe afilado (ombros mais largos que a
 * cintura), pernas/braços em lathes afilados, ombreiras, joelhos e punhos
 * em ovos arredondados, cabeça em ovo com sobrancelha em anel. Mantidas
 * as rachaduras finas e os olhos laranja. Upright, ~2.3 m before the
 * gamedata scale (1.6x). Forward is -Z.
 */
function makeGolem(color: number, scale: number): { group: THREE.Group; ring: THREE.Mesh } {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 });
  const stoneDark = new THREE.MeshStandardMaterial({ color: 0x6b5d43, roughness: 1 });
  const crack = new THREE.MeshStandardMaterial({ color: 0x3a2f1d, roughness: 1 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff9a20, roughness: 0.3, emissive: 0xff7700, emissiveIntensity: 2.4 });
  applyFresnelRim(stone, 0xffb050, 0.5);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  // Legs: tapered lathe columns, slightly splayed, darker than the torso;
  // rounded knees + flattened-egg feet (no blocks anywhere).
  for (const side of [-1, 1]) {
    const leg = add(limbGeo(0.2, 0.15, 0.7, 10), stoneDark, side * 0.27, 0.35, 0);
    leg.rotation.z = side * -0.08;
    add(eggGeo(0.15, 0.15, 0, 10), stone, side * 0.27, 0.62, -0.06);
    const foot = add(eggGeo(0.2, 0.12, 0, 10), stoneDark, side * 0.29, 0.07, -0.05);
    foot.scale.set(1, 0.7, 1.4);
  }
  // Torso: lathe tapered the OTHER way from a block — waist 0.46, chest
  // 0.62, shoulders 0.64 — flattened front-back. No flat chest plate: the
  // cracks sit directly on the curved stone.
  const torso = add(
    latheProfile([
      [0.001, 0],
      [0.44, 0.02],
      [0.5, 0.12],
      [0.46, 0.35],
      [0.5, 0.6],
      [0.62, 0.85],
      [0.64, 0.95],
      [0.5, 1.08],
      [0.28, 1.12],
      [0.001, 1.15],
    ]),
    stone, 0, 0.7, 0,
  );
  torso.scale.set(1.08, 1, 0.8);
  rimShellOf(torso, 0xffb050, 0.25);
  // Thin crack slivers ON the curved chest (wide flat blades read as black
  // tape, not cracks) + belt.
  const crackPts: Array<[number, number]> = [
    [0, 0],
    [0.03, 0.06],
    [0.018, 0.28],
    [-0.008, 0.5],
    [-0.035, 0.46],
    [-0.015, 0.22],
  ];
  const crackBox = add(bladeGeo(crackPts, 0.02), crack, -0.15, 1.25, -0.48);
  crackBox.rotation.z = 0.45;
  const crackPts2: Array<[number, number]> = [
    [0, 0],
    [0.025, 0.05],
    [0.012, 0.2],
    [-0.008, 0.35],
    [-0.03, 0.32],
    [-0.012, 0.15],
  ];
  const crackBox2 = add(bladeGeo(crackPts2, 0.02), crack, 0.22, 1.2, -0.48);
  crackBox2.rotation.z = -0.6;
  const belt = add(
    latheProfile([
      [0.47, 0],
      [0.5, 0.06],
      [0.5, 0.1],
      [0.47, 0.16],
    ]),
    stoneDark, 0, 0.74, 0,
  );
  belt.scale.set(1.05, 1, 0.78);
  // Head: rounded egg, heavy brow as a stone ring (not a box), glowing eyes
  // (big, so they read at 8.5 m), small crest spike on top.
  add(eggGeo(0.24, 0.22, 0, 12), stone, 0, 2.05, 0).scale.set(1.15, 1, 1.05);
  const brow = add(bandGeo(0.25, 0.035, 16), stoneDark, 0, 2.16, -0.02);
  brow.rotation.x = 0.12;
  for (const side of [-1, 1]) {
    const eye = add(domeGeo(0.085, 0.07, 8), eyeMat, side * 0.11, 2.02, -0.26);
    eye.rotation.x = -Math.PI / 2;
  }
  const crest = add(spikeGeo(0.08, 0.25, 6), stoneDark, 0, 2.26, 0);
  crest.rotation.x = -0.15;
  // Shoulders: rounded boulder pauldrons + spikes; arms: tapered lathes
  // with rounded elbows and boulder fists.
  for (const side of [-1, 1]) {
    const pauldron = add(eggGeo(0.3, 0.26, 0, 12), stoneDark, side * 0.78, 1.78, 0);
    pauldron.scale.set(1.1, 0.9, 1.1);
    const spike = add(spikeGeo(0.11, 0.4, 6), stoneDark, side * 0.72, 1.95, 0);
    spike.rotation.z = side * -0.25;
    const upper = add(limbGeo(0.15, 0.13, 0.75, 10), stoneDark, side * 0.82, 1.35, 0);
    upper.rotation.z = side * -0.1;
    add(eggGeo(0.13, 0.13, 0, 10), stoneDark, side * 0.84, 1.0, 0);
    const fore = add(limbGeo(0.13, 0.15, 0.6, 10), stoneDark, side * 0.85, 0.78, -0.02);
    fore.rotation.z = side * -0.06;
    const fist = add(eggGeo(0.2, 0.22, 0, 10), stone, side * 0.86, 0.42, -0.02);
    fist.scale.set(1, 1.1, 1);
  }
  const backSpike = add(spikeGeo(0.12, 0.45, 6), stoneDark, 0, 1.75, 0.27);
  backSpike.rotation.x = 0.5;
  const ring = mobRing();
  g.add(ring);
  g.scale.setScalar(scale);
  return { group: g, ring };
}

/**
 * Detailed procedural cultist (cultista de Serket): floor-length purple robe
 * with gold hem, hood shadowing glowing eyes, staff with a floating orb.
 * Forward is -Z.
 */
function makeCultist(color: number, scale: number): { group: THREE.Group; ring: THREE.Mesh } {
  const g = new THREE.Group();
  const robe = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
  const robeDark = new THREE.MeshStandardMaterial({ color: 0x3a1245, roughness: 0.9 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.35, metalness: 0.7 });
  const crimson = new THREE.MeshStandardMaterial({ color: 0x8a1f2d, roughness: 0.8 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xc06aff, roughness: 0.3, emissive: 0x9933ff, emissiveIntensity: 2.4 });
  const orbMat = new THREE.MeshStandardMaterial({ color: 0xd9a0ff, roughness: 0.2, emissive: 0x9933ff, emissiveIntensity: 2.2 });
  applyFresnelRim(robe, 0xc06aff, 0.5);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  // Robe: flared lathe gown (waist + hem lip), gold hem ring + belt + crimson sash.
  const robeMesh = add(
    latheProfile([
      [0.001, 0],
      [0.5, 0.02],
      [0.56, 0.12],
      [0.5, 0.5],
      [0.42, 0.9],
      [0.36, 1.25],
      [0.33, 1.5],
      [0.3, 1.62],
      [0.001, 1.66],
    ]),
    robe, 0, 0.02, 0,
  );
  rimShellOf(robeMesh, 0xc06aff, 0.3);
  add(bandGeo(0.55, 0.05, 20), gold, 0, 0.08, 0);
  add(bandGeo(0.41, 0.04, 16), gold, 0, 1.02, 0);
  const sash = add(rboxGeo(0.11, 0.9, 0.04, 0.02), crimson, 0.1, 1.35, -0.38);
  sash.rotation.z = 0.55;
  // Hood: pointed lathe, face in shadow with glowing eyes.
  add(
    latheProfile([
      [0.001, 0],
      [0.26, 0.04],
      [0.32, 0.18],
      [0.3, 0.32],
      [0.2, 0.48],
      [0.08, 0.58],
      [0.001, 0.62],
    ]),
    robeDark, 0, 1.6, 0,
  );
  add(eggGeo(0.21, 0.22), new THREE.MeshStandardMaterial({ color: 0x0d0612, roughness: 1 }), 0, 1.82, -0.1);
  for (const side of [-1, 1]) {
    const eye = add(domeGeo(0.05, 0.04, 8), eyeMat, side * 0.08, 1.86, -0.28);
    eye.rotation.x = -Math.PI / 2;
  }
  // Sleeves reaching forward to the staff.
  for (const side of [-1, 1]) {
    const sleeve = add(limbGeo(0.08, 0.09, 0.6, 8), robe, side * 0.3, 1.35, -0.22);
    sleeve.rotation.x = -1.1;
  }
  // Staff: tall tapered lathe rod + floating purple orb on top.
  const staff = add(limbGeo(0.035, 0.03, 2.2, 8), robeDark, 0.48, 1.1, -0.15);
  staff.rotation.z = -0.06;
  add(eggGeo(0.14, 0.14, 0, 12), orbMat, 0.55, 2.28, -0.18);
  const ring = mobRing();
  g.add(ring);
  g.scale.setScalar(scale);
  return { group: g, ring };
}

/**
 * Neferet, boss das Tumbas: múmia nobre feminina — mesma base da múmia
 * comum, mas com coroa dourada de rubi, colar e peitoral de ouro, cetro com
 * ankh e anel de elite. Maior (gamedata scale 1.6). Forward is -Z.
 */
function makeNeferet(color: number, scale: number): { group: THREE.Group; ring: THREE.Mesh } {
  const g = new THREE.Group();
  const wrap = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.8 });
  const ruby = new THREE.MeshStandardMaterial({ color: 0xc01030, roughness: 0.25, emissive: 0x880018, emissiveIntensity: 1.2 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffd24a, roughness: 0.3, emissive: 0xffb400, emissiveIntensity: 2.4 });
  applyFresnelRim(wrap, 0xffd24a, 0.4);
  applyFresnelRim(gold, 0xffe9a0, 0.7);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  // Noble robe (not the common mummy's stacked wrap rings — those read as
  // a beehive at boss scale): lathe gown + thin gold bands + chest plate.
  const robeMesh = add(
    latheProfile([
      [0.001, 0],
      [0.44, 0.02],
      [0.52, 0.1],
      [0.48, 0.4],
      [0.42, 0.8],
      [0.37, 1.15],
      [0.34, 1.4],
      [0.001, 1.5],
    ]),
    wrap, 0, 0, 0,
  );
  rimShellOf(robeMesh, 0xffd24a, 0.3);
  add(bandGeo(0.5, 0.045, 18), gold, 0, 0.06, 0);
  for (const y of [0.95, 1.3]) {
    add(bandGeo(0.4, 0.03, 16), gold, 0, y, 0);
  }
  add(rboxGeo(0.42, 0.5, 0.06, 0.03), gold, 0, 1.2, -0.36);
  add(bandGeo(0.32, 0.06, 16), gold, 0, 1.56, 0);
  // Head + tall gold crown (flared lathe band + 5 splayed spikes + ruby) + glowing eyes.
  add(eggGeo(0.3, 0.32), wrap, 0, 1.85, 0);
  add(
    latheProfile([
      [0.27, 0],
      [0.29, 0.06],
      [0.29, 0.12],
      [0.27, 0.18],
    ]),
    gold, 0, 1.99, 0,
  );
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2;
    const point = add(spikeGeo(0.055, 0.3, 6), gold, Math.sin(a) * 0.25, 2.12, Math.cos(a) * 0.25);
    point.rotation.z = -Math.sin(a) * 0.4;
    point.rotation.x = Math.cos(a) * 0.4;
  }
  add(eggGeo(0.08, 0.08, 0, 8), ruby, 0, 2.08, -0.28);
  for (const side of [-1, 1]) {
    const eye = add(domeGeo(0.09, 0.07, 8), eyeMat, side * 0.11, 1.88, -0.26);
    eye.rotation.x = -Math.PI / 2;
  }
  // Arms raised forward, gold (wrap-colored arms vanish against the robe).
  for (const side of [-1, 1]) {
    const arm = add(limbGeo(0.1, 0.11, 0.72, 8), gold, side * 0.32, 1.28, -0.32);
    arm.rotation.x = -1.25;
    add(eggGeo(0.11, 0.12, 0, 8), gold, side * 0.32, 1.42, -0.62);
    const cuff = add(bandGeo(0.12, 0.035, 10), gold, side * 0.32, 1.18, -0.18);
    cuff.rotation.x = -1.25;
  }
  // Scepter with ankh (right hand): gold lathe rod + ring + cross on top.
  const rod = add(limbGeo(0.03, 0.03, 1.9, 8), gold, 0.52, 1.0, -0.3);
  rod.rotation.z = -0.05;
  const ankhRing = add(bandGeo(0.1, 0.03, 14), gold, 0.57, 2.02, -0.3);
  ankhRing.rotation.x = -Math.PI / 2;
  add(rboxGeo(0.05, 0.22, 0.05, 0.015), gold, 0.57, 1.82, -0.3);
  add(rboxGeo(0.2, 0.05, 0.05, 0.015), gold, 0.57, 1.86, -0.3);
  const ring = mobRing();
  g.add(ring);
  g.add(eliteRing(1.35));
  g.scale.setScalar(scale);
  return { group: g, ring };
}

/**
 * Serket, boss do Templo — MULHER híbrida de escorpião, como a arte de
 * loading (loading_serket.jpg): torso humano feminino de vestido carmesim
 * e cabelo preto longo sobre um corpo de escorpião (8 pernas, pinças,
 * cauda alta com ferrão), olhos vermelhos brilhantes. Nunca múmia.
 * Retrabalho (merge rodada 3): a versão anterior lia como sino vermelho —
 * o vestido flare cobria o corpo de escorpião, a cabeça era minúscula e
 * as pinças eram caixas douradas. Agora: vestido JUSTO (a parte mais
 * larga é o busto, não a barra), torso humano alto com pele clara em
 * contraste com o corselete carmesim, cabeça e cabelo grandes, pinças
 * em forma de garra (lâminas, nunca caixa) e cauda lateral, visível de
 * frente ao lado do corpo — como na referência. Forward is -Z. Returns
 * the tail group for the sway animation.
 */
function makeSerket(color: number, scale: number): { group: THREE.Group; ring: THREE.Mesh; tail: THREE.Group } {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15 });
  const shellDark = new THREE.MeshStandardMaterial({ color: 0x4a0f16, roughness: 0.6 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xf0c49a, roughness: 0.5 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x140a08, roughness: 0.85 });
  const dress = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff2020, roughness: 0.3, emissive: 0xdd0000, emissiveIntensity: 2.4 });
  applyFresnelRim(dress, 0xff5040, 0.55);
  applyFresnelRim(skin, 0xffd0a0, 0.4);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  // Scorpion lower body: cephalothorax + abdomen segments (rear, +Z) as lathe eggs.
  // DARK shell (not the dress crimson) and FLAT + WIDE (low horizontal
  // body, never a ball): a round mass under the gown reads as a skirt, a
  // low wide mass with splayed legs reads as a scorpion body. The human
  // torso emerges from the FRONT of the cephalothorax — from the front the
  // scorpion body stays visible at the sides.
  const ceph = add(eggGeo(0.55, 0.39), shellDark, 0, 0.45, 0.3);
  ceph.scale.set(1.35, 0.72, 1.15);
  const abd1 = add(eggGeo(0.5, 0.34), shell, 0, 0.45, 0.95);
  abd1.scale.set(1.15, 0.75, 1.0);
  const abd2 = add(eggGeo(0.4, 0.26), shellDark, 0, 0.48, 1.35);
  abd2.scale.set(1, 0.75, 0.9);
  // 8 scorpion legs: THICK, crimson (they stand out against the dark body
  // and the sand), roots outside the cephalothorax so the tips splay well
  // beyond its silhouette. No gold ring around the body — it read as a skirt hem.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i += 1) {
      const z = -0.35 + i * 0.4;
      const leg = add(limbGeo(0.1, 0.12, 1.3, 6), shell, side * 0.85, 0.32, z);
      leg.rotation.z = side * 1.25;
      leg.rotation.x = (i - 1.5) * 0.12;
    }
  }
  // Pincers: gold claw palms (elongated eggs, never boxes) + two big curved
  // blade fingers each, open like a claw — the scorpion tell from the front.
  // The blades dominate the palm (a small blade on a big gold ball reads as
  // a leaf); they point forward, splayed outward, clear of the body.
  const clawFingerPts: Array<[number, number]> = [
    [0, 0],
    [0.12, 0.07],
    [0.16, 0.27],
    [0.12, 0.51],
    [0.04, 0.7],
    [-0.03, 0.48],
    [-0.07, 0.24],
    [-0.05, 0.08],
  ];
  const clawThumbPts: Array<[number, number]> = [
    [0, 0],
    [0.1, 0.06],
    [0.13, 0.2],
    [0.08, 0.39],
    [0.01, 0.5],
    [-0.03, 0.28],
    [-0.06, 0.11],
  ];
  for (const side of [-1, 1]) {
    const arm = add(limbGeo(0.12, 0.1, 0.6, 8), shell, side * 0.62, 0.8, -0.45);
    arm.rotation.set(Math.PI / 2 - 0.25, 0, side * 0.5);
    const palm = add(eggGeo(0.17, 0.14), gold, side * 1.05, 0.82, -1.0);
    palm.scale.set(1, 0.8, 1.4);
    const finger = add(bladeGeo(clawFingerPts, 0.06), gold, side * 1.13, 0.84, -1.34);
    finger.rotation.x = -Math.PI / 2;
    finger.rotation.y = side * -0.3;
    const thumb = add(bladeGeo(clawThumbPts, 0.06), gold, side * 0.93, 0.84, -1.32);
    thumb.rotation.x = -Math.PI / 2;
    thumb.rotation.y = side * 0.45;
  }
  // Tail: arcs up BESIDE the body (her left, +X) so it reads from the front
  // instead of hiding behind the torso; stinger points forward above the
  // shoulder. Segments OVERLAP (taller eggs, closer spacing) — separate
  // balls read as floating balloons. Dark shell, like the body. Animated
  // sway like the scorpion's.
  const tail = new THREE.Group();
  const tailSegs: Array<[number, number, number, number]> = [
    [0.82, 0.85, 1.25, 0.26],
    [0.9, 1.3, 1.05, 0.24],
    [0.88, 1.75, 0.8, 0.22],
    [0.78, 2.2, 0.5, 0.2],
  ];
  for (const [x, y, z, r] of tailSegs) {
    const s = new THREE.Mesh(eggGeo(r, r * 1.15, 0, 10), shellDark);
    s.position.set(x, y, z);
    tail.add(s);
  }
  const stinger = new THREE.Mesh(spikeGeo(0.16, 0.75, 8), shellDark);
  stinger.position.set(0.7, 2.55, 0.1);
  stinger.rotation.x = Math.PI * 0.62;
  stinger.rotation.z = -0.25;
  tail.add(stinger);
  g.add(tail);
  // Human torso: SLIM crimson gown — hips 0.30, waist 0.24, bust 0.32: the
  // widest point is the bust, like a woman, never the hem (no bell). The
  // gown merges into the cephalothorax; pale skin chest + arms contrast
  // against the crimson so the human half reads at 8.5 m.
  const bodice = add(
    latheProfile([
      [0.001, 0],
      [0.28, 0.02],
      [0.3, 0.15],
      [0.26, 0.45],
      [0.28, 0.7],
      [0.32, 0.9],
      [0.3, 1.05],
      [0.001, 1.08],
    ]),
    dress, 0, 0.75, -0.05,
  );
  rimShellOf(bodice, 0xff5040, 0.3);
  // Single thin gold waistband + under-bust line + center gem (no stacked rings).
  add(bandGeo(0.27, 0.03, 18), gold, 0, 1.28, -0.05);
  add(bandGeo(0.31, 0.025, 18), gold, 0, 1.62, -0.05);
  add(eggGeo(0.07, 0.07, 0, 8), gold, 0, 1.78, -0.36);
  // Pale skin chest above the neckline + neck.
  const chest = add(eggGeo(0.3, 0.24), skin, 0, 1.95, -0.1);
  chest.scale.set(1.15, 1, 0.85);
  add(limbGeo(0.09, 0.11, 0.28, 8), skin, 0, 2.08, -0.05);
  // Arms: skin, thicker than before, hanging forward at the sides; gold
  // pauldrons (flattened eggs, not balls) + gold wrist bracers; skin hands.
  for (const side of [-1, 1]) {
    const pauldron = add(eggGeo(0.16, 0.12), gold, side * 0.38, 1.92, -0.05);
    pauldron.scale.set(1.2, 0.8, 1.2);
    const upper = add(limbGeo(0.07, 0.08, 0.5, 8), skin, side * 0.46, 1.66, -0.1);
    upper.rotation.z = side * 0.22;
    const fore = add(limbGeo(0.055, 0.065, 0.45, 8), skin, side * 0.52, 1.26, -0.18);
    fore.rotation.z = side * 0.12;
    fore.rotation.x = -0.25;
    add(bandGeo(0.075, 0.02, 10), gold, side * 0.54, 1.06, -0.22);
    add(eggGeo(0.06, 0.08, 0, 8), skin, side * 0.55, 0.98, -0.26);
  }
  // Head: BIGGER face (0.32 vs 0.26 before) with long black hair — a back
  // mass flowing to mid-torso, a cap, and two front locks framing the face
  // so the hair reads from the front too. Gold circlet, large red eyes.
  add(eggGeo(0.32, 0.34), skin, 0, 2.28, -0.05);
  const hairBack = add(
    latheProfile([
      [0.001, 0],
      [0.3, 0.05],
      [0.36, 0.35],
      [0.33, 0.7],
      [0.22, 1.1],
      [0.08, 1.35],
      [0.001, 1.4],
    ]),
    hair, 0, 1.35, 0.16,
  );
  hairBack.rotation.x = 0.3;
  add(eggGeo(0.33, 0.28), hair, 0, 2.38, 0.06);
  for (const side of [-1, 1]) {
    const lock = add(limbGeo(0.07, 0.09, 0.55, 8), hair, side * 0.26, 2.05, -0.18);
    lock.rotation.x = 0.18;
    lock.rotation.z = side * -0.12;
  }
  const circlet = add(bandGeo(0.32, 0.035, 18), gold, 0, 2.42, -0.05);
  circlet.rotation.x = -0.25;
  for (const side of [-1, 1]) {
    const eye = add(domeGeo(0.065, 0.05, 8), eyeMat, side * 0.12, 2.3, -0.34);
    eye.rotation.x = -Math.PI / 2;
  }
  // Stinger tip glint: small red gem at the tail base.
  add(eggGeo(0.07, 0.07, 0, 8), eyeMat, 0, 0.95, 1.28);
  const ring = mobRing();
  g.add(ring);
  g.add(eliteRing(1.6));
  g.scale.setScalar(scale);
  return { group: g, ring, tail };
}

/** Build the right procedural model for a mobId (color/scale from gamedata). */
function buildMobModel(
  mobId: string,
  color: number,
  scale: number,
): { group: THREE.Group; ring: THREE.Mesh; tail?: THREE.Group } {
  switch (mobId) {
    case "escorpiao":
    case "escorpiao_alfa":
      return makeScorpion(color, scale);
    case "mumia":
    case "mumia_ancia":
      return makeMummy(color, scale);
    case "formiga":
      return makeAnt(color, scale);
    case "besouro":
      return makeBeetle(color, scale);
    case "golem_areia":
      return makeGolem(color, scale);
    case "cultista_serket":
      return makeCultist(color, scale);
    case "neferet":
      return makeNeferet(color, scale);
    case "serket":
      return makeSerket(color, scale);
    default:
      return makeMob(color, scale, false);
  }
}

/**
 * Generic procedural mob placeholder (fallback for unknown mobIds):
 * color/scale come from gamedata. Horizontal insectoids get a stinger/tail;
 * upright mobs stand like a player capsule. No external assets.
 * Returns the group plus the telegraph ring (shown during windup, animState 9).
 */
function makeMob(color: number, scale: number, upright: boolean): { group: THREE.Group; ring: THREE.Mesh } {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05 });
  if (upright) {
    const body = new THREE.Mesh(
      latheProfile([
        [0.001, 0],
        [0.3, 0.05],
        [0.35, 0.5],
        [0.33, 0.9],
        [0.24, 1.25],
        [0.001, 1.35],
      ]),
      mat,
    );
    body.position.y = 0.28;
    const head = new THREE.Mesh(eggGeo(0.28, 0.3), mat);
    head.position.y = 1.85;
    g.add(body, head);
  } else {
    const body = new THREE.Mesh(eggGeo(0.32, 0.5), mat);
    body.rotation.x = Math.PI / 2;
    body.position.y = 0.45;
    const head = new THREE.Mesh(eggGeo(0.26, 0.28), mat);
    head.position.set(0, 0.5, -0.65);
    const tail = new THREE.Mesh(spikeGeo(0.12, 0.7, 8), mat);
    tail.rotation.x = Math.PI / 2 + 0.5;
    tail.position.set(0, 0.92, 0.44);
    g.add(body, head, tail);
  }
  // Telegraph ring (flat gameplay indicator, not a model part — same as mobRing()).
  const ring = mobRing();
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
// GLB character rig (warrior_f_r64_final.glb, Rigify DEF chain, no clips;
// warrior_m_klein_r64_final_rigged.glb shares the same DEF bone names/axes on a
// 34-bone chain transferred from the female, so the pose code below drives
// both genders unchanged).
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

/**
 * Canonical DEF bone names (dotted, as written in the GLB files and used
 * by the pose code below). three's GLTFLoader sanitizes node names
 * (PropertyBinding: "." is reserved, so "DEF-hand.R" loads as "DEF-handR"
 * and "DEF-thigh.L.001" as "DEF-thighL001") — without this mapping the
 * pose targets and the hand lookups never match a loaded bone, so the
 * rig stays in rest pose and no class weapon attaches. The bones map in
 * makeGlbInstance is keyed by the canonical name (see glbCanonicalBoneName).
 */
const GLB_KNOWN_BONES = [
  ...GLB_LIMB_BONES,
  ...GLB_LIMB_BONES.map((n) => `${n}.001`),
  ...GLB_SPINE_BONES,
  "DEF-spine.004",
  "DEF-spine.005",
  "DEF-spine.006",
  "DEF-hand.L",
  "DEF-hand.R",
  "DEF-forearm.L",
  "DEF-forearm.R",
  "DEF-foot.L",
  "DEF-foot.R",
  "DEF-toe.L",
  "DEF-toe.R",
  "DEF-pelvis.L",
  "DEF-pelvis.R",
  "DEF-shoulder.L",
  "DEF-shoulder.R",
  "DEF-breast.L",
  "DEF-breast.R",
] as const;
const GLB_BONE_BY_SANITIZED = new Map<string, string>(
  GLB_KNOWN_BONES.map((n) => [n.replace(/\./g, ""), n]),
);
/** Map a loaded (sanitized) bone name back to its canonical dotted name. */
function glbCanonicalBoneName(loaded: string): string {
  return GLB_BONE_BY_SANITIZED.get(loaded) ?? loaded;
}

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
  /** Static (unrigged) mesh root for whole-body procedural animation. */
  staticRoot: THREE.Group | null;
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
  const blade = new THREE.Mesh(swordBladeGeo(), mats.steel);
  blade.position.y = 0.48;
  const guard = new THREE.Mesh(chamferedBoxGeo(0.16, 0.03, 0.04, 0.008), mats.gold);
  guard.position.y = 0.09;
  const handle = new THREE.Mesh(limbGeo(0.02, 0.02, 0.16, 8), mats.grip);
  g.add(blade, guard, handle);
  g.rotation.x = Math.PI;
  return g;
}

function makeHandStaff(mats: ReturnType<typeof glbWeaponMats>): THREE.Group {
  const g = new THREE.Group();
  const staff = new THREE.Mesh(limbGeo(0.028, 0.022, 1.6, 8), mats.grip);
  staff.position.y = 0.7;
  const orb = new THREE.Mesh(eggGeo(0.09, 0.09, 0, 12, 10), mats.holy);
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
  const barrel = new THREE.Mesh(limbGeo(0.035, 0.035, 0.8, 10), mats.steel);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -0.3;
  const stock = new THREE.Mesh(chamferedBoxGeo(0.08, 0.14, 0.3, 0.02), mats.grip);
  stock.position.set(0, -0.03, 0.12);
  g.add(barrel, stock);
  g.rotation.y = -0.67;
  return g;
}

function makeHandShield(mats: ReturnType<typeof glbWeaponMats>): THREE.Group {
  const g = new THREE.Group();
  const shield = new THREE.Mesh(shieldGeo(), mats.steel);
  // Domo da face externa para -Z (para frente, como o boss).
  shield.rotation.x = -Math.PI / 2;
  const boss = new THREE.Mesh(domeGeo(0.08, 0.06), mats.gold);
  boss.rotation.x = -Math.PI / 2;
  boss.position.z = -0.03;
  g.add(shield, boss);
  return g;
}

// ---------------------------------------------------------------------------
// Procedural ground textures (canvas, seeded — no external assets).
// One 512² tile per biome; vertex colors still tint the terrain, so the
// canvas stays bright (values ~0.7–1.0) and the map multiplies, not buries.
// The same canvas doubles as a bump map for a little surface relief.
// ---------------------------------------------------------------------------

type GroundKind = "city" | "desert" | "dungeon";

/** Brightness jitter helper: draw `n` speckles of a color at random spots. */
function speckle(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  size: number,
  n: number,
  color: string,
  alphaMin: number,
  alphaMax: number,
  rMin: number,
  rMax: number,
): void {
  for (let i = 0; i < n; i += 1) {
    ctx.globalAlpha = alphaMin + rng() * (alphaMax - alphaMin);
    ctx.fillStyle = color;
    const r = rMin + rng() * (rMax - rMin);
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function makeGroundTexture(kind: GroundKind): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable for ground texture");
  const rng = sfc32(kind === "city" ? 20261121 : kind === "desert" ? 20261122 : 20261123);
  if (kind === "city") {
    // Stone pavers: 8x8 grid, each paver a slightly different warm tone,
    // dark grout between them, worn blotches + speckle.
    ctx.fillStyle = "#8a7a5f";
    ctx.fillRect(0, 0, size, size);
    const cell = size / 8;
    for (let gy = 0; gy < 8; gy += 1) {
      for (let gx = 0; gx < 8; gx += 1) {
        const v = 0.78 + rng() * 0.18;
        const warm = rng() * 14 - 4;
        ctx.fillStyle = `rgb(${Math.round(216 * v + warm)},${Math.round(203 * v)},${Math.round(176 * v)})`;
        ctx.fillRect(gx * cell + 2, gy * cell + 2, cell - 4, cell - 4);
        // One darker corner chip per paver, so no two pavers read alike.
        ctx.globalAlpha = 0.12 + rng() * 0.12;
        ctx.fillStyle = "#6b5a40";
        ctx.fillRect(gx * cell + 2 + rng() * cell * 0.5, gy * cell + 2 + rng() * cell * 0.5, cell * 0.3, cell * 0.25);
        ctx.globalAlpha = 1;
      }
    }
    speckle(ctx, rng, size, 1400, "#5a4a30", 0.05, 0.16, 0.5, 2);
    speckle(ctx, rng, size, 700, "#fff8e0", 0.05, 0.14, 0.5, 1.6);
  } else if (kind === "desert") {
    // Sand: warm base, big soft tonal blotches, faint wind-ripple bands,
    // heavy speckle so the dunes stop reading as a flat color.
    ctx.fillStyle = "#e3c184";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 26; i += 1) {
      const x = rng() * size;
      const y = rng() * size;
      const r = 40 + rng() * 110;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      const light = rng() > 0.5;
      grad.addColorStop(0, light ? "rgba(240,212,154,0.35)" : "rgba(190,150,90,0.30)");
      grad.addColorStop(1, "rgba(227,193,132,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Ripple bands: wavy horizontal darker strokes.
    ctx.strokeStyle = "rgba(180,140,80,0.22)";
    ctx.lineWidth = 3;
    for (let y = 8; y < size; y += 22) {
      ctx.beginPath();
      for (let x = 0; x <= size; x += 16) {
        const yy = y + Math.sin(x * 0.02 + y) * 5;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    speckle(ctx, rng, size, 2200, "#a8824a", 0.06, 0.2, 0.5, 2.2);
    speckle(ctx, rng, size, 1200, "#f8e8b8", 0.06, 0.18, 0.5, 1.8);
  } else {
    // Dungeon: dark stone tiles, 4x4, varied gray-brown, dark grout, cracks.
    ctx.fillStyle = "#241d16";
    ctx.fillRect(0, 0, size, size);
    const cell = size / 4;
    for (let gy = 0; gy < 4; gy += 1) {
      for (let gx = 0; gx < 4; gx += 1) {
        const v = 0.62 + rng() * 0.22;
        ctx.fillStyle = `rgb(${Math.round(122 * v)},${Math.round(106 * v)},${Math.round(88 * v)})`;
        ctx.fillRect(gx * cell + 3, gy * cell + 3, cell - 6, cell - 6);
      }
    }
    // Cracks: a few dark jagged polylines across random tiles.
    ctx.strokeStyle = "rgba(20,14,10,0.55)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 7; i += 1) {
      let x = rng() * size;
      let y = rng() * size;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 6; s += 1) {
        x += (rng() - 0.5) * 60;
        y += (rng() - 0.5) * 60;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    speckle(ctx, rng, size, 900, "#0f0b08", 0.08, 0.2, 0.5, 2);
    speckle(ctx, rng, size, 500, "#cbbfa0", 0.05, 0.12, 0.5, 1.6);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
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
  private readonly mobs = new Map<number, { group: THREE.Group; ring: THREE.Mesh; tail?: THREE.Group }>();
  /** Debug-only visual mobs (?testmobs= in main.ts): not server entities,
   *  never in the mobs map, so snapshots can't remove them. */
  private readonly testMobs: Array<{ group: THREE.Group; tail?: THREE.Group }> = [];
  /** M2: the local player's CharForge character (LOD0). Null = capsule fallback. */
  private localCharacter: CharacterBuild | null = null;
  /** Last genome handed to setLocalGenome (gender for the GLB scale). */
  private lastGenome: CharacterGenome | null = null;
  /** GLB default character: single loaded template, cloned per player. */
  private glbTemplate: THREE.Group | null = null;
  private glbTriangles = 0;
  private glbLoadPromise: Promise<boolean> | null = null;
  /** Real male mesh (warrior_m_klein_r64_final_rigged.glb, 34-bone DEF rig
   *  transferred from the female — same bone names/axes, same pose code). */
  private glbTemplateM: THREE.Group | null = null;
  private glbTrianglesM = 0;
  private glbLoadPromiseM: Promise<boolean> | null = null;
  // --- Scenery GLBs (rodada 3) + Zero Primitivas placeholders --------------
  /** Loaded scenery GLB templates by key (temple/house/stall/palm). */
  private readonly sceneryTemplates = new Map<string, THREE.Group>();
  /** Procedural placeholders, tagged userData.sceneryKey — removed when the
   *  matching GLB template loads (the scene is never empty meanwhile). */
  private readonly sceneryPlaceholders: THREE.Object3D[] = [];
  /** Placements recorded while building, reused by the GLB swap. */
  private readonly housePlacements: Array<{ x: number; z: number; ry: number; s: number }> = [];
  private readonly palmPlacements: Array<{ x: number; y: number; z: number; ry: number; s: number }> = [];
  private readonly stallPlacements: Array<{ x: number; z: number; ry: number }> = [];
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
  /** Warm fill light that follows the local player (camera side) so the
   *  hero reads bright like in Vindictus without blowing out the scene. */
  private playerFill: THREE.PointLight | null = null;
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

  /** Wheel zoom for the 2.5D camera (clamped 6–20 m). */
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
    // Slightly brighter exposure: the GLB albedo reads dark at the default.
    const r = this.renderer as unknown as { toneMappingExposure?: number };
    if (typeof r.toneMappingExposure === "number") r.toneMappingExposure = 1.15;
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
      const hemi = new THREE.HemisphereLight(0x8a7aa0, 0x1a1410, 0.75);
      const sun = new THREE.DirectionalLight(0xffd9a0, 0.5);
      sun.position.set(30, 50, -20);
      this.scene.add(hemi, sun);
      // Same player fill as outdoors (dimmer, cooler) so the hero and the
      // mummies still read in the dark hall.
      this.playerFill = new THREE.PointLight(0xffe8c8, 16, 8, 1.6);
      this.scene.add(this.playerFill);
      return;
    }
    const warmSun = this.activeZone.zone.id === "cidade_serket" ? 0xffe6b0 : this.activeZone.palette.sun;
    const hemi = new THREE.HemisphereLight(0xffe9c4, new THREE.Color(this.activeZone.palette.ground).getHex(), 1.3);
    const sun = new THREE.DirectionalLight(new THREE.Color(warmSun).getHex(), 2.2);
    sun.position.set(30, 50, -20);
    // Rim light: cool, from the north (behind the hero as seen from the
    // south-side 2.5D camera) so the silhouette edges glow against the ground.
    const rim = new THREE.DirectionalLight(0xbfd4ff, 1.1);
    rim.position.set(-10, 22, -45);
    this.scene.add(hemi, sun, rim);
    // Player fill: warm point light on the camera (south) side, follows the
    // local player (positioned every frame in updateCamera).
    this.playerFill = new THREE.PointLight(0xfff2dd, 14, 9, 1.6);
    this.scene.add(this.playerFill);
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
        // Kept bright (the stone texture multiplies it) — the old dark
        // values buried the texture entirely.
        const checker = (Math.floor(x / 4) + Math.floor(z / 4)) % 2 === 0 ? 0 : 1;
        c.setHex(checker === 0 ? 0x9a8f80 : 0x847a6c);
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
    // Procedural ground texture (pavers / sand / stone tiles) with repeat so
    // the floor stops reading as a flat color; same canvas as a bump map.
    const kind: GroundKind = this.dungeonId ? "dungeon" : this.activeZone.zone.id === "cidade_serket" ? "city" : "desert";
    const groundTex = makeGroundTexture(kind);
    const repeat = size / 12;
    groundTex.repeat.set(repeat, repeat);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      map: groundTex,
      bumpMap: groundTex,
      bumpScale: 0.05,
    });
    this.scene.add(new THREE.Mesh(geo, mat));
  }

  // -------------------------------------------------------------------------
  // Scenario builders (city / dunes / dungeon).
  // One shared material set per zone build (reused by every mesh); repetition
  // goes through InstancedMesh. Scatter uses sfc32 with a fixed seed — no
  // Math.random in gameplay or scenery. NPC markers and portal gates stay
  // in buildProps (fixed positions from gamedata, never moved).
  // -------------------------------------------------------------------------

  /** Shared materials for one zone build (city palette: jade/crimson/gold).
   * Zero Primitivas: structural materials use organicMaterial (Fresnel rim)
   * from procedural.ts. */
  private makeZoneMats(dungeon: boolean): ZoneMats {
    return {
      wall: organicMaterial({ color: dungeon ? 0x6a5a48 : 0xe8dcc0, roughness: 0.9, rimStrength: 0.16 }),
      roof: organicMaterial({ color: dungeon ? 0x4a3a2a : 0x2f6f6a, roughness: 0.85, rimStrength: 0.2 }),
      roofGold: organicMaterial({ color: 0xd4af37, roughness: 0.4, metalness: 0.7, rimStrength: 0.3 }),
      stone: organicMaterial({ color: dungeon ? 0x5a4a3a : 0xcfc0a0, roughness: 1, rimStrength: 0.14 }),
      stoneDark: organicMaterial({ color: dungeon ? 0x3a2f26 : 0x8a7a5f, roughness: 1, rimStrength: 0.14 }),
      wood: organicMaterial({ color: 0x6b4a2f, roughness: 1, rimStrength: 0.15 }),
      crimson: organicMaterial({ color: 0xa02030, roughness: 0.85, rimStrength: 0.2 }),
      gold: organicMaterial({ color: 0xd4af37, roughness: 0.4, metalness: 0.7, rimStrength: 0.3 }),
      jade: organicMaterial({ color: 0x2e8b74, roughness: 0.8, rimStrength: 0.2 }),
      leaf: organicMaterial({ color: 0x4a8a5a, roughness: 0.9, rimStrength: 0.3, side: THREE.DoubleSide }),
      trunk: organicMaterial({ color: 0x6b4a2f, roughness: 1, rimStrength: 0.15 }),
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
   * Asian roof in layers: eave trim + two stacked curved-slope tiers
   * (asianRoofGeo from procedural.ts — 4 águas côncavas com beirais
   * levantados, nunca pirâmide lisa) + gold ridge beam.
   */
  private asianRoof(mats: ZoneMats, w: number, d: number, y: number, tierH = 1.1): THREE.Group {
    const g = new THREE.Group();
    const trim = new THREE.Mesh(chamferedBoxGeo(w * 1.15, 0.1, d * 1.15, 0.03), mats.roofGold);
    trim.position.y = y + 0.05;
    const tier1 = new THREE.Mesh(asianRoofGeo(w, d, tierH, 0.35, 0.28), mats.roof);
    tier1.position.y = y + 0.1;
    const tier2 = new THREE.Mesh(asianRoofGeo(w * 0.55, d * 0.55, tierH * 0.8, 0.2, 0.2), mats.roof);
    tier2.position.y = y + 0.1 + tierH;
    const ridge = new THREE.Mesh(ridgeBeamGeo(Math.max(w, d) * 0.45), mats.roofGold);
    ridge.position.y = y + 0.1 + tierH * 1.8 + 0.05;
    if (d > w) ridge.rotation.y = Math.PI / 2;
    g.add(trim, tier1, tier2, ridge);
    return g;
  }

  /** One house: chamfered plaster walls + layered curved roof, facing the plaza.
   * Returns the group (tagged sceneryKey "house" for the GLB swap). */
  private asianBuilding(mats: ZoneMats, w: number, h: number, d: number, x: number, z: number): THREE.Group {
    const y = this.terrainHeight(x, z);
    const g = new THREE.Group();
    const walls = new THREE.Mesh(chamferedBoxGeo(w, h, d, 0.09), mats.wall);
    walls.position.y = h / 2;
    const door = new THREE.Mesh(chamferedBoxGeo(1.1, 1.9, 0.12, 0.04), mats.wood);
    door.position.set(0, 0.95, d / 2 + 0.02);
    const roof = this.asianRoof(mats, w, d, h);
    g.add(walls, door, roof);
    // Face the plaza: the door is on the +Z face, so +Z must point at the
    // origin — rotation.y = atan2(-x, -z). (The old atan2(x, z) pointed
    // the +Z face away from the plaza: houses showed their backs.)
    g.position.set(x, y, z);
    g.rotation.y = Math.atan2(-x, -z);
    g.userData.sceneryKey = "house";
    this.scene.add(g);
    return g;
  }

  /** Add an object to the scene, optionally tagged as a scenery placeholder
   *  (removed when the matching GLB template loads — see applySceneryGlb). */
  private addScenery(obj: THREE.Object3D, key?: string): void {
    if (key) {
      obj.userData.sceneryKey = key;
      this.sceneryPlaceholders.push(obj);
    }
    this.scene.add(obj);
  }

  /** Central lotus fountain: basin + rim + glowing blue water + lotus column.
   * Offset to (7,-7): the spawn point (0,0) sits inside the basin footprint,
   * and the 0.7 m basin wall hid the player's legs from the 2.5D camera. */
  private buildFountain(mats: ZoneMats): void {
    const fx = 7;
    const fz = -7;
    const y = this.terrainHeight(fx, fz);
    const g = new THREE.Group();
    // Basin: one lathe profile (outer wall + rim + inner wall), no cylinder.
    const basin = new THREE.Mesh(fountainBasinGeo(3.2, 0.7), mats.stone);
    const rim = new THREE.Mesh(portalRingGeo(3.2, 0.16), mats.stoneDark);
    rim.position.y = 0.68;
    const water = new THREE.Mesh(latheProfile([[0, 0], [2.9, 0]], 24), mats.water);
    water.position.y = 0.62;
    const column = new THREE.Mesh(fountainColumnGeo(2.2, 0.4), mats.stone);
    column.position.y = 0.6;
    const orb = new THREE.Mesh(
      latheProfile([[0, -0.3], [0.28, -0.15], [0.3, 0], [0.28, 0.15], [0, 0.3]], 12),
      mats.water,
    );
    orb.position.y = 2.95;
    g.add(basin, rim, water, column, orb);
    // Lotus petals around the column top (6 lathe buds, shared petal material).
    const petalGeo = latheProfile([[0, 0], [0.16, 0.1], [0.22, 0.3], [0.12, 0.5], [0, 0.55]], 8);
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      const petal = new THREE.Mesh(petalGeo, mats.petal);
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
      const s = new THREE.Mesh(chamferedBoxGeo(w, h, d, 0.06), mats.stone);
      s.position.set(0, py, 0);
      g.add(s);
    }
    const floor = new THREE.Mesh(chamferedBoxGeo(9, 0.3, 6, 0.06), mats.stone);
    floor.position.set(0, 1.35, 0);
    const back = new THREE.Mesh(chamferedBoxGeo(9, 4.5, 0.6, 0.08), mats.wall);
    back.position.set(0, 3.75, -2.8);
    const door = new THREE.Mesh(chamferedBoxGeo(2, 3, 0.12, 0.04), mats.wood);
    door.position.set(0, 3.0, -2.45);
    // Triangular pediment: chamfered extruded triangle, gold-trimmed.
    const pediment = new THREE.Mesh(pedimentGeo(8, 1.5, 0.5), mats.roof);
    pediment.position.set(0, 5.95, 2.35);
    const roof = this.asianRoof(mats, 11, 8, 6.0, 1.4);
    g.add(floor, back, door, pediment, roof);
    // 6 front columns: sculpted gothic pillars (one InstancedMesh).
    const cols: InstancedItem[] = [];
    for (let i = 0; i < 6; i += 1) cols.push({ x: -3.75 + i * 1.5, y: 1.5, z: 2.6 });
    g.add(makeInstanced(gothicPillar(0.35, 4.2, 14), mats.stone, cols));
    g.position.set(0, y, cz);
    this.addScenery(g, "temple");
  }

  /** Market stall: 4 posts, striped crimson/gold awning, counter + goods. */
  private marketStall(mats: ZoneMats, x: number, z: number, ry: number): void {
    const y = this.terrainHeight(x, z);
    const g = new THREE.Group();
    // Posts: tapered lathe (never bare cylinders).
    const postGeo = lanternPostGeo(2.3);
    for (const [px, pz] of [[-1.6, -1.3], [1.6, -1.3], [-1.6, 1.3], [1.6, 1.3]] as const) {
      const post = new THREE.Mesh(postGeo, mats.wood);
      post.position.set(px, 0, pz);
      g.add(post);
    }
    // Awning: 5 alternating chamfered stripes across the width (crimson/gold).
    for (let i = 0; i < 5; i += 1) {
      const stripe = new THREE.Mesh(
        chamferedBoxGeo(0.74, 0.08, 3.1, 0.02),
        i % 2 === 0 ? mats.crimson : mats.gold,
      );
      stripe.position.set(-1.48 + i * 0.74, 2.35, 0);
      g.add(stripe);
    }
    const counter = new THREE.Mesh(chamferedBoxGeo(3, 0.9, 1.2, 0.05), mats.wood);
    counter.position.set(0, 0.45, 0.4);
    const goods: Array<[number, number, THREE.Material]> = [
      [-0.9, 1.05, mats.jade],
      [0, 1.1, mats.gold],
      [0.9, 1.05, mats.crimson],
    ];
    for (const [gx, gy, gm] of goods) {
      const box = new THREE.Mesh(chamferedBoxGeo(0.5, 0.3, 0.5, 0.04), gm);
      box.position.set(gx, gy, 0.4);
      g.add(box);
    }
    g.add(counter);
    g.position.set(x, y, z);
    g.rotation.y = ry;
    g.userData.sceneryKey = "stall";
    this.sceneryPlaceholders.push(g);
    this.stallPlacements.push({ x, z, ry });
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
      const w = 4.5 + rng() * 2;
      const h = 3 + rng() * 1.5;
      const d = 3.6 + rng() * 1.2;
      this.asianBuilding(mats, w, h, d, x, z);
      // GLB house template is 5 m tall: uniform scale matches the height.
      // ry matches asianBuilding: the door (+Z face) points at the plaza.
      this.housePlacements.push({ x, z, ry: Math.atan2(-x, -z), s: h / 5 });
    }
    this.buildTemple(mats);
    // Market stalls on the four diagonals (between the houses, off the
    // streets). The counter/goods are on the +Z face, so ry = atan2(-x, -z)
    // turns the front toward the plaza (the old values faced outward).
    this.marketStall(mats, 12, 12, (-3 * Math.PI) / 4);
    this.marketStall(mats, -12, 12, (3 * Math.PI) / 4);
    this.marketStall(mats, 12, -12, -Math.PI / 4);
    this.marketStall(mats, -12, -12, Math.PI / 4);
    // Jade wall: instanced segments around r = 44, gaps at the east/west gates.
    const wallItems: InstancedItem[] = [];
    for (let i = 0; i < 30; i += 1) {
      const a = (i / 30) * Math.PI * 2;
      const deg = (a * 180) / Math.PI;
      if (Math.min(Math.abs(deg), Math.abs(deg - 180)) < 12) continue; // gate gaps
      wallItems.push({ x: Math.cos(a) * 44, y: 1.6, z: Math.sin(a) * 44, ry: -a - Math.PI / 2 });
    }
    this.addScenery(makeInstanced(chamferedBoxGeo(4.6, 3.2, 1.1, 0.08), mats.jade, wallItems));
    // Gate towers flanking each gate (4 towers, 2 meshes each).
    for (const [gx, gz] of [[44, -3.5], [44, 3.5], [-44, -3.5], [-44, 3.5]] as const) {
      const gy = this.terrainHeight(gx, gz);
      const tower = new THREE.Mesh(chamferedBoxGeo(2.5, 6.5, 2.5, 0.1), mats.stone);
      tower.position.set(gx, gy + 3.25, gz);
      const cap = new THREE.Mesh(asianRoofGeo(2.5, 2.5, 1.4, 0.3, 0.25), mats.roof);
      cap.position.set(gx, gy + 6.5, gz);
      this.scene.add(tower, cap);
    }
    // Palms lining the streets (24): lathe trunk + instanced frond fan +
    // date cluster — never cones. One draw call per part (3 total).
    const treePos: Array<[number, number]> = [];
    for (const s of [-28, -20, -12, 12, 20, 28]) {
      treePos.push([6.5, s], [-6.5, s], [s, 6.5], [s, -6.5]);
    }
    const prng = sfc32(20261116);
    const trunkItems: InstancedItem[] = [];
    const frondItems: InstancedItem[] = [];
    const dateItems: InstancedItem[] = [];
    for (const [x, z] of treePos) {
      const ty = this.terrainHeight(x, z);
      const lean = (prng() - 0.5) * 0.24;
      const leanDir = prng() * Math.PI * 2;
      const s = 0.9 + prng() * 0.25;
      this.palmPlacements.push({ x, y: ty, z, ry: leanDir, s });
      trunkItems.push({ x, y: ty, z, rz: lean, s });
      dateItems.push({ x, y: ty + 2.5 * s, z });
      for (let k = 0; k < 9; k += 1) {
        frondItems.push({
          x,
          y: ty + 2.55 * s,
          z,
          ry: (k / 9) * Math.PI * 2 + leanDir,
          s: s * (0.9 + prng() * 0.2),
        });
      }
    }
    this.addScenery(makeInstanced(palmTrunkGeo(2.6, 0.22, 12), mats.trunk, trunkItems), "palm");
    this.addScenery(makeInstanced(palmFrondGeo(2.2, 0.42), mats.leaf, frondItems), "palm");
    this.addScenery(
      makeInstanced(
        latheProfile([[0, -0.2], [0.2, -0.1], [0.22, 0.05], [0.12, 0.2], [0, 0.22]], 8),
        mats.wood,
        dateItems,
      ),
      "palm",
    );
    // Lanterns along both streets (26, instanced lathe post + lathe body + mini roof).
    // s = 0 is skipped on the north/south street rows: a lantern at (0, ±3.4)
    // sits exactly on the spawn -> camera sightline and hides the hero.
    const lampPos: Array<[number, number]> = [];
    for (let s = -24; s <= 24; s += 8) {
      lampPos.push([3.4, s], [-3.4, s]);
      if (s !== 0) lampPos.push([s, 3.4], [s, -3.4]);
    }
    this.scene.add(
      makeInstanced(
        lanternPostGeo(2.4),
        mats.wood,
        lampPos.map(([x, z]) => ({ x, y: this.terrainHeight(x, z), z })),
      ),
    );
    this.scene.add(
      makeInstanced(
        lanternBodyGeo(),
        mats.lanternGlow,
        lampPos.map(([x, z]) => ({ x, y: this.terrainHeight(x, z) + 2.3, z })),
      ),
    );
    this.scene.add(
      makeInstanced(
        asianRoofGeo(0.45, 0.45, 0.18, 0.08, 0.06, 6),
        mats.roofGold,
        lampPos.map(([x, z]) => ({ x, y: this.terrainHeight(x, z) + 2.72, z })),
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
    this.scene.add(makeInstanced(organicCloudGeo(20261112), mats.cloud, clouds));
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
    this.scene.add(makeInstanced(organicRockGeo(0.7, 5, 0.45), mats.stoneDark, rocks));
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
    const water = new THREE.Mesh(latheProfile([[0, 0], [6, 0]], 28), mats.water);
    water.position.set(ox, oy + 0.15, oz);
    const sand = new THREE.Mesh(
      latheProfile([[6, 0], [7.5, 0]], 28),
      new THREE.MeshStandardMaterial({ color: 0xecd29b, roughness: 1 }),
    );
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
    // Procedural palms (same kit as the city): lathe trunk + frond fan.
    const duneTrunks: InstancedItem[] = [];
    const duneFronds: InstancedItem[] = [];
    for (const [x, z] of palmPos) {
      const ty = this.terrainHeight(x, z);
      const leanDir = rng() * Math.PI * 2;
      const s = 0.95 + rng() * 0.3;
      this.palmPlacements.push({ x, y: ty, z, ry: leanDir, s });
      duneTrunks.push({ x, y: ty, z, rz: (rng() - 0.5) * 0.3, s });
      for (let k = 0; k < 9; k += 1) {
        duneFronds.push({
          x,
          y: ty + 2.55 * s,
          z,
          ry: (k / 9) * Math.PI * 2 + leanDir,
          s: s * (0.9 + rng() * 0.2),
        });
      }
    }
    this.addScenery(makeInstanced(palmTrunkGeo(2.6, 0.22, 12), mats.trunk, duneTrunks), "palm");
    this.addScenery(makeInstanced(palmFrondGeo(2.2, 0.42), mats.leaf, duneFronds), "palm");
    // Ruined arch + broken columns at (-22, -18).
    const ax = -22;
    const az = -18;
    const ay = this.terrainHeight(ax, az);
    const pillarGeo = chamferedBoxGeo(1, 5, 1, 0.08);
    for (const dx of [-2.5, 2.5]) {
      const p = new THREE.Mesh(pillarGeo, mats.stone);
      p.position.set(ax + dx, ay + 2.5, az);
      this.scene.add(p);
    }
    const lintel = new THREE.Mesh(chamferedBoxGeo(6.5, 1, 1.2, 0.08), mats.stone);
    lintel.position.set(ax, ay + 5.4, az);
    this.scene.add(lintel);
    const broken: InstancedItem[] = [];
    for (let i = 0; i < 6; i += 1) {
      const bx = ax - 6 + rng() * 12;
      const bz = az + 4 + rng() * 8;
      broken.push({
        x: bx,
        y: this.terrainHeight(bx, bz) + rng() * 0.4,
        z: bz,
        rz: (rng() - 0.5) * 0.25,
        sy: 0.4 + rng() * 0.8,
      });
    }
    this.scene.add(makeInstanced(gothicPillar(0.4, 1.8, 10), mats.stone, broken));
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
    this.scene.add(makeInstanced(organicRockGeo(0.7, 7, 0.45), mats.stoneDark, rocks));
    const cacti: InstancedItem[] = [];
    guard = 0;
    while (cacti.length < 10 && guard < 200) {
      guard += 1;
      const x = (rng() * 2 - 1) * 50;
      const z = (rng() * 2 - 1) * 50;
      if (!clearOfPaths(x, z, 0)) continue;
      if (Math.hypot(x - ox, z - oz) < 11) continue;
      cacti.push({ x, y: this.terrainHeight(x, z), z, ry: rng() * Math.PI, sy: 0.8 + rng() * 0.6 });
    }
    // Cactus: lathe body + arms merged (cactusGeo), never cylinder + sphere.
    this.scene.add(makeInstanced(cactusGeo(1.8, 3), mats.leaf, cacti));
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
    this.scene.add(makeInstanced(chamferedBoxGeo(4.6, 5, 1.2, 0.08), mats.stoneDark, wallItems));
    // Two rows of sculpted pillars (12) + capitals (instanced).
    const pillars: InstancedItem[] = [];
    for (const px of [-12, 12]) {
      for (let z = -30; z <= 30; z += 12) pillars.push({ x: px, y: 0, z });
    }
    this.scene.add(makeInstanced(gothicPillar(0.6, 5, 12), mats.stone, pillars));
    this.scene.add(
      makeInstanced(
        capitalGeo(1.6, 0.4),
        mats.stoneDark,
        pillars.map((p) => ({ x: p.x, y: 5.2, z: p.z })),
      ),
    );
    // Torches on 4 pillars: lathe holder + lathe flame + 4 PointLights (max).
    const torchPos: Array<[number, number]> = [[-12, -18], [12, -18], [-12, 18], [12, 18]];
    this.scene.add(
      makeInstanced(
        lanternPostGeo(0.7),
        mats.wood,
        torchPos.map(([x, z]) => ({ x: x + 0.8, y: 3.05, z })),
      ),
    );
    this.scene.add(
      makeInstanced(
        latheProfile([[0, 0], [0.16, 0.08], [0.22, 0.25], [0.12, 0.45], [0, 0.6]], 8),
        mats.flame,
        torchPos.map(([x, z]) => ({ x: x + 0.8, y: 3.6, z })),
      ),
    );
    for (const [x, z] of torchPos) {
      const light = new THREE.PointLight(0xff7733, 40, 30, 1.8);
      light.position.set(x + 0.8, 3.9, z);
      this.scene.add(light);
    }
    // Altar at the far (north) end + crimson boss ring on the floor.
    const az = -32;
    const step1 = new THREE.Mesh(chamferedBoxGeo(10, 0.4, 6, 0.05), mats.stone);
    step1.position.set(0, 0.2, az);
    const step2 = new THREE.Mesh(chamferedBoxGeo(8, 0.4, 4.5, 0.05), mats.stone);
    step2.position.set(0, 0.6, az);
    const altar = new THREE.Mesh(chamferedBoxGeo(3, 1.2, 1.5, 0.07), isTemplo ? mats.gold : mats.stoneDark);
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
          sarcophagusGeo(2, 1, 1),
          mats.stone,
          [
            { x: -30, y: 0, z: -10 },
            { x: -30, y: 0, z: 10 },
            { x: 30, y: 0, z: -10 },
            { x: 30, y: 0, z: 10 },
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
    this.scene.add(makeInstanced(organicRockGeo(0.7, 11, 0.45), mats.stoneDark, rubble));
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
    // NPCs read as robed figures (lathe robe + lathe head), not green capsules.
    for (const npc of this.activeZone.npcs ?? []) {
      const [nx, , nz] = WORLD_TO_THREE(npc.x, npc.y);
      const ny = this.terrainHeight(nx, nz);
      const robe = new THREE.Mesh(
        npcRobeGeo(),
        organicMaterial({ color: 0x2e8b74, roughness: 0.7, rimStrength: 0.25 }),
      );
      robe.position.set(nx, ny, nz);
      const head = new THREE.Mesh(
        latheProfile([[0, -0.22], [0.2, -0.1], [0.22, 0], [0.2, 0.1], [0, 0.22]], 10),
        organicMaterial({ color: 0xf2d6c2, roughness: 0.5, rimStrength: 0.3 }),
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
        portalRingGeo(1.8, 0.18),
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
    if (genome && (this.glbTemplate || this.glbTemplateM) && this.charMode !== "capsule") {
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
    const isMale = opts.gender === "m";
    // Male players use the rigged male mesh (DEF rig transferred from
    // the female, same procedural bone animation); until it loads, the
    // female GLB is the fallback so no player is ever a capsule.
    const template = isMale ? (this.glbTemplateM ?? this.glbTemplate) : this.glbTemplate;
    if (!template) return null;
    const inner = cloneSkinned(template) as THREE.Group;
    inner.rotation.y = Math.PI;
    const wrapper = new THREE.Group();
    wrapper.add(inner);
    // Real male mesh is already male-proportioned (uniform 1.75); the
    // female mesh keeps the old 1.08x/1.03x male widening only as fallback.
    const maleScale = template === this.glbTemplateM ? 1 : isMale ? 1.08 : 1;
    const maleHeight = template === this.glbTemplateM ? 1 : isMale ? 1.03 : 1;
    wrapper.scale.set(1.75 * maleScale, 1.75 * maleHeight, 1.75 * maleScale);
    const bones = new Map<string, THREE.Bone>();
    const baseQuat = new Map<string, THREE.Quaternion>();
    const materials: THREE.MeshStandardMaterial[] = [];
    const baseColors: THREE.Color[] = [];
    inner.traverse((o) => {
      if (o instanceof THREE.Bone && o.name.startsWith("DEF-")) {
        // Loaded names are sanitized by GLTFLoader (dots stripped) — map
        // back to the canonical dotted name so pose targets match.
        const canonical = glbCanonicalBoneName(o.name);
        bones.set(canonical, o);
        baseQuat.set(canonical, o.quaternion.clone());
      }
      if (o instanceof THREE.Mesh) {
        o.frustumCulled = false;
        if (o.material instanceof THREE.MeshStandardMaterial) {
          const cloned = o.material.clone();
          // The graded albedo reads dark at 8.5 m — lift the base color
          // ~18% (texture kept); baseColors store the lifted value so the
          // armor tint math in applyArmorTint stays consistent.
          cloned.color.multiplyScalar(1.18);
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
      // Unrigged template fallback: no DEF bones — animateGlbRig drives
      // the whole inner group instead (sway/lean/lunge).
      staticRoot: bones.size === 0 ? inner : null,
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
    if (!this.glbTemplate && !this.glbTemplateM) return;
    const inst = this.makeGlbInstance({ gender: this.lastGenome?.gender });
    if (!inst) return;
    this.clearLocalCharacter();
    const isMaleMesh = this.lastGenome?.gender === "m" && this.glbTemplateM !== null;
    this.localCharacter = { group: inst.group, drawCalls: 1, triangles: isMaleMesh ? this.glbTrianglesM : this.glbTriangles, heightM: 1.75 };
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
   * Load the male GLB template (warrior_m_klein_r64_final_rigged.glb, 34-bone
   * DEF rig). Same caching/rebuild behavior as loadGlbCharacter;
   * male players fall back to the female GLB until this arrives.
   */
  async loadGlbMaleCharacter(url: string): Promise<boolean> {
    if (this.glbTemplateM) return true;
    if (!this.glbLoadPromiseM) {
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
          this.glbTemplateM = gltf.scene;
          this.glbTrianglesM = Math.round(triangles);
          if (this.charMode !== "capsule") {
            this.applyGlbLocal();
            this.rebuildAllPlayers();
          }
          return true;
        } catch (err) {
          console.warn("Male GLB failed to load, keeping female GLB fallback:", err);
          this.glbLoadPromiseM = null;
          return false;
        }
      })();
      this.glbLoadPromiseM = p;
    }
    return this.glbLoadPromiseM;
  }

  /**
   * Scenery GLBs (rodada 3): temple/house/stall templates gerados no
   * ComfyUI (TRELLIS2), carregados em background como os GLBs de
   * personagem. Os placeholders procedurais ficam visíveis até o template
   * chegar; applySceneryGlb troca cada placeholder pela versão GLB.
   * Palmeira fica procedural: os dois bakes TRELLIS2 falharam (o voxel
   * remesh estilhaça as frondas finas; sem voxel, o bake sai preto e o
   * GLB fica com 140k tris + plano de chão) — ver work/scenery/.
   */
  async loadSceneryGlbs(): Promise<void> {
    const jobs: Array<[string, string]> = [
      ["temple", "/assets/scenery/temple.glb"],
      ["house", "/assets/scenery/house.glb"],
      ["stall", "/assets/scenery/stall.glb"],
    ];
    await Promise.all(
      jobs.map(async ([key, url]) => {
        try {
          const gltf = await new GLTFLoader().loadAsync(url);
          this.sceneryTemplates.set(key, gltf.scene);
          this.applySceneryGlb(key);
        } catch (err) {
          console.warn(`Scenery GLB ${key} failed to load, keeping procedural:`, err);
        }
      }),
    );
  }

  /** First mesh (geometry + material) of a loaded scenery template. */
  private sceneryMesh(key: string): THREE.Mesh | null {
    const tpl = this.sceneryTemplates.get(key);
    if (!tpl) return null;
    let found: THREE.Mesh | null = null;
    tpl.traverse((o) => {
      if (!found && o instanceof THREE.Mesh) found = o;
    });
    return found;
  }

  /**
   * Swap the procedural placeholders of one key for the GLB version.
   * Temple = single clone (front faces -Z in the GLB, plaza is +Z, so it
   * turns PI); house = InstancedMesh from the recorded placements;
   * stall = one clone per recorded placement.
   */
  private applySceneryGlb(key: string): void {
    const tpl = this.sceneryTemplates.get(key);
    if (!tpl) return;
    for (const ph of [...this.sceneryPlaceholders]) {
      if (ph.userData.sceneryKey === key) {
        this.scene.remove(ph);
        const idx = this.sceneryPlaceholders.indexOf(ph);
        if (idx >= 0) this.sceneryPlaceholders.splice(idx, 1);
      }
    }
    if (key === "temple") {
      const clone = tpl.clone(true);
      const y = this.terrainHeight(0, -30);
      clone.position.set(0, y, -30);
      // No rotation: the GLB front (columns, pediment, steps) is on +Z,
      // and the plaza is +Z from the temple. (The old rotation.y = PI
      // turned the dark back toward the plaza.)
      clone.scale.setScalar(1.1);
      this.scene.add(clone);
    } else if (key === "house") {
      const mesh = this.sceneryMesh("house");
      if (!mesh || this.housePlacements.length === 0) return;
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (!mat) return;
      const items: InstancedItem[] = this.housePlacements.map((p) => ({
        x: p.x,
        y: this.terrainHeight(p.x, p.z),
        z: p.z,
        ry: p.ry,
        s: p.s,
      }));
      this.scene.add(makeInstanced(mesh.geometry, mat, items));
    } else if (key === "stall") {
      for (const p of this.stallPlacements) {
        const clone = tpl.clone(true);
        clone.position.set(p.x, this.terrainHeight(p.x, p.z), p.z);
        clone.rotation.y = p.ry;
        clone.scale.setScalar(0.8);
        this.scene.add(clone);
      }
    }
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
    if (rig.staticRoot) {
      // Unrigged template fallback: whole-body sway/lean/lunge on the
      // inner group (rotation.y = PI stays untouched).
      const tSec = nowMs / 1000;
      let pitch = 0.02 + 0.015 * Math.sin(tSec * 1.6);
      let roll = 0;
      if (animState === 1) {
        pitch = 0.07;
        roll = 0.06 * Math.sin(rig.phase);
      } else if (animState === 2) {
        pitch = 0.18;
        roll = 0.1;
      } else if (animState === 3) {
        pitch = 0.25;
      } else if (animState === 4) {
        pitch = 0.08;
      }
      const k = 1 - Math.exp(-dt / 0.07);
      const cur = rig.current.get("static") ?? { x: 0, y: 0, z: 0 };
      cur.x += (pitch - cur.x) * k;
      cur.z += (roll - cur.z) * k;
      rig.current.set("static", cur);
      rig.staticRoot.rotation.x = cur.x;
      rig.staticRoot.rotation.z = cur.z;
      return;
    }
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
      } else if (!isLocal && (this.glbTemplate || this.glbTemplateM) && this.charMode !== "capsule") {
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

  /** Mob mesh from gamedata (color/scale by mobId); ring = windup telegraph.
   *  Every mobId has a detailed procedural model (see buildMobModel);
   *  bosses (neferet/serket) carry a gold elite ring. Stats/scale come
   *  from gamedata — visuals only. */
  updateMob(e: EntityState): void {
    let entry = this.mobs.get(e.id);
    if (!entry) {
      const data = MOBS.find((m) => m.id === e.mobId) ?? MOBS[0];
      const color = data ? Number.parseInt(data.color.slice(1), 16) : 0x888888;
      const scale = data?.scale ?? 1;
      const built = buildMobModel(e.mobId ?? "", color, scale);
      this.scene.add(built.group);
      const created: { group: THREE.Group; ring: THREE.Mesh; tail?: THREE.Group } = {
        group: built.group,
        ring: built.ring,
      };
      if (built.tail !== undefined) created.tail = built.tail;
      entry = created;
      this.mobs.set(e.id, entry);
    }
    if (!entry) return; // narrowing: entry is always set above
    const [tx, , tz] = WORLD_TO_THREE(e.x, e.y);
    const ty = this.terrainHeight(tx, tz);
    entry.group.position.set(tx, ty, tz);
    entry.group.rotation.y = -e.yaw;
    // Scorpion tail sway (visual only): slow side-to-side arc.
    if (entry.tail) {
      entry.tail.rotation.y = Math.sin(performance.now() / 700) * 0.18;
    }
    entry.ring.visible = e.animState === 9;
    if (entry.ring.visible) {
      const pulse = 0.85 + Math.sin(performance.now() / 90) * 0.15;
      entry.ring.scale.setScalar(pulse);
    }
  }

  /**
   * Debug-only: place a visual-only mob at world (x, y) facing the camera
   * (south), for Playwright verification of mobIds that never spawn in the
   * current zone (golem/cultista). No server entity, no gameplay effect.
   */
  addTestMob(mobId: string, x: number, y: number): void {
    const data = MOBS.find((m) => m.id === mobId);
    if (!data) return;
    const color = Number.parseInt(data.color.slice(1), 16);
    const built = buildMobModel(mobId, color, data.scale);
    const [tx, , tz] = WORLD_TO_THREE(x, y);
    built.group.position.set(tx, this.terrainHeight(tx, tz), tz);
    built.group.rotation.y = Math.PI; // face south = toward the 2.5D camera
    this.scene.add(built.group);
    const entry: { group: THREE.Group; tail?: THREE.Group } = { group: built.group };
    if (built.tail !== undefined) entry.tail = built.tail;
    this.testMobs.push(entry);
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
    // Player fill light: warm, on the camera (south) side, slightly above
    // the hero, so the side the camera sees is lit without touching the sun.
    if (this.playerFill) {
      this.playerFill.position.set(px, py + 2.4, pz + 3.2);
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

  getStats(): { calls: number; triangles: number } {    // three 0.182 WebGPURenderer: info.render.calls is CUMULATIVE since the
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
