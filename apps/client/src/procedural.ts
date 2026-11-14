// ---------------------------------------------------------------------------
// procedural.ts — Gerador Procedural de Malhas Orgânicas e Arquitetônicas.
// Regra Zero Primitivas (rodada 3, permanente): nenhuma primitiva nua
// (cubo, cilindro, cone, esfera chapada) pode permanecer visível no cenário.
// Tudo aqui é malha gerada: perfis de torno (lathe) subdivididos, extrusões
// chanfradas, terreno fractal de múltiplas oitavas e materiais com rim
// light Fresnel. O agente de mobs pode importar daqui (as funções são
// puras e determinísticas — RNG sempre com seed, nunca Math.random).
//
// Orçamentos (AGENTS.md): as geometrias são compartilhadas e instanciadas
// pelo chamador (makeInstanced em render.ts); nada aqui cria draw calls.
// ---------------------------------------------------------------------------
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { sfc32 } from "@azure-edge/shared";

/** Um ponto de perfil de torno: [raio, altura]. */
export type LathePoint = [number, number];

/** Ponto 2D para shapes de extrusão. */
export type ShapePoint = [number, number];

// ---------------------------------------------------------------------------
// Ruído determinístico (value noise + fbm) — base do terreno fractal e do
// deslocamento orgânico. Hash inteiro -> [0, 1); interpolação suave.
// ---------------------------------------------------------------------------

function hash2(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 974634211) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise 2D em [0, 1], determinístico. */
export function valueNoise2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/**
 * fbm (fractal brownian motion) em [-1, 1]: `octaves` oitavas de value
 * noise, lacunaridade 2, ganho 0.5. É o "ruído fractal de múltiplas
 * oitavas" da regra — usado pelo terreno e pelo deslocamento orgânico.
 */
export function fbm2(x: number, z: number, seed: number, octaves = 4): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o += 1) {
    sum += amp * (valueNoise2(x * freq, z * freq, seed + o * 101) * 2 - 1);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * Altura fractal para um ponto de terreno: base (a forma larga — dunas,
 * praça) + detalhe fbm de alta frequência. `detailAmp` é pequeno para não
 * quebrar a caminhabilidade visual (o servidor não valida Y).
 */
export function fractalHeight(
  x: number,
  z: number,
  base: number,
  seed: number,
  detailAmp = 0.18,
  detailFreq = 0.12,
): number {
  return base + detailAmp * fbm2(x * detailFreq, z * detailFreq, seed, 4);
}

/**
 * Terreno fractal: PlaneGeometry subdividida, deslocada por fbm de 5
 * oitavas (duas escalas: dunas largas + detalhe fino), normais
 * recalculadas. O chamador pinta vertex colors / textura por cima.
 */
export function fractalTerrain(
  size: number,
  segments: number,
  opts: {
    seed?: number;
    amp?: number;
    freq?: number;
    detailAmp?: number;
    detailFreq?: number;
  } = {},
): THREE.PlaneGeometry {
  const seed = opts.seed ?? 20261114;
  const amp = opts.amp ?? 1;
  const freq = opts.freq ?? 0.05;
  const detailAmp = opts.detailAmp ?? 0.25;
  const detailFreq = opts.detailFreq ?? 0.35;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h =
      amp * fbm2(x * freq, z * freq, seed, 5) +
      detailAmp * fbm2(x * detailFreq, z * detailFreq, seed + 7, 3);
    pos.setY(i, h);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Desloca os vértices de uma geometria ao longo das normais com fbm 3D. */
export function displaceGeometry(
  geo: THREE.BufferGeometry,
  amount: number,
  seed: number,
  freq = 0.9,
): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const n =
      (fbm2(v.x * freq + 13.7, v.y * freq + v.z * freq, seed, 3) +
        fbm2(v.y * freq + v.z * freq, v.x * freq - 4.2, seed + 31, 3)) *
      0.5;
    const d = 1 + n * amount;
    pos.setXYZ(i, v.x * d, v.y * d, v.z * d);
  }
  geo.deleteAttribute("normal");
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// Perfis de torno (lathe) — a base de tudo que é redondo e orgânico.
// ---------------------------------------------------------------------------

/**
 * LatheGeometry a partir de um perfil [raio, altura] com normais suaves.
 * Perfis anatômicos/arquitetônicos: vasos, colunas, troncos, bacias.
 */
export function latheProfile(
  profile: LathePoint[],
  segments = 20,
  phiStart = 0,
  phiLength = Math.PI * 2,
): THREE.LatheGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(pts, segments, phiStart, phiLength);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Extrusão chanfrada de um shape 2D: cantos arredondados + bevel. Substitui
 * caixas nuas (paredes, degraus, lintéis, sarcófagos) por blocos com borda
 * trabalhada. `depth` é a espessura; a geometria sai centrada em Z.
 */
export function chamferedExtrude(
  shape: THREE.Shape,
  opts: { depth?: number; bevel?: number; bevelSegments?: number; curveSegments?: number } = {},
): THREE.ExtrudeGeometry {
  const depth = opts.depth ?? 1;
  const bevel = opts.bevel ?? 0.08;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.9,
    bevelSegments: opts.bevelSegments ?? 2,
    curveSegments: opts.curveSegments ?? 12,
  });
  geo.translate(0, 0, -depth / 2);
  geo.computeVertexNormals();
  return geo;
}

