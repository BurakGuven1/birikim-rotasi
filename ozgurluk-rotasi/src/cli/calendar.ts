import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCalendar, pctSigned } from "../calendar.ts";
import { ROOT, loadEnv } from "../env.ts";
import { MONTHS_TR } from "../engine/seasonality.ts";
import { mdTable } from "../format.ts";

loadEnv();
const cal = await buildCalendar();
mkdirSync(join(ROOT, "out"), { recursive: true });
writeFileSync(join(ROOT, "out", "takvim.json"), JSON.stringify(cal));

const L: string[] = [`# Aylık Getiri Takvimi — ${cal.asOf}`, ""];
for (const f of cal.focus) L.push(`## ${f.label} için son ${cal.lookbackYears} yıl`, "", ...f.lines.map((l) => `- ${l}`), "");
if (cal.upcoming.length) {
  L.push(`## Yaklaşan olaylar`, "");
  for (const u of cal.upcoming) L.push(`**${u.title}** — ${u.date} (${u.daysLeft} gün)`, "", ...u.lines.map((l) => `- ${l}`), "");
}
for (const a of cal.assets) {
  L.push(`## ${a.name}`, "");
  L.push(mdTable(["Yıl", ...MONTHS_TR], a.years.map((y) => [String(y), ...MONTHS_TR.map((_, i) => {
    const c = a.cells[`${y}-${String(i + 1).padStart(2, "0")}`];
    return c ? pctSigned(c.ret) + (c.partial ? "*" : "") : "";
  })])));
  L.push(`| Yeşil | ${a.stats.map((s) => `${s.up}/${s.n}`).join(" | ")} |`, "");
  for (const i of a.insights.slice(0, 6)) L.push(`- ${i.text} _(kanıt: ${i.evidence})_`);
  L.push("");
}
L.push("\\* devam eden ay (istatistiklere dahil değil).");
writeFileSync(join(ROOT, "out", "TAKVIM.md"), L.join("\n"));
console.log(L.slice(0, 40).join("\n"));
console.log("\nYazıldı: out/takvim.json, out/TAKVIM.md");
