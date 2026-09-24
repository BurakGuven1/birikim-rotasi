import { ASSET_IDS, ASSETS, CORE, PLAN, STRATEGIC_WEIGHTS, STRATEGIES, STRATEGY_KEYS, type AssetId, type StrategyKey } from "./config.ts";
import { trendScore } from "./engine/core.ts";
import type { Universe } from "./pipeline.ts";

export type Bucket = AssetId | "SWING" | "NAKIT";

export interface AssetSignal {
  id: AssetId;
  name: string;
  venue: string;
  /** 0 | 0.5 | 1 */
  score: number;
  monthClose: number;
  sma10: number;
  mom12: number;
  liveClose: number;
  liveDate: string;
}

export interface StrategyAllocation {
  key: StrategyKey;
  name: string;
  summary: string;
  how: string;
  forWhom: string;
  risk: string;
  /** Hedef ağırlıklar (toplam 1) */
  weights: Record<Bucket, number>;
  /** Spot pozisyonun perp short ile hedge edilecek oranı (satmak istemeyenler için) */
  hedge: Partial<Record<AssetId, number>>;
}

export interface AllocationPayload {
  generatedAt: string;
  /** Sinyalin dayandığı ay sonu */
  signalMonth: string;
  /** Sinyalin bir sonraki güncellenme tarihi (bir sonraki ay kapanışından sonraki gün) */
  nextUpdate: string;
  monthlyUsd: number;
  annualExtraUsd: number;
  annualMonth: number;
  assets: AssetSignal[];
  strategies: Record<StrategyKey, StrategyAllocation>;
  bucketNames: Record<Bucket, string>;
  bucketVenues: Record<Bucket, string>;
}

export const BUCKET_NAMES: Record<Bucket, string> = {
  ...Object.fromEntries(ASSET_IDS.map((id) => [id, ASSETS[id].name])),
  SWING: "Swing kasası",
  NAKIT: "Nakit (fırsat kasası)",
} as Record<Bucket, string>;

export const BUCKET_VENUES: Record<Bucket, string> = {
  ...Object.fromEntries(ASSET_IDS.map((id) => [id, ASSETS[id].coreVenue])),
  SWING: "OKX Trading hesabı, USDT (yalnız sinyalde işlem)",
  NAKIT: "USDT Earn / T-bill ETF / TL para piyasası fonu",
} as Record<Bucket, string>;

/** Bir stratejinin trend skorlarına göre hedef ağırlıkları. */
export function strategyWeights(key: StrategyKey, scores: Record<AssetId, number>): { weights: Record<Bucket, number>; hedge: Partial<Record<AssetId, number>> } {
  const def = STRATEGIES[key];
  const sum = ASSET_IDS.reduce((a, id) => a + STRATEGIC_WEIGHTS[id], 0);
  const weights = {} as Record<Bucket, number>;
  const hedge: Partial<Record<AssetId, number>> = {};
  for (const id of ASSET_IDS) {
    const full = (STRATEGIC_WEIGHTS[id] / sum) * (1 - def.sleeve);
    const score = def.rule === "none" ? 1 : scores[id];
    const w = full * (def.trendFloor + (1 - def.trendFloor) * score);
    weights[id] = w;
    if (w < full - 1e-9) hedge[id] = 1 - w / full;
  }
  weights.SWING = def.sleeve;
  weights.NAKIT = Math.max(0, 1 - ASSET_IDS.reduce((a, id) => a + weights[id], 0) - def.sleeve);
  return { weights, hedge };
}

function nextMonthStart(ym: string, plus: number): string {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + plus;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`;
}

export function currentAllocation(u: Universe): AllocationPayload {
  const months = u.core.months;
  const i = months.length - 1;
  const tb = months.map((m) => u.core.tbill.get(m));
  const scores = {} as Record<AssetId, number>;
  const assets: AssetSignal[] = ASSET_IDS.map((id) => {
    const closes = months.map((m) => u.core.prices[id].get(m));
    const score = trendScore(closes, i, CORE.rule, tb, CORE.smaMonths, CORE.momentumMonths);
    scores[id] = score;
    const win = closes.slice(i - CORE.smaMonths + 1, i + 1) as number[];
    const bars = u.bars[id];
    return {
      id,
      name: ASSETS[id].name,
      venue: ASSETS[id].venue,
      score,
      monthClose: closes[i] as number,
      sma10: win.reduce((a, b) => a + b, 0) / win.length,
      mom12: (closes[i] as number) / (closes[i - CORE.momentumMonths] as number) - 1,
      liveClose: bars[bars.length - 1].close,
      liveDate: bars[bars.length - 1].date,
    };
  });
  const strategies = {} as Record<StrategyKey, StrategyAllocation>;
  for (const key of STRATEGY_KEYS) {
    const d = STRATEGIES[key];
    strategies[key] = { key, name: d.name, summary: d.summary, how: d.how, forWhom: d.forWhom, risk: d.risk, ...strategyWeights(key, scores) };
  }
  return {
    generatedAt: new Date().toISOString(),
    signalMonth: u.lastFullMonth,
    // Ay sonu verisi ertesi ayın ilk gününden sonra kesinleşir
    nextUpdate: nextMonthStart(u.lastFullMonth, 2),
    monthlyUsd: PLAN.monthlyUsd,
    annualExtraUsd: PLAN.annualExtraUsd,
    annualMonth: PLAN.annualMonth,
    assets,
    strategies,
    bucketNames: BUCKET_NAMES,
    bucketVenues: BUCKET_VENUES,
  };
}

/**
 * Katkıyı kalemlere böler. Mevcut pozisyon verilirse önce hedefin en çok altında kalan
 * kalemlere yönlendirir (satış gerektirmeyen dengeleme). Tam dolara yuvarlar; toplam korunur.
 */
export function splitContribution(weights: Record<string, number>, amount: number, holdings?: Record<string, number>): Record<string, number> {
  const keys = Object.keys(weights);
  let raw: Record<string, number>;
  const held = holdings ? keys.reduce((a, k) => a + (holdings[k] ?? 0), 0) : 0;
  if (holdings && held > 0) {
    const total = held + amount;
    const deficit = Object.fromEntries(keys.map((k) => [k, Math.max(0, weights[k] * total - (holdings[k] ?? 0))]));
    const dsum = Object.values(deficit).reduce((a, b) => a + b, 0);
    raw = Object.fromEntries(keys.map((k) => [k, dsum > 0 ? (deficit[k] / dsum) * Math.min(amount, dsum) + (dsum < amount ? weights[k] * (amount - dsum) : 0) : weights[k] * amount]));
  } else {
    raw = Object.fromEntries(keys.map((k) => [k, weights[k] * amount]));
  }
  // En büyük kalan yöntemiyle tam dolara yuvarla
  const floor = Object.fromEntries(keys.map((k) => [k, Math.floor(raw[k])]));
  let rest = Math.round(amount) - Object.values(floor).reduce((a, b) => a + b, 0);
  for (const k of [...keys].sort((a, b) => (raw[b] - floor[b]) - (raw[a] - floor[a]))) {
    if (rest <= 0) break;
    if (raw[k] > 0) { floor[k]++; rest--; }
  }
  return floor;
}