/** Shape retangular de cantos arredondados (para chamferedExtrude). */
export function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/**
 * Caixa chanfrada (substitui BoxGeometry nua): retângulo arredondado
 * extrudado com bevel. `w` x `h` no plano XY, `d` de profundidade.
 */
export function chamferedBoxGeo(
  w: number,
  h: number,
  d: number,
  bevel = 0.08,
): THREE.ExtrudeGeometry {
  return chamferedExtrude(roundedRectShape(w, h, Math.min(bevel * 2, w / 4, h / 4)), {
    depth: d - bevel * 2,
    bevel,
    bevelSegments: 2,
  });
}

// ---------------------------------------------------------------------------
// Pilares e colunas.
// ---------------------------------------------------------------------------

/** Perfil de pilar gótico/esculpido: plinto, anéis, fuste afilado, capitel. */
export function gothicPillarProfile(r: number, h: number): LathePoint[] {
  const c = r;
  const top = h;
  return [
    [c * 1.45, 0],
    [c * 1.45, top * 0.03],
    [c * 1.15, top * 0.05],
    [c * 1.05, top * 0.07],
    [c * 0.95, top * 0.1],
    [c * 1.12, top * 0.13],
    [c * 1.12, top * 0.16],
    [c * 0.88, top * 0.19],
    [c * 0.82, top * 0.3],
    [c * 0.78, top * 0.5],
    [c * 0.74, top * 0.68],
    [c * 0.78, top * 0.8],
    [c * 0.95, top * 0.84],
    [c * 1.05, top * 0.87],
    [c * 1.05, top * 0.91],
    [c * 1.3, top * 0.94],
    [c * 1.35, top * 0.97],
    [c * 1.35, top],
  ];
}

/** Pilar gótico esculpido (substitui o cilindro nu da coluna). */
export function gothicPillar(r: number, h: number, segments = 14): THREE.LatheGeometry {
  return latheProfile(gothicPillarProfile(r, h), segments);
}

/** Capitel separado (ábaco) para pilares de dungeon: caixa chanfrada. */
export function capitalGeo(w: number, h: number): THREE.ExtrudeGeometry {
  return chamferedBoxGeo(w, h, w, 0.06);
}

// ---------------------------------------------------------------------------
// Telhados: cumeeira curva com beirais levantados (nunca pirâmide lisa).
// Geometria paramétrica: 4 águas curvas; cada água é uma grade (u ao longo
// da largura, v do beiral à cumeeira) com perfil parabólico e cantos
// levantados (upturned eaves). 1 geometria por telhado, compartilhável.
// ---------------------------------------------------------------------------

/**
 * Telhado de 4 águas com beirais levantados e cumeeira. `w`/`d` = pegada,
 * `h` = altura do beiral à cumeeira, `overhang` = quanto o beiral avança,
 * `lift` = quanto os cantos levantam. Retorna BufferGeometry com normais.
 */
