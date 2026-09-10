/**
 * Cross-sectional momentum: rank the universe daily, hold the strongest against the weakest.
 *
 * This is the only model in this repository that survived an out-of-sample walk-forward test.
 * It is deliberately a portfolio rule, not a per-coin entry rule: the return comes from relative
 * strength between contracts, which is a different source from price structure inside one contract.
 *
 * Everything here is pure so it can be tested without touching the network.
 */
export interface DailySeries { id: string; closes: Map<number, number>; funding?: Map<number, number> }
export interface PortfolioSettings { lookbackDays: number; positions: number; costRate: number; includeFunding: boolean }
export interface DailyResult { time: number; ret: number; turnover: number; longs: string[]; shorts: string[] }

export const DAY = 86_400_000;

/** Days present in every series, so a rebalance never silently drops a contract. */
export function commonDays(series: DailySeries[]): number[] {
  if (!series.length) return [];
  const [first, ...rest] = series;
  return [...first.closes.keys()].filter(day => rest.every(s => s.closes.has(day))).sort((a, b) => a - b);
}

export function runPortfolio(series: DailySeries[], settings: PortfolioSettings): DailyResult[] {
  const { lookbackDays, positions, costRate, includeFunding } = settings;
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || !Number.isInteger(positions) || positions < 1) return [];
  const days = commonDays(series);
  const out: DailyResult[] = [];
  let held = new Map<string, number>();
  for (let i = lookbackDays; i < days.length - 1; i++) {
    const scored = series.map(s => ({ s, score: s.closes.get(days[i])! / s.closes.get(days[i - lookbackDays])! - 1 }))
      .filter(x => Number.isFinite(x.score))
      .sort((a, b) => b.score - a.score);
    if (scored.length < positions * 2) continue;
    const longs = scored.slice(0, positions), shorts = scored.slice(-positions);
    const target = new Map<string, number>();
    for (const { s } of longs) target.set(s.id, .5 / positions);
    for (const { s } of shorts) target.set(s.id, -.5 / positions);
    let turnover = 0;
    for (const id of new Set([...held.keys(), ...target.keys()])) turnover += Math.abs((target.get(id) ?? 0) - (held.get(id) ?? 0));
    let gross = 0, fundingCost = 0;
    for (const { s } of [...longs, ...shorts]) {
      const weight = target.get(s.id)!;
      gross += weight * (s.closes.get(days[i + 1])! / s.closes.get(days[i])! - 1);
      // A long pays a positive settled rate; a short receives it.
      fundingCost += weight * (s.funding?.get(days[i + 1]) ?? 0);
    }
    out.push({ time: days[i + 1], ret: gross - turnover * costRate - (includeFunding ? fundingCost : 0), turnover,
      longs: longs.map(x => x.s.id), shorts: shorts.map(x => x.s.id) });
    held = target;
  }
  return out;
}

export interface PortfolioMetrics { days: number; returnPercent: number; sharpe: number; maxDrawdownPercent: number; averageTurnoverPercent: number }

export function scorePortfolio(results: DailyResult[]): PortfolioMetrics | null {
  if (!results.length) return null;
  let equity = 1, peak = 1, drawdown = 0;
  for (const r of results) { equity *= 1 + r.ret; peak = Math.max(peak, equity); drawdown = Math.max(drawdown, 1 - equity / peak); }
  const mean = results.reduce((a, b) => a + b.ret, 0) / results.length;
  const variance = results.reduce((a, b) => a + (b.ret - mean) ** 2, 0) / results.length;
  return { days: results.length, returnPercent: (equity - 1) * 100,
    sharpe: variance > 0 ? mean / Math.sqrt(variance) * Math.sqrt(365) : 0,
    maxDrawdownPercent: drawdown * 100,
    averageTurnoverPercent: results.reduce((a, b) => a + b.turnover, 0) / results.length * 100 };
}

/**
 * Walk-forward: each block's parameters come only from the blocks before it. This is the only
 * number that describes what an operator could have earned without knowing the future.
 */
export function walkForward(series: DailySeries[], candidates: { lookbackDays: number; positions: number }[],
    base: Pick<PortfolioSettings, 'costRate' | 'includeFunding'>, trainDays = 180, stepDays = 30) {
  const runs = candidates.map(c => ({ ...c, results: runPortfolio(series, { ...base, ...c }) }));
  const length = Math.min(...runs.map(r => r.results.length));
  const live: DailyResult[] = [];
  const picks: { from: number; lookbackDays: number; positions: number }[] = [];
  for (let start = trainDays; start + stepDays <= length; start += stepDays) {
    let best = runs[0], bestEquity = -Infinity;
    for (const run of runs) {
      let equity = 1;
      for (const r of run.results.slice(start - trainDays, start)) equity *= 1 + r.ret;
      if (equity > bestEquity) { bestEquity = equity; best = run; }
    }
    const block = best.results.slice(start, start + stepDays);
    picks.push({ from: block[0]?.time ?? 0, lookbackDays: best.lookbackDays, positions: best.positions });
    live.push(...block);
  }
  return { metrics: scorePortfolio(live), picks, days: live.length };
}
