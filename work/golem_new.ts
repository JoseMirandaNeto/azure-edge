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