export function asianRoofGeo(
  w: number,
  d: number,
  h: number,
  overhang = 0.35,
  lift = 0.28,
  segments = 10,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const hw = w / 2 + overhang;
  const hd = d / 2 + overhang;
  // Cumeeira no eixo mais comprido: as águas do eixo curto fecham num ponto
  // e as do eixo longo fecham num segmento (a cumeeira). Sem isso o topo
  // vira um "X" de arestas.
  const ridgeX = Math.max(0, hw - hd);
  const ridgeZ = Math.max(0, hd - hw);
  // 4 águas: +z (frente), -z (trás), +x (direita), -x (esquerda).
  // Cada água: grade (segments+1) x (segments+1); v=0 no beiral, v=1 na cumeeira.
  // Perfil: y = h * v^1.6 (curva côncava, típica de telhado asiático);
  // cantos levantam: y += lift * (distância ao centro da água)^2 * (1-v).
  let base = 0;
  const sides: Array<{ axis: "x" | "z"; sign: number; ridge: number }> = [
    { axis: "z", sign: 1, ridge: ridgeX },
    { axis: "z", sign: -1, ridge: ridgeX },
    { axis: "x", sign: 1, ridge: ridgeZ },
    { axis: "x", sign: -1, ridge: ridgeZ },
  ];
  for (const side of sides) {
    for (let j = 0; j <= segments; j += 1) {
      const v = j / segments;
      for (let i = 0; i <= segments; i += 1) {
        const u = (i / segments) * 2 - 1; // -1..1 ao longo da água
        const along = side.axis === "z" ? hw : hd;
        const across = side.axis === "z" ? hd : hw;
        // A largura ao longo da água encolhe até o segmento da cumeeira.
        const alongNow = along - v * (along - side.ridge);
        const y = h * Math.pow(v, 1.6) + lift * u * u * (1 - v) * 0.9;
        const a = u * alongNow;
        const b = (1 - v) * across * side.sign;
        const x = side.axis === "z" ? a : b;
        const z = side.axis === "z" ? b : a;
        positions.push(x, y, z);
        uvs.push((u + 1) / 2, v);
      }
    }
    const n = segments + 1;
    for (let j = 0; j < segments; j += 1) {
      for (let i = 0; i < segments; i += 1) {
        const a = base + j * n + i;
        const b = a + 1;
        const c = a + n;
        const e = c + 1;
        indices.push(a, c, b, b, c, e);
      }
    }
    base += n * n;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Cumeeira dourada: barra chanfrada com pontas levantadas (2 segmentos). */
export function ridgeBeamGeo(w: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2 + 0.15, 0.22);
  s.lineTo(w / 2 - 0.1, 0.1);
  s.lineTo(-w / 2 + 0.1, 0.1);
  s.lineTo(-w / 2 - 0.15, 0.22);
  s.closePath();
  return chamferedExtrude(s, { depth: 0.16, bevel: 0.03 });
}

// ---------------------------------------------------------------------------
// Vegetação orgânica.
// ---------------------------------------------------------------------------

/** Tronco de palmeira: lathe curvo com anéis (perfil ondulado = casca). */
export function palmTrunkGeo(h: number, r = 0.22, segments = 12): THREE.LatheGeometry {
  const profile: LathePoint[] = [];
  const steps = 14;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    // Afina para o topo, com anéis de casca (seno) e leve curva embutida
    // na geometria (a inclinação vem da instância, via rz).
    const ring = 1 + 0.08 * Math.sin(t * Math.PI * 14);
    profile.push([r * (1 - 0.35 * t) * ring, t * h]);
  }
  return latheProfile(profile, segments);
}

/**
 * Folha/frond de palmeira: lâmina curva e afilada ao longo de +Z (grade
 * 3 x 8 com dobra em V na nervura central — a dobra capta luz e a folha
 * lê como volume, não como papel recortado), droop parabólico +
 * afilamento, já inclinada -0.5 rad em X para subir e depois cair. Uma
 * geometria, instanciada em leque ao redor do topo do tronco (8–10 por
 * palmeira, 1 draw call no total): a instância só precisa de `ry`.
 */
export function palmFrondGeo(len = 2.2, width = 0.42): THREE.BufferGeometry {
  const segs = 8;
  const cols = 3; // borda, nervura, borda
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= segs; j += 1) {
    const v = j / segs;
    const z = v * len;
    const droop = -0.55 * v * v * len * 0.45;
    const wdt = width * (1 - v * 0.85) * Math.sin(Math.min(1, v * 3) * Math.PI * 0.5 + 0.15);
    // Dobra em V: nervura central elevada ~35% da meia-largura; some na ponta.
    const fold = 0.35 * (wdt / 2) * (1 - v * 0.7);
    positions.push(-wdt / 2, droop, z, 0, droop + fold, z, wdt / 2, droop, z);
    uvs.push(0, v, 0.5, v, 1, v);
  }
  for (let j = 0; j < segs; j += 1) {
    const a = j * cols;
    const b = a + cols;
    indices.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.rotateX(-0.5); // sobe da copa e cai na ponta
  geo.computeVertexNormals();
  return geo;
}

