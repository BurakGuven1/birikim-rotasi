import { percentileRank } from "./indicators";
import type { AssetClass, PricePoint } from "./types";

export const OPPORTUNITY_VERSION = "opportunity-v2";
export const OPPORTUNITY_CAPS: Record<AssetClass, number> = { bitcoin: .4, foreignEquity: .65, commodity: .3, turkishEquity: .15 };
export interface OpportunityAssessment {
  state: "cheap" | "neutral" | "expensive" | "insufficient";
  percentile: number | null; weeklySma200: number | null; distance: number | null; drawdown: number | null;
  stage: 0 | 1 | 2 | 3; score: number; support: number | null; reclaim: number | null; observations: number; reasons: string[];
}

export function completedWeeklyBars(prices: PricePoint[], now: Date): PricePoint[] {
  const weeks = new Map<number, PricePoint>();
  for (const p of [...prices].sort((a,b) => a.date.localeCompare(b.date))) {
    if (!Number.isFinite(p.close) || p.close <= 0 || !Number.isFinite(Date.parse(p.date)) || Date.parse(p.date) >= now.getTime()) continue;
    const date = new Date(p.date); date.setUTCHours(0,0,0,0);
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    const week = date.getTime(), end = week + 7 * 86400000;
    if (end > now.getTime()) continue;
    const previous = weeks.get(week);
    weeks.set(week, { date: new Date(end - 1).toISOString(), open: previous?.open ?? p.open ?? p.close, close: p.close, high: Math.max(previous?.high ?? -Infinity, p.high ?? p.close), low: Math.min(previous?.low ?? Infinity, p.low ?? p.close), volume: (previous?.volume ?? 0) + (p.volume ?? 0) });
  }
  return [...weeks.values()];
}

export function assessOpportunity(history: PricePoint[], now: Date): OpportunityAssessment {
  const empty: OpportunityAssessment = { state: "insufficient", percentile: null, weeklySma200: null, distance: null, drawdown: null, stage: 0, score: 0, support: null, reclaim: null, observations: 0, reasons: [] };
  const points = [...new Map(history.filter(p => Number.isFinite(p.close) && p.close > 0 && Date.parse(p.date) < now.getTime()).map(p => [p.date.slice(0,10),p])).values()].sort((a,b) => a.date.localeCompare(b.date));
  const weeks = completedWeeklyBars(points, now);
  if (weeks.length < 251) return { ...empty, reasons: [`200 haftalık ortalama ve en az 52 tarihsel uzaklık gözlemi gerekli; ${weeks.length} tamamlanmış hafta var.`] };
  const distances: number[] = [];
  let sum = 0;
  for (let i = 0; i < weeks.length; i++) {
    sum += weeks[i].close;
    if (i >= 200) sum -= weeks[i-200].close;
    if (i >= 199) distances.push(weeks[i].close / (sum / 200) - 1);
  }
  const weeklySma200 = sum / 200, price = points.at(-1)!.close;
  const distance = price / weeklySma200 - 1;
  const sample = distances.slice(-260);
  const percentile = percentileRank(sample, distance);
  const state = percentile <= .35 ? "cheap" : percentile >= .65 ? "expensive" : "neutral";
  const drawdown = price / Math.max(...points.map(p => p.high ?? p.close)) - 1;
  const recent = points.slice(-90), last = recent.at(-1)!, prev = recent.at(-2)!;
  const lows: { price: number; index: number }[] = [], highs: { price: number; index: number }[] = [];
  // Pivots become known only after the two right-hand bars close.
  for (let i = 2; i < recent.length - 2; i++) {
    const neighbours = [recent[i-2],recent[i-1],recent[i+1],recent[i+2]];
    if (neighbours.every(p => (p.low ?? p.close) > (recent[i].low ?? recent[i].close))) lows.push({ price: recent[i].low ?? recent[i].close, index: i });
    if (neighbours.every(p => (p.high ?? p.close) < (recent[i].high ?? recent[i].close))) highs.push({ price: recent[i].high ?? recent[i].close, index: i });
  }
  const support = lows.at(-1)?.price ?? null;
  const reclaim = highs.at(-1)?.price ?? null;
  const ranges = recent.slice(-14).map((p,i) => { const previous = recent[recent.length-15+i]?.close ?? p.close; return Math.max((p.high ?? p.close)-(p.low ?? p.close), Math.abs((p.high ?? p.close)-previous),Math.abs((p.low ?? p.close)-previous)); });
  const atr = ranges.reduce((a,b)=>a+b,0)/ranges.length;
  const hasOhlc = recent.slice(-15).every(p => p.open != null && p.high != null && p.low != null);
  let stage: 0 | 1 | 2 | 3 = 0;
  if (state === "cheap" && hasOhlc && support && atr > 0) {
    if (last.low! <= support + atr * .5 && last.close > support && last.close > prev.close) stage = 1;
    if (reclaim && prev.close <= reclaim && last.close > reclaim) stage = 2;
    if (reclaim && prev.close > reclaim && last.low! <= reclaim + atr * .25 && last.close > reclaim && last.close > last.open!) stage = 3;
  }
  return { state, percentile, weeklySma200, distance, drawdown, stage, score: state === "cheap" ? 1 - percentile : 0, support, reclaim, observations: sample.length, reasons: [
    `Uzun ortalamaya uzaklık %${(distance*100).toFixed(1)}; tarihsel dilim %${(percentile*100).toFixed(0)} (${sample.length} hafta).`,
    `Mevcut tarihçenin zirvesinden %${(drawdown*100).toFixed(1)}. Bu, temel değer veya dip garantisi değildir.`,
    !hasOhlc ? "OHLC verisi eksik; yapısal giriş üretilemez." : stage ? `Kademe ${stage}/3: ${stage === 1 ? "destek tepkisi" : stage === 2 ? "seviye geri kazanımı" : "başarılı yeniden test"}.` : "Yeni destek tepkisi / geri kazanım / yeniden test onayı yok; rezervde bekle.",
  ] };
}

