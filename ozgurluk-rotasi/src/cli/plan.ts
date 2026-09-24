import { parseArgs } from "node:util";
import { PLAN } from "../config.ts";
import { requiredReturn, yearsToTarget } from "../engine/goal.ts";
import { futureValue } from "../engine/montecarlo.ts";
import { mdTable, num, pct, usd } from "../format.ts";

const { values } = parseArgs({
  options: {
    aylik: { type: "string", default: String(PLAN.monthlyUsd) },
    yillik: { type: "string", default: String(PLAN.annualExtraUsd) },
    harcama: { type: "string", default: String(PLAN.monthlySpendingReal) },
    swr: { type: "string", default: String(PLAN.safeWithdrawalRate) },
    mevcut: { type: "string", default: "0" },
  },
});
const monthly = Number(values.aylik);
const annual = Number(values.yillik);
const spending = Number(values.harcama);
const swr = Number(values.swr);
const current = Number(values.mevcut);
const target = (spending * 12) / swr;
const horizons = [10, 15, 20, 25];
const grow = (r: number, y: number) => current * (1 + r) ** y + futureValue(r, y, monthly, annual);

console.log(`# Finansal Özgürlük Planı (bugünün doları, reel)\n`);
console.log(`Katkı: ${usd(monthly)}/ay + ${usd(annual)}/yıl (= ${usd(monthly * 12 + annual)}/yıl, enflasyonla artırılarak) · Mevcut: ${usd(current)}`);
console.log(`Hedef: ${usd(spending)}/ay harcama ÷ %${num(swr * 100, 1)} güvenli çekim = **${usd(target)}**\n`);
console.log(mdTable(["Reel getiri", ...horizons.map((h) => `${h} yıl`), "Hedefe süre"], [0.04, 0.07, 0.1, 0.12, 0.15, 0.2].map((r) => [pct(r, 0), ...horizons.map((h) => usd(grow(r, h))), `${num(yearsToTarget(Math.max(target - current, 0), r, monthly, annual), 1)} yıl`])));
console.log(`\n## Hedef için gereken sabit reel getiri\n`);
console.log(mdTable(["Ufuk", "Gereken reel getiri", "Toplam katkı"], horizons.map((h) => [`${h} yıl`, pct(requiredReturn(Math.max(target - current, 0), h, monthly, annual)), usd((monthly * 12 + annual) * h)])));
console.log(`\nBağlam: ABD hisseleri 1900–2024 reel ~%6.5/yıl; S&P 500 al-tut son 20 yılda reel ~%8.4 (bkz. out/RAPOR.md).`);
console.log(`Reel %15'i 20 yıl sürdürmek dünyanın en iyi yatırımcılarının seviyesidir; planı %10–12 ile kurup %15'i hedef/üst senaryo olarak tutmak daha sağlıklıdır.`);
