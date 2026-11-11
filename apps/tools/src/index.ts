import { generateGenome, validateGenome } from "@azure-edge/charforge";
import { ZONE } from "@azure-edge/gamedata";

/**
 * tools — M0 dev CLI. Usage: `pnpm --filter @azure-edge/tools build && node dist/index.js <cmd>`
 * Commands: `validate` (gamedata + 100 deterministic CharForge genomes),
 *           `genome <seed>` (print one genome as JSON).
 */
const [cmd, arg] = process.argv.slice(2);

if (cmd === "validate") {
  console.log(`zone: ${ZONE.zone.id} (${ZONE.zone.name}), walk ${ZONE.player.walkSpeedMps} m/s`);
  let bad = 0;
  for (let seed = 0; seed < 100; seed += 1) {
    if (!validateGenome(generateGenome(seed))) bad += 1;
  }
  console.log(`genomes: 100 checked, ${bad} invalid`);
  process.exit(bad === 0 ? 0 : 1);
} else if (cmd === "genome") {
  const seed = Number(arg ?? 123456);
  console.log(JSON.stringify(generateGenome(seed), null, 2));
} else {
  console.log("usage: validate | genome <seed>");
  process.exit(2);
}
