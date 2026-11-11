import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { CharacterGenome } from "@azure-edge/charforge";

/**
 * CharForge v1 mesh builder (M2) — procedural parametric humanoid.
 * No external assets: the base mesh F/M is built from primitives whose
 * scale/offset come from the genome morphs (20 body + 20 face). Parts are
 * merged per material so a character is 4 draw calls (body, hair, outfit,
 * weapons) — inside the ≤6 budget (AGENTS.md §6). Anime look = cel shading
 * via MeshToonMaterial + a 3-tone gradient ramp (CHARACTER_PIPELINE.md).
 *
 * Limitation (v1): merged static meshes — no skeletal rig, so animation is
 * whole-body (bob/lean in the client). A 65-bone rig is pipeline work for
 * M3+; morphs already give the silhouette variety the M2 acceptance needs.
 * Faces -Z (same convention as render.ts: rotation.y = -yaw).
 */

export type CharacterLod = 0 | 1 | 2 | 3;

export interface CharacterBuild {
  group: THREE.Group;
  /** Meshes in the group (= draw calls, one material each). */
  drawCalls: number;
  triangles: number;
  heightM: number;
}

/** LOD by distance (AGENTS.md §6: LOD0 close, LOD3 impostor far away). */
export function lodForDistance(dM: number): CharacterLod {
  if (dM < 12) return 0;
  if (dM < 30) return 1;
  if (dM < 70) return 2;
  return 3;
}

type V3 = [number, number, number];

// 3-tone cel ramp shared by every toon material.
const gradientMap = (() => {
  const tex = new THREE.DataTexture(new Uint8Array([110, 175, 255]), 3, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
})();

const skinMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
const hairMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
const outfitMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
const metalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.7 });

function xg(geo: THREE.BufferGeometry, p: V3, r: V3 = [0, 0, 0], s: V3 = [1, 1, 1]): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...p),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)),
    new THREE.Vector3(...s),
  );
  geo.applyMatrix4(m);
  return geo;
}

function paint(geo: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i += 1) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

function trisOf(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  return Math.floor((geo.index ? geo.index.count : pos.count) / 3);
}

function merged(parts: THREE.BufferGeometry[], mat: THREE.Material): THREE.Mesh {
  const geo = mergeGeometries(parts, false);
  if (!geo) throw new Error("mergeGeometries failed");
  return new THREE.Mesh(geo, mat);
}

/** Adult body dimensions (m) derived from the genome morphs. */
function dims(g: CharacterGenome) {
  const b = g.body;
  const f = g.gender === "f";
  const hs = 1 + 0.1 * b.height;
  const legLen = 0.86 * (1 + 0.1 * b.legLen) * hs;
  const torsoLen = 0.52 * (1 + 0.08 * b.torsoLen) * hs;
  const neckH = 0.07 * (1 + 0.15 * b.neckLen);
  const headR = 0.115 * (1 + 0.05 * g.face.faceLen);
  const shoulderR = 0.2 * (1 + 0.22 * b.shoulders + 0.1 * b.muscle) * (f ? 0.88 : 1);
  const chestR = 0.185 * (1 + 0.18 * b.shoulders + 0.12 * b.muscle) * (f ? 0.92 : 1) + (f ? 0.035 * b.bust : 0);
  const waistR = 0.155 * (1 + 0.18 * b.waist + 0.12 * b.belly);
  const hipR = 0.185 * (1 + 0.16 * b.hips + 0.08 * b.hipWidth) * (f ? 1.08 : 0.94);
  const armLen = 0.58 * (1 + 0.08 * b.armLen) * hs;
  const armR = 0.05 * (1 + 0.15 * b.muscle);
  const thighR = 0.075 * (1 + 0.12 * b.thigh + 0.08 * b.muscle);
  const calfR = 0.055 * (1 + 0.1 * b.calf);
  return {
    f, legLen, torsoLen, neckH, headR, shoulderR, chestR, waistR, hipR,
    armLen, armR, thighR, calfR,
    hipY: legLen,
    shoulderY: legLen + torsoLen,
    headY: legLen + torsoLen + neckH + headR * 0.9,
    heightM: legLen + torsoLen + neckH + headR * 1.9,
  };
}

