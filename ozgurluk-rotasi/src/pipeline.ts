import { ASSETS, ASSET_IDS, SWING, type AssetId, type SwingStrategyId } from "./config.ts";
import { loadAll, loadCpi, loadTbill, setForceRefresh } from "./data/load.ts";
import type { Bar } from "./data/types.ts";
import type { CoreData } from "./engine/core.ts";
import { forwardFill, monthRange, monthlyCloses, monthlyPoints } from "./engine/series.ts";
import { makeStrategy, monthlyReturnsFromEquity, simulate, type SwingResult } from "./engine/swing.ts";

export interface Universe {
  bars: Record<AssetId, Bar[]>;
  core: CoreData;
  /** Son TAM ay (içinde bulunulan ay hariç) */
  lastFullMonth: string;
}

export async function loadUniverse(opts: { refresh?: boolean } = {}): Promise<Universe> {
  setForceRefresh(!!opts.refresh);
  let bars: Record<AssetId, Bar[]>;
  let cpiPts, tbillBars;
  try {
    bars = await loadAll(ASSET_IDS);
    [cpiPts, tbillBars] = await Promise.all([loadCpi(), loadTbill()]);
  } finally {
    setForceRefresh(false);
  }
  const today = new Date().toISOString().slice(0, 7);
  const lastDates = ASSET_IDS.map((id) => bars[id][bars[id].length - 1].date.slice(0, 7));
  const lastData = lastDates.sort()[0];
  const lastFullMonth = lastData >= today ? prevMonth(today) : lastData;
  const months = monthRange("1993-01", lastFullMonth);
  const prices = {} as Record<AssetId, Map<string, number>>;
  const costBps = {} as Record<AssetId, number>;
  for (const id of ASSET_IDS) {
    prices[id] = monthlyCloses(bars[id]);
    costBps[id] = ASSETS[id].costBps;
  }
  return {
    bars,
    lastFullMonth,
    core: {
      months,
      prices,
      tbill: forwardFill(monthlyCloses(tbillBars), months),
      cpi: forwardFill(monthlyPoints(cpiPts), months),
      costBps,
    },
  };
}

export function prevMonth(m: string): string {
  let [y, mo] = m.split("-").map(Number);
  mo--;
  if (mo === 0) { mo = 12; y--; }
  return `${y}-${String(mo).padStart(2, "0")}`;
}

export interface SwingRun {
  strategy: SwingStrategyId;
  asset: AssetId;
  result: SwingResult;
}

export function runSwing(bars: Bar[], asset: AssetId, strategy: SwingStrategyId): SwingRun {
  const def = ASSETS[asset];
  const result = simulate(bars, makeStrategy(strategy, bars), {
    costBps: def.costBps,
    carryAnnual: def.carryAnnual,
    maxLeverage: SWING.maxLeverage,
  });
  return { strategy, asset, result };
}

/**
 * Önceden kayıtlı uydu kombinasyonlarının eşit ağırlıklı (aylık dengelenen) getirisi.
 * Perp teminatı işlem dışındayken nakitte (T-bill / USDT getiri) durur: aylık rf eklenir.
 */
export function sleeveReturns(runs: SwingRun[], tbillPct: Map<string, number>): Map<string, number> {
  const series = runs.map((r) => monthlyReturnsFromEquity(r.result.dates, r.result.equity));
  const months = new Set<string>();
  series.forEach((s) => s.forEach((_, m) => months.add(m)));
  const out = new Map<string, number>();
  for (const m of [...months].sort()) {
    const xs = series.map((s) => s.get(m)).filter((v): v is number => v !== undefined);
    const rf = (tbillPct.get(m) ?? 0) / 100 / 12;
    if (xs.length) out.set(m, xs.reduce((a, b) => a + b, 0) / xs.length + rf);
  }
  return out;
}
