import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, loadEnv } from "../env.ts";
import { loadUniverse } from "../pipeline.ts";
import { buildBacktest } from "../report/backtest.ts";

loadEnv();
const OUT = join(ROOT, "out");
mkdirSync(OUT, { recursive: true });
const u = await loadUniverse();
console.log(`Veri hazır. Son tam ay: ${u.lastFullMonth}`);
const { json, markdown } = buildBacktest(u);
writeFileSync(join(OUT, "backtest.json"), JSON.stringify(json));
writeFileSync(join(OUT, "RAPOR.md"), markdown);
console.log(markdown);
console.log(`\nYazıldı: out/backtest.json, out/RAPOR.md`);