export function buildCharacter(genome: CharacterGenome, lod: CharacterLod = 0): CharacterBuild {
  const g = genome;
  const d = dims(g);
  const seg = lod === 0 ? 1 : lod === 1 ? 0.66 : 0.4;
  const S = (n: number) => Math.max(4, Math.round(n * seg));
  const skin = g.skin.tone;
  const pal = g.outfit.palette;
  const group = new THREE.Group();
  let triangles = 0;

  if (lod === 3) {
    // Impostor: capsule + head, 1 draw call.
    const parts = [
      paint(xg(new THREE.CapsuleGeometry(0.35, 0.9, 2, S(10)), [0, 0.95, 0]), pal[0]),
      paint(xg(new THREE.SphereGeometry(0.28, S(12), S(8)), [0, 1.85, 0]), skin),
    ];
    const mesh = merged(parts, outfitMat);
    triangles += trisOf(mesh.geometry);
    group.add(mesh);
    return { group, drawCalls: 1, triangles, heightM: d.heightM };
  }

  // --- Body (skin): torso lathe, head, neck, arms, legs, face features ---
  const body: THREE.BufferGeometry[] = [];
  const face = g.face;
  const torsoPts = [
    new THREE.Vector2(d.hipR, d.hipY),
    new THREE.Vector2(d.waistR, d.hipY + d.torsoLen * 0.45),
    new THREE.Vector2(d.chestR, d.hipY + d.torsoLen * 0.8),
    new THREE.Vector2(d.shoulderR, d.shoulderY),
    new THREE.Vector2(0.06, d.shoulderY + 0.02),
  ];
  body.push(paint(new THREE.LatheGeometry(torsoPts, S(20)), skin));
  body.push(paint(xg(new THREE.CylinderGeometry(0.055, 0.065, d.neckH + 0.04, S(10)), [0, d.shoulderY + d.neckH / 2, 0]), skin));
  body.push(paint(
    xg(new THREE.SphereGeometry(d.headR, S(16), S(12)), [0, d.headY, 0], [0, 0, 0],
      [1 + 0.07 * face.faceWidth, 1 + 0.07 * face.faceLen, 1 + 0.05 * face.faceWidth]),
    skin,
  ));
  // Jaw/chin block, scaled by the jaw + chin morphs.
  body.push(paint(
    xg(new THREE.SphereGeometry(d.headR * 0.62, S(12), S(8)), [0, d.headY - d.headR * 0.55, -d.headR * 0.25],
      [0, 0, 0], [1 + 0.15 * face.jaw, 0.8 + 0.1 * face.chin, 0.9]),
    skin,
  ));
  const armAngle = 0.12 + 0.08 * g.body.shoulderSlope;
  for (const side of [-1, 1]) {
    const sx = side * (d.shoulderR * 0.95);
    const topY = d.shoulderY - 0.02;
    const midY = topY - d.armLen * 0.52;
    body.push(paint(xg(new THREE.CylinderGeometry(d.armR, d.armR * 0.85, d.armLen * 0.52, S(10)), [sx, midY, 0], [0, 0, side * armAngle]), skin));
    body.push(paint(xg(new THREE.CylinderGeometry(d.armR * 0.85, d.armR * 0.7, d.armLen * 0.48, S(10)), [sx + side * 0.03, midY - d.armLen * 0.48, 0], [0, 0, side * armAngle]), skin));
    body.push(paint(xg(new THREE.SphereGeometry(0.05 * (1 + 0.15 * g.body.handSize), S(10), S(8)), [sx + side * 0.05, topY - d.armLen - 0.02, 0], [0, 0, 0], [0.8, 1.2, 0.9]), skin));
  }
  for (const side of [-1, 1]) {
    const lx = side * d.hipR * 0.55;
    body.push(paint(xg(new THREE.CylinderGeometry(d.thighR, d.calfR * 1.15, d.legLen * 0.52, S(10)), [lx, d.legLen * 0.74, 0]), skin));
    body.push(paint(xg(new THREE.CylinderGeometry(d.calfR * 1.15, d.calfR * 0.8, d.legLen * 0.48, S(10)), [lx, d.legLen * 0.24, 0]), skin));
    body.push(paint(xg(new THREE.BoxGeometry(0.09, 0.05, 0.24 * (1 + 0.15 * g.body.footSize)), [lx, 0.03, -0.06]), skin));
  }
  // Face: eyes (dark + iris), nose, mouth, brows, ears, blush.
  const eyeY = d.headY + d.headR * 0.15;
  const eyeZ = -d.headR * (0.82 + 0.1 * face.eyeDepth);
  const eyeR = 0.022 * (1 + 0.25 * face.eyeSize);
  for (const side of [-1, 1]) {
    const ex = side * 0.042 * (1 + 0.12 * face.eyeSpacing);
    const tilt = side * face.eyeTilt * 0.15;
    body.push(paint(xg(new THREE.SphereGeometry(eyeR, S(8), S(6)), [ex, eyeY + tilt, eyeZ]), "#1a1a1a"));
    body.push(paint(xg(new THREE.SphereGeometry(eyeR * 0.55, S(8), S(6)), [ex, eyeY + tilt, eyeZ - 0.012]), g.eyes.iris));
    body.push(paint(xg(new THREE.BoxGeometry(0.05, 0.008 * (1 + face.browThick), 0.008), [ex, eyeY + 0.045, eyeZ - 0.005], [0, 0, -side * face.browAngle * 0.4]), g.hair.color));
    body.push(paint(xg(new THREE.SphereGeometry(0.025 * (1 + 0.3 * face.earSize), S(8), S(6)), [side * d.headR * 1.02, d.headY, 0], [0, 0, 0], [0.4, 1, 0.7]), skin));
    body.push(paint(xg(new THREE.SphereGeometry(0.02 * (1 + face.blush), S(8), S(6)), [side * 0.06, d.headY - d.headR * 0.25, eyeZ - 0.01], [0, 0, 0], [1, 0.7, 0.4]), "#e88a8a"));
  }
  body.push(paint(xg(new THREE.ConeGeometry(0.012, 0.035, S(6)), [0, d.headY - d.headR * 0.05, eyeZ - 0.01], [Math.PI / 2 + 0.3, 0, 0]), skin));
  body.push(paint(xg(new THREE.BoxGeometry(0.05 * (1 + 0.2 * face.lipWidth), 0.008 * (1 + 0.5 * face.lipFull), 0.012), [0, d.headY - d.headR * 0.45 + face.mouthCorner * 0.01, eyeZ - 0.005]), g.makeup.lip));
  const bodyMesh = merged(body, skinMat);
  triangles += trisOf(bodyMesh.geometry);
  group.add(bodyMesh);

  // --- Hair: cap + style pieces (cards/ribbons as flattened boxes/cylinders) ---
  const hair: THREE.BufferGeometry[] = [];
  const hc = g.hair.color;
  const tips = g.hair.tips;
  hair.push(paint(
    xg(new THREE.SphereGeometry(d.headR * 1.08, S(16), S(10), 0, Math.PI * 2, 0, 1.9), [0, d.headY + 0.01, 0.01], [0, 0, 0], [1.02, 1.05, 1.05]),
    hc,
  ));
  const hy = d.headY + d.headR * 0.4;
  if (g.hair.style === "longBraid_03") {
    hair.push(paint(xg(new THREE.CylinderGeometry(0.05, 0.03, 0.55, S(8)), [0, d.shoulderY - 0.25, d.headR + 0.06], [0.25, 0, 0]), hc));
    hair.push(paint(xg(new THREE.ConeGeometry(0.035, 0.12, S(8)), [0, d.shoulderY - 0.55, d.headR + 0.13], [Math.PI + 0.25, 0, 0]), tips));
  } else if (g.hair.style === "ponytail_01") {
    hair.push(paint(xg(new THREE.CylinderGeometry(0.045, 0.025, 0.5, S(8)), [0, hy - 0.15, d.headR + 0.1], [0.6, 0, 0]), hc));
    hair.push(paint(xg(new THREE.TorusGeometry(0.05, 0.015, S(6), S(10)), [0, hy + 0.05, d.headR * 0.9], [0.9, 0, 0]), pal[2]));
  } else if (g.hair.style === "short_02") {
    for (const side of [-1, 1]) {
      hair.push(paint(xg(new THREE.BoxGeometry(0.03, 0.16, 0.08), [side * d.headR * 0.95, d.headY - 0.02, -0.02], [0, 0, side * 0.15]), hc));
    }
  } else if (g.hair.style === "bun_04") {
    hair.push(paint(xg(new THREE.SphereGeometry(0.07, S(12), S(8)), [0, hy + 0.06, d.headR * 0.55]), hc));
    hair.push(paint(xg(new THREE.CylinderGeometry(0.008, 0.008, 0.16, S(6)), [0.05, hy + 0.06, d.headR * 0.55], [0, 0, 0.9]), pal[2]));
  } else if (g.hair.style === "longLoose_05") {
    hair.push(paint(xg(new THREE.BoxGeometry(0.24, 0.62, 0.035), [0, d.shoulderY - 0.2, d.headR + 0.05], [0.08, 0, 0]), hc));
    for (const side of [-1, 1]) {
      hair.push(paint(xg(new THREE.CylinderGeometry(0.025, 0.015, 0.45, S(8)), [side * (d.chestR * 0.7), d.shoulderY - 0.15, -d.chestR * 0.8], [0.1, 0, side * 0.05]), tips));
    }
  } else {
    // topknot_06
    hair.push(paint(xg(new THREE.CylinderGeometry(0.02, 0.03, 0.1, S(8)), [0, hy + 0.08, 0]), hc));
    hair.push(paint(xg(new THREE.SphereGeometry(0.045, S(10), S(8)), [0, hy + 0.15, 0]), tips));
  }
  const hairMesh = merged(hair, hairMat);
  triangles += trisOf(hairMesh.geometry);
  group.add(hairMesh);

  // --- Outfit: chest shell, belt, shoulder pads, lower garment, boots -------
  const outfit: THREE.BufferGeometry[] = [];
  const robe = g.outfit.theme === "noble_robe";
  const skirtLen = robe ? d.legLen * 0.95 : d.legLen * 0.45;
  outfit.push(paint(
    new THREE.LatheGeometry([
      new THREE.Vector2(d.waistR + 0.02, d.hipY + 0.02),
      new THREE.Vector2(d.chestR + 0.02, d.hipY + d.torsoLen * 0.8),
      new THREE.Vector2(d.shoulderR + 0.01, d.shoulderY),
    ], S(20)),
    pal[0],
  ));
  outfit.push(paint(xg(new THREE.CylinderGeometry(d.waistR + 0.025, d.waistR + 0.025, 0.06, S(16)), [0, d.hipY + d.torsoLen * 0.42, 0]), pal[2]));
  for (const side of [-1, 1]) {
    outfit.push(paint(xg(new THREE.SphereGeometry(0.09, S(10), S(8)), [side * d.shoulderR, d.shoulderY + 0.02, 0], [0, 0, 0], [1.2, 0.55, 1]), pal[1]));
    outfit.push(paint(xg(new THREE.CylinderGeometry(d.calfR + 0.015, d.calfR + 0.01, d.legLen * 0.42, S(10)), [side * d.hipR * 0.55, d.legLen * 0.21, 0]), pal[1]));
    outfit.push(paint(xg(new THREE.SphereGeometry(0.05, S(8), S(6)), [side * d.shoulderR * 0.95, d.shoulderY - d.armLen - 0.02, 0], [0, 0, 0], [0.9, 1.2, 0.9]), pal[1]));
  }
  if (g.outfit.theme === "ninja_lite") {
    for (const side of [-1, 1]) {
      outfit.push(paint(xg(new THREE.CylinderGeometry(d.thighR + 0.01, d.calfR + 0.02, d.legLen * 0.5, S(10)), [side * d.hipR * 0.55, d.legLen * 0.75, 0]), pal[0]));
    }
  } else {
    outfit.push(paint(
      new THREE.LatheGeometry([
        new THREE.Vector2(d.hipR + 0.02, d.hipY),
        new THREE.Vector2(d.hipR + 0.06 + skirtLen * 0.1, d.hipY - skirtLen),
      ], S(20)),
      pal[1],
    ));
  }
  const outfitMesh = merged(outfit, outfitMat);
  triangles += trisOf(outfitMesh.geometry);
  group.add(outfitMesh);

  // --- Weapons by class (merged, metal + accent vertex colors) --------------
  const weapons: THREE.BufferGeometry[] = [];
  const steel = "#c8ccd4";
  const grip = "#3a2a1a";
  const handY = d.shoulderY - d.armLen - 0.02;
  const handX = d.shoulderR * 0.95 + 0.05;
  const sword = (x: number, mirror: number): void => {
    weapons.push(paint(xg(new THREE.BoxGeometry(0.035, 0.72, 0.012), [x, handY - 0.3, -0.15], [0.35, 0, mirror * 0.15]), steel));
    weapons.push(paint(xg(new THREE.BoxGeometry(0.12, 0.025, 0.035), [x, handY + 0.06, -0.02], [0.35, 0, mirror * 0.15]), pal[2]));
    weapons.push(paint(xg(new THREE.CylinderGeometry(0.016, 0.016, 0.13, S(8)), [x, handY + 0.01, 0.0], [0.35, 0, mirror * 0.15]), grip));
  };
  if (g.classId === "espadachim") {
    sword(handX, 1);
    sword(-handX, -1);
  } else if (g.classId === "guardiao") {
    sword(handX, 1);
    weapons.push(paint(xg(new THREE.CylinderGeometry(0.28, 0.28, 0.03, S(20)), [-handX, handY + 0.1, 0.05], [Math.PI / 2, 0, 0.3]), pal[0]));
    weapons.push(paint(xg(new THREE.SphereGeometry(0.07, S(10), S(8)), [-handX, handY + 0.1, 0.02], [0, 0, 0], [1, 1, 0.5]), pal[2]));
  } else if (g.classId === "atirador") {
    weapons.push(paint(xg(new THREE.CylinderGeometry(0.028, 0.028, 0.7, S(10)), [0, handY + 0.15, -0.3], [Math.PI / 2 - 0.2, 0, 0]), steel));
    weapons.push(paint(xg(new THREE.CylinderGeometry(0.02, 0.02, 0.3, S(8)), [0, handY + 0.12, -0.28], [Math.PI / 2 - 0.2, 0, 0]), grip));
    weapons.push(paint(xg(new THREE.BoxGeometry(0.07, 0.12, 0.25), [0, handY + 0.05, 0.05], [0.2, 0, 0]), "#6b4a2f"));
  } else {
    // clerigo: staff + orb
    weapons.push(paint(xg(new THREE.CylinderGeometry(0.02, 0.025, 1.5, S(8)), [handX, handY + 0.5, -0.05], [0.1, 0, 0.1]), "#6b4a2f"));
    weapons.push(paint(xg(new THREE.SphereGeometry(0.06, S(12), S(8)), [handX + 0.08, handY + 1.25, -0.12]), pal[2]));
  }
  const weaponMesh = merged(weapons, metalMat);
  triangles += trisOf(weaponMesh.geometry);
  group.add(weaponMesh);

  return { group, drawCalls: 4, triangles, heightM: d.heightM };
}

/** Dispose a build's geometries (materials are shared singletons). */
export function disposeCharacter(build: CharacterBuild): void {
  build.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
}