/**
 * Copa de árvore orgânica: icosaedro subdividido deslocado por fbm —
 * volume irregular, nunca cone liso. `seed` varia a copa por instância
 * (o chamador gera 2–3 variantes e instancia cada uma).
 */
export function organicCanopyGeo(radius = 1.6, detail = 2, seed = 11, amount = 0.22): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  displaceGeometry(geo, amount, seed, 1.1);
  geo.scale(1, 0.82, 1);
  geo.computeVertexNormals();
  return geo;
}

/** Tronco de árvore genérico: lathe com base alargada e afilamento. */
export function organicTrunkGeo(h = 2.6, r = 0.24, segments = 10): THREE.LatheGeometry {
  return latheProfile(
    [
      [r * 1.5, 0],
      [r * 1.25, h * 0.08],
      [r * 0.95, h * 0.3],
      [r * 0.85, h * 0.55],
      [r * 0.72, h * 0.8],
      [r * 0.6, h],
    ],
    segments,
  );
}

// ---------------------------------------------------------------------------
// Rochas, cactos, nuvens.
// ---------------------------------------------------------------------------

/** Rocha orgânica: icosaedro deslocado por fbm (nunca dodecaedro liso). */
export function organicRockGeo(radius = 0.7, seed = 5, amount = 0.45): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(radius, 1);
  displaceGeometry(geo, amount, seed, 1.4);
  geo.scale(1, 0.72, 1);
  geo.computeVertexNormals();
  return geo;
}

/** Cacto: coluna lathe com 2 braços (merge de lathes), sem cilindros nus. */
export function cactusGeo(h = 1.8, seed = 3): THREE.BufferGeometry {
  const rng = sfc32(seed);
  const body = latheProfile(
    [
      [0.3, 0],
      [0.32, h * 0.2],
      [0.28, h * 0.6],
      [0.26, h * 0.9],
      [0.12, h * 0.98],
      [0.0, h],
    ],
    10,
  );
  const arm = (x: number, y: number, len: number, flip: number): THREE.BufferGeometry => {
    const g = latheProfile(
      [
        [0.11, 0],
        [0.12, len * 0.5],
        [0.1, len * 0.85],
        [0.0, len],
      ],
      8,
    );
    g.rotateZ(flip * Math.PI * 0.42);
    g.translate(x, y, 0);
    return g;
  };
  const a1 = arm(0.3 + rng() * 0.05, h * 0.35, h * 0.45, 1);
  const a2 = arm(-0.3 - rng() * 0.05, h * 0.5, h * 0.38, -1);
  const merged = mergeGeometries([body, a1, a2]);
  if (!merged) return body;
  merged.computeVertexNormals();
  return merged;
}