export function allocateOpportunities(input: { budgetUsd: number; reserveUsd: number; portfolioUsd: number; feeBps: number; minOrderUsd: number; candidates: { key: AssetClass; score: number; stage: number; currentUsd: number; cap: number; grossExtraUsd?: number }[] }) {
  if ([input.budgetUsd,input.reserveUsd,input.portfolioUsd,input.feeBps,input.minOrderUsd].some(v => !Number.isFinite(v) || v < 0)) throw new Error("Geçersiz fırsat bütçesi.");
  const totalCents = Math.round((input.budgetUsd + input.reserveUsd)*100);
  let remaining = totalCents, feeCents = 0;
  const amounts: Partial<Record<AssetClass,number>> = {};
  const candidates = [...input.candidates].filter(c => c.stage > 0 && c.score > 0).sort((a,b) => b.score - a.score || a.currentUsd-b.currentUsd || a.key.localeCompare(b.key));
  const equity = input.portfolioUsd + input.budgetUsd;
  const feeRate = input.feeBps / 10000;
  // Reserve the entire batch's maximum fees before sizing any asset.
  let maxFeeCents = Math.ceil(totalCents * feeRate / (1 + feeRate)) + (feeRate > 0 ? candidates.length : 0);
  for (const c of input.candidates) {
    const cap = Math.min(c.cap, OPPORTUNITY_CAPS[c.key]);
    if (cap > 0) maxFeeCents = Math.min(maxFeeCents, Math.max(0, Math.floor((equity - (c.currentUsd + (c.grossExtraUsd ?? 0)) / cap) * 100)));
  }
  for (const c of candidates) {
    const capValue = Math.max(0, equity - maxFeeCents / 100) * Math.min(c.cap, OPPORTUNITY_CAPS[c.key]);
    const capacity = Math.max(0, capValue - c.currentUsd - (c.grossExtraUsd ?? 0));
    const tranche = Math.min(capacity, capValue / 3);
    let cents = Math.floor(Math.min(tranche*100, remaining / (1 + input.feeBps/10000)));
    if (feeRate > 0) cents = Math.min(cents, Math.floor((maxFeeCents - feeCents) / feeRate));
    let fee = Math.ceil(cents*input.feeBps/10000);
    while (cents + fee > remaining && cents > 0) { cents--; fee = Math.ceil(cents*input.feeBps/10000); }
    if (cents < input.minOrderUsd*100) continue;
    amounts[c.key] = cents/100; remaining -= cents+fee; feeCents += fee;
  }
  return { amounts, investedUsd: (totalCents-remaining-feeCents)/100, costUsd: feeCents/100, remainingUsd: remaining/100, totalUsd: totalCents/100 };
}
