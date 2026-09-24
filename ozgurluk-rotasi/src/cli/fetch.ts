import { ASSET_IDS, ASSETS } from "../config.ts";
import { loadEnv } from "../env.ts";
import { loadUniverse } from "../pipeline.ts";

loadEnv();
const u = await loadUniverse();
console.log("Veri kapsamı (önbellek: data/cache, 12 saat):");
for (const id of ASSET_IDS) {
  const b = u.bars[id];
  console.log(`  ${ASSETS[id].name.padEnd(28)} ${b[0].date} → ${b[b.length - 1].date}  (${b.length} gün)`);
}
const cpiMonths = [...u.core.cpi.keys()];
console.log(`  ABD TÜFE (FRED)               ${cpiMonths[0]} → ${cpiMonths[cpiMonths.length - 1]}`);
console.log(`Son tam ay: ${u.lastFullMonth}`);