/** Nuvem orgânica: elipsoide lathe deslocado (nunca esfera chapada). */
export function organicCloudGeo(seed = 9): THREE.BufferGeometry {
  const geo = eggGeo(1, 1, 0, 12, 9);
  displaceGeometry(geo, 0.3, seed, 1.2);
  geo.scale(1.6, 0.55, 1);
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// Arquitetura: fontes, lanternas, sarcófagos, arcos, muros.
// ---------------------------------------------------------------------------

/** Bacia de fonte: um único perfil lathe (bacia + borda + coluna). */
export function fountainBasinGeo(r = 3.2, h = 0.7): THREE.LatheGeometry {
  return latheProfile(
    [
      [0, 0],
      [r * 0.92, 0],
      [r, h * 0.25],
      [r * 1.02, h * 0.7],
      [r * 0.98, h * 0.95],
      [r * 0.88, h],
      [r * 0.88, h * 0.55],
    ],
    28,
  );
}

/** Coluna de fonte / pedestal: lathe com anéis. */
export function fountainColumnGeo(h = 2.2, r = 0.4): THREE.LatheGeometry {
  return latheProfile(
    [
      [r * 1.3, 0],
      [r * 1.1, h * 0.06],
      [r * 0.85, h * 0.15],
      [r * 0.8, h * 0.6],
      [r * 0.9, h * 0.85],
      [r * 1.05, h * 0.93],
      [r * 1.05, h],
    ],
    14,
  );
}

/** Lanterna: poste lathe afilado + corpo lathe (o brilho vem do material). */
export function lanternPostGeo(h = 2.4): THREE.LatheGeometry {
  return latheProfile(
    [
      [0.09, 0],
      [0.07, h * 0.3],
      [0.055, h * 0.7],
      [0.05, h * 0.95],
      [0.09, h],
    ],
    8,
  );
}

export function lanternBodyGeo(): THREE.LatheGeometry {
  return latheProfile(
    [
      [0.02, 0],
      [0.16, 0.06],
      [0.19, 0.2],
      [0.16, 0.34],
      [0.05, 0.4],
      [0.0, 0.42],
    ],
    10,
  );
}

/** Sarcófago: base chanfrada + tampa em arco (extrusão de shape arqueado). */
export function sarcophagusGeo(w = 2, h = 1, d = 1): THREE.BufferGeometry {
  const base = chamferedBoxGeo(w, h * 0.7, d, 0.07);
  base.translate(0, h * 0.35, 0);
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.quadraticCurveTo(w / 2, h * 0.55, 0, h * 0.55);
  s.quadraticCurveTo(-w / 2, h * 0.55, -w / 2, 0);
  const lid = chamferedExtrude(s, { depth: d * 0.9, bevel: 0.05 });
  lid.translate(0, h * 0.7, 0);
  const merged = mergeGeometries([base, lid]);
  if (!merged) return base;
  merged.computeVertexNormals();
  return merged;
}

/** Frontão triangular chanfrado (substitui o cone achatado do templo). */
export function pedimentGeo(w: number, h: number, d: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  return chamferedExtrude(s, { depth: d, bevel: 0.06 });
}

/** Anel de portal lathe (energia): perfil fino em vez de torus nu. */
export function portalRingGeo(r = 1.8, tube = 0.16): THREE.LatheGeometry {
  const pts: LathePoint[] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    pts.push([r + Math.cos(a) * tube, Math.sin(a) * tube]);
  }
  return latheProfile(pts, 28);
}

/** Manto de NPC: lathe com ombros e barra (substitui o cone do NPC). */
export function npcRobeGeo(): THREE.LatheGeometry {
  return latheProfile(
    [
      [0.48, 0],
      [0.46, 0.15],
      [0.4, 0.6],
      [0.34, 1.0],
      [0.3, 1.25],
      [0.22, 1.42],
      [0.16, 1.5],
    ],
    12,
  );
}

// ---------------------------------------------------------------------------
// Materiais orgânicos: MeshStandardMaterial com rim light Fresnel.
// (onBeforeCompile: caminho WebGL2; no WebGPU o material renderiza normal,
// sem o rim — o renderer ignora o hook em vez de quebrar.)
// ---------------------------------------------------------------------------

export interface OrganicMaterialOpts {
  color: number;
  roughness?: number;
  metalness?: number;
  emissive?: number;
  emissiveIntensity?: number;
  rimColor?: number;
  rimStrength?: number;
  /** e.g. THREE.DoubleSide for flat blades (palm fronds). */
  side?: THREE.Side;
}

/**
 * Material orgânico com Fresnel/Rim Light: as bordas da silhueta ganham
 * um brilho frio (pele/metais leem melhor contra o chão). `rimStrength`
 * 0 desliga o efeito (vira MeshStandardMaterial comum).
 */
