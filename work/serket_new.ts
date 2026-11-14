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
  // The human torso emerges from the FRONT of the cephalothorax, not from
  // its center — from the front the scorpion body stays visible at the sides.
  const ceph = add(eggGeo(0.55, 0.39), shell, 0, 0.55, 0.15);
  ceph.scale.set(1.15, 1, 1.25);
  const abd1 = add(eggGeo(0.5, 0.34), shellDark, 0, 0.55, 0.8);
  abd1.scale.set(1.05, 1, 0.95);
  const abd2 = add(eggGeo(0.4, 0.26), shell, 0, 0.58, 1.25);
  abd2.scale.set(1, 1, 0.85);
  // One thin gold trim ring around the cephalothorax (a single ring; the old
  // stacked rings read as a bell).
  const trim = add(bandGeo(0.58, 0.035, 20), gold, 0, 0.5, 0.15);
  trim.scale.set(1.15, 1, 1.25);
  // 8 scorpion legs: thick and shell-colored so they read against the sand
  // (thin dark legs vanish at 8.5 m). They splay beyond the slim gown.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i += 1) {
      const z = -0.35 + i * 0.4;
      const leg = add(limbGeo(0.07, 0.09, 0.95, 6), shell, side * 0.68, 0.35, z);
      leg.rotation.z = side * 1.05;
      leg.rotation.x = (i - 1.5) * 0.12;
    }
  }
  // Pincers: gold claw palms (elongated eggs, never boxes) + two big curved
  // blade fingers each, open like a claw — the scorpion tell from the front.
  const clawFingerPts: Array<[number, number]> = [
    [0, 0],
    [0.09, 0.05],
    [0.12, 0.2],
    [0.09, 0.38],
    [0.03, 0.52],
    [-0.02, 0.36],
    [-0.05, 0.18],
    [-0.04, 0.06],
  ];
  const clawThumbPts: Array<[number, number]> = [
    [0, 0],
    [0.07, 0.04],
    [0.09, 0.14],
    [0.06, 0.28],
    [0.01, 0.36],
    [-0.02, 0.2],
    [-0.04, 0.08],
  ];
  for (const side of [-1, 1]) {
    const arm = add(limbGeo(0.12, 0.1, 0.6, 8), shell, side * 0.62, 0.55, -0.45);
    arm.rotation.set(Math.PI / 2 - 0.25, 0, side * 0.5);
    const palm = add(eggGeo(0.2, 0.16), gold, side * 0.9, 0.55, -0.92);
    palm.scale.set(1, 0.8, 1.6);
    const finger = add(bladeGeo(clawFingerPts, 0.05), gold, side * 0.98, 0.58, -1.28);
    finger.rotation.x = -Math.PI / 2;
    finger.rotation.y = side * -0.3;
    const thumb = add(bladeGeo(clawThumbPts, 0.05), gold, side * 0.8, 0.58, -1.26);
    thumb.rotation.x = -Math.PI / 2;
    thumb.rotation.y = side * 0.45;
  }
  // Tail: arcs up BESIDE the body (her left, +X) so it reads from the front
  // instead of hiding behind the torso; stinger points forward above the
  // shoulder. Animated sway like the scorpion's.
  const tail = new THREE.Group();
  const tailSegs: Array<[number, number, number, number]> = [
    [0.62, 0.9, 1.3, 0.2],
    [0.68, 1.5, 1.15, 0.18],
    [0.66, 2.1, 0.85, 0.16],
    [0.55, 2.6, 0.5, 0.14],
  ];
  for (const [x, y, z, r] of tailSegs) {
    const s = new THREE.Mesh(eggGeo(r, r * 0.9, 0, 10), shell);
    s.position.set(x, y, z);
    tail.add(s);
  }
  const stinger = new THREE.Mesh(spikeGeo(0.13, 0.6, 8), shellDark);
  stinger.position.set(0.48, 2.95, 0.12);
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
    dress, 0, 0.8, -0.05,
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
