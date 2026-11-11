import { writeFileSync } from "node:fs";
import { generateGenome, validateGenome } from "@azure-edge/charforge";
import { buildCharacter } from "@azure-edge/engine-adapter";
import { ZONE } from "@azure-edge/gamedata";

// GLTFExporter is browser-first: it uses FileReader to assemble the GLB.
// Minimal polyfill (only readAsArrayBuffer/onloadend are used for binary output).
(globalThis as unknown as { FileReader: unknown }).FileReader = class FileReader {
  result: ArrayBuffer | string | null = null;
  onload: (() => void) | null = null;
  onloadend: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    blob
      .arrayBuffer()
      .then((b) => {
        this.result = b;
        this.onload?.();
        this.onloadend?.();
      })
      .catch((e) => this.onerror?.(e));
  }
};

/**
 * tools — M0 dev CLI. Usage: `pnpm --filter @azure-edge/tools build && node dist/index.js <cmd>`
 * Commands: `validate` (gamedata + 1000 deterministic CharForge genomes +
 *           LOD metrics), `genome <seed>` (print one genome as JSON),
 *           `export <seed> <file.glb> [lod]` (CharForge GLB export, M2).
 */
const [cmd, arg, arg2, arg3] = process.argv.slice(2);

if (cmd === "validate") {
  console.log(`zone: ${ZONE.zone.id} (${ZONE.zone.name}), walk ${ZONE.player.walkSpeedMps} m/s`);
  let bad = 0;
  for (let seed = 0; seed < 1000; seed += 1) {
    if (!validateGenome(generateGenome(seed))) bad += 1;
  }
  console.log(`genomes: 1000 checked, ${bad} invalid`);
  const sample = generateGenome(123456);
  for (const lod of [0, 1, 2, 3] as const) {
    const b = buildCharacter(sample, lod);
    console.log(`LOD${lod}: ${b.drawCalls} draw calls, ${b.triangles} tris, ${b.heightM.toFixed(2)} m`);
  }
  process.exit(bad === 0 ? 0 : 1);
} else if (cmd === "genome") {
  const seed = Number(arg ?? 123456);
  console.log(JSON.stringify(generateGenome(seed), null, 2));
} else if (cmd === "export") {
  const seed = Number(arg ?? 123456);
  const out = arg2 ?? `charforge-${seed}.glb`;
  const lod = (Number(arg3 ?? 0) || 0) as 0 | 1 | 2 | 3;
  const genome = generateGenome(seed);
  if (!validateGenome(genome)) {
    console.error("invalid genome for seed", seed);
    process.exit(1);
  }
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
  const build = buildCharacter(genome, lod);
  const exporter = new GLTFExporter();
  const glb = (await exporter.parseAsync(build.group, { binary: true })) as ArrayBuffer;
  writeFileSync(out, Buffer.from(glb));
  console.log(`exported ${out}: LOD${lod}, ${build.drawCalls} draw calls, ${build.triangles} tris, ${glb.byteLength} bytes`);
} else {
  console.log("usage: validate | genome <seed> | export <seed> <file.glb> [lod]");
  process.exit(2);
}