export function organicMaterial(opts: OrganicMaterialOpts): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: opts.color,
    roughness: opts.roughness ?? 0.85,
    metalness: opts.metalness ?? 0.05,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    side: opts.side ?? THREE.FrontSide,
  });
  const rimStrength = opts.rimStrength ?? 0.35;
  const rimColor = new THREE.Color(opts.rimColor ?? 0xbfd4ff);
  if (rimStrength > 0) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uRimColor = { value: rimColor };
      shader.uniforms.uRimStrength = { value: rimStrength };
      shader.fragmentShader =
        "uniform vec3 uRimColor;\nuniform float uRimStrength;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          vec3 rimV = normalize( vViewPosition );
          vec3 rimN = normalize( vNormal );
          float rim = pow( 1.0 - abs( dot( rimN, rimV ) ), 3.0 );
          totalEmissiveRadiance += uRimColor * rim * uRimStrength;
        }`,
      );
    };
  }
  return mat;
}

// ---------------------------------------------------------------------------
// Kit orgânico dos mobs (fonte única — migrado de render.ts no merge da
// rodada 3). Os construtores de mobs (makeScorpion, makeSerket, makeGolem,
// ...) importam daqui; nada de kit duplicado em render.ts. As geometrias
// são as MESMAS de antes (código movido, não reescrito) para não mudar a
// aparência já verificada. latheGeo virou latheProfile (idêntico, com o
// clamp de raio >= 0 mantido nos perfis que o usavam).
// ---------------------------------------------------------------------------

/** Ellipsoid (egg) sampled as a lathe profile: rx/ry radii, centered at cy. */
export function eggGeo(rx: number, ry: number, cy = 0, segments = 18, steps = 12): THREE.BufferGeometry {
  const profile: LathePoint[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = -Math.PI / 2 + (i / steps) * Math.PI;
    profile.push([Math.max(0, Math.cos(a) * rx), cy + Math.sin(a) * ry]);
  }
  return latheProfile(profile, segments);
}

/** Dome (half-ellipsoid): flat base at y=0, apex at y=ry. */
export function domeGeo(r: number, ry: number, segments = 14, steps = 8): THREE.BufferGeometry {
  const profile: LathePoint[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * Math.PI * 0.5;
    profile.push([Math.max(0, Math.cos(a) * r), Math.sin(a) * ry]);
  }
  return latheProfile(profile, segments);
}

/** Tapered limb, centered like a cylinder: rBottom at y=-len/2, rTop at
 *  y=+len/2, softly rounded ends. Drop-in replacement for CylinderGeometry. */
export function limbGeo(rBottom: number, rTop: number, len: number, segments = 10): THREE.BufferGeometry {
  const h = len / 2;
  return latheProfile(
    [
      [0.001, -h],
      [rBottom * 0.75, -h + len * 0.05],
      [rBottom, -len * 0.15],
      [rTop, len * 0.3],
      [rTop * 0.75, h - len * 0.05],
      [0.001, h],
    ],
    segments,
  );
}

/** Spike (horn / stinger / rock spike): curved taper from base radius r to a point. */
export function spikeGeo(r: number, len: number, segments = 10): THREE.BufferGeometry {
  return latheProfile(
    [
      [r, 0],
      [r * 0.62, len * 0.4],
      [r * 0.34, len * 0.7],
      [r * 0.12, len * 0.92],
      [0.001, len],
    ],
    segments,
  );
}

/** Ring / band as a lathe of a rounded profile (replaces torus). Axis is +Y. */
export function bandGeo(radius: number, tube: number, segments = 20): THREE.BufferGeometry {
  const profile: LathePoint[] = [];
  const steps = 8;
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    profile.push([radius + Math.cos(a) * tube, Math.sin(a) * tube]);
  }
  return latheProfile(profile, segments);
}

/** Rounded box as a chamfered extrusion (replaces BoxGeometry). Centered. */
export function rboxGeo(w: number, h: number, d: number, r = 0.03): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  const cr = Math.min(r, w / 2, h / 2);
  s.moveTo(x + cr, y);
  s.lineTo(x + w - cr, y);
  s.quadraticCurveTo(x + w, y, x + w, y + cr);
  s.lineTo(x + w, y + h - cr);
  s.quadraticCurveTo(x + w, y + h, x + w - cr, y + h);
  s.lineTo(x + cr, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - cr);
  s.lineTo(x, y + cr);
  s.quadraticCurveTo(x, y, x + cr, y);
  const bt = Math.min(r, d * 0.3);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.01, d - 2 * bt),
    bevelEnabled: true,
    bevelThickness: bt,
    bevelSize: Math.min(r, w * 0.12, h * 0.12),
    bevelSegments: 2,
    curveSegments: 4,
  });
  geo.translate(0, 0, -d / 2);
  return geo;
}

/** Flat chamfered blade from a 2D polygon (mandibles, claws, cracks). Centered in Z. */
export function bladeGeo(points: Array<[number, number]>, depth: number, bevel = 0.012): THREE.BufferGeometry {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => {
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  });
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.005, depth - 2 * bevel),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 4,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

// ---------------------------------------------------------------------------
// Kit de armas e placeholder (Zero Primitivas, rodada 3): as armas de
// classe (espada/escudo/espingarda/cajado) e o personagem fallback deixam
// de usar Box/Cylinder/Sphere/Cone/Capsule nus. Lâmina = polígono
// chanfrado com ponta e afilamento; cabo/cano/cajado = limbGeo (torno
// de pontas arredondadas); escudo = disco lathe com face abaulada;
// corpo do placeholder = torno de perfil anatômico (ombros/cintura/
// quadril), cabeça = elipsoide lathe, marcador de direção = spike.
// Dimensões e posições idênticas às primitivas que substituem.
// ---------------------------------------------------------------------------

/** Lâmina de espada: duplo gume afilado com ponta, centrada na origem. */
export function swordBladeGeo(w = 0.05, len = 0.75, thick = 0.015): THREE.BufferGeometry {
  const hw = w / 2;
  const h = len / 2;
  return bladeGeo(
    [
      [-hw, -h],
      [hw, -h],
      [hw * 0.8, h * 0.67],
      [0, h],
      [-hw * 0.8, h * 0.67],
    ],
    thick,
    0.004,
  );
}

/** Escudo redondo: disco lathe com face externa abaulada (domo suave). */
export function shieldGeo(r = 0.32): THREE.LatheGeometry {
  return latheProfile(
    [
      [0, -0.02],
      [r * 0.75, -0.02],
      [r * 0.97, -0.01],
      [r, 0],
      [r * 0.97, 0.01],
      [r * 0.75, 0.018],
      [r * 0.3, 0.028],
      [0, 0.03],
    ],
    24,
  );
}

/**
 * Corpo humanoide do placeholder: torno de perfil anatômico (base
 * arredondada, quadril, cintura, ombros, topo arredondado). y = 0..h,
 * raio máximo ~r nos ombros. Substitui CapsuleGeometry(0.35, 0.9).
 */
export function humanoidTorsoGeo(r = 0.35, h = 1.6): THREE.LatheGeometry {
  const s = r / 0.35;
  const t = h / 1.6;
  return latheProfile(
    [
      [0, 0],
      [0.26 * s, 0],
      [0.32 * s, 0.12 * t],
      [0.33 * s, 0.3 * t],
      [0.29 * s, 0.6 * t],
      [0.27 * s, 0.85 * t],
      [0.29 * s, 1.05 * t],
      [0.34 * s, 1.25 * t],
      [0.36 * s, 1.38 * t],
      [0.3 * s, 1.5 * t],
      [0.18 * s, 1.58 * t],
      [0, 1.6 * t],
    ],
    16,
  );
}

/** Fresnel rim term injected into a standard material (WebGL2 path; inert
 *  under WebGPURenderer, where the inverted-hull shell below carries the rim). */
export function applyFresnelRim(mat: THREE.MeshStandardMaterial, rimColor: number, strength: number): void {
  const hex = rimColor.toString(16).padStart(6, "0");
  const r = (((rimColor >> 16) & 255) / 255).toFixed(3);
  const gg = (((rimColor >> 8) & 255) / 255).toFixed(3);
  const b = ((rimColor & 255) / 255).toFixed(3);
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
      {
        float fres = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 3.0);
        totalEmissiveRadiance += vec3(${r}, ${gg}, ${b}) * fres * ${strength.toFixed(2)};
      }`,
    );
  };
  mat.customProgramCacheKey = () => `fresnel-rim-${hex}-${strength}`;
}

/** Inverted-hull rim shell: same geometry, BackSide, translucent color.
 *  Sibling of `mesh` (same transform, grown ~4.5%). Carries the rim look
 *  under WebGPURenderer. Call after the mesh is added to its group. */
export function rimShellOf(mesh: THREE.Mesh, color: number, opacity = 0.3, grow = 1.045): THREE.Mesh {
  const m = new THREE.Mesh(
    mesh.geometry,
    new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, transparent: true, opacity, depthWrite: false }),
  );
  m.position.copy(mesh.position);
  m.rotation.copy(mesh.rotation);
  m.scale.copy(mesh.scale).multiplyScalar(grow);
  const parent = mesh.parent;
  if (parent) parent.add(m);
  return m;
}
