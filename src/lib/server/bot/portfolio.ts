import { randomUUID } from 'node:crypto';
import { getUniverse, getHistoricalCandles } from '../okx/market';
import { OkxClient } from '../okx/client';
import { runPortfolio, scorePortfolio, walkForward, DAY, type DailySeries } from '../../bot/cross-sectional';
import type { BotPortfolio } from '../../bot/dashboard-types';
import type { BotStore } from './store';

const CANDIDATES = [7, 14, 30, 60, 90].flatMap(lookbackDays => [3, 5, 8].map(positions => ({ lookbackDays, positions })));

/**
 * Runs the cross-sectional model over the most liquid contracts. Only daily closes and funding are
 * needed, so this completes in about a minute rather than the hours an intraday study would take.
 */
export async function runPortfolioStudy(store: BotStore, owner: string, coins: number, days: number): Promise<BotPortfolio> {
  const client = new OkxClient({ mode: 'public' });
  const settings = store.getSettings();
  const costRate = (settings.feeBps + settings.slippageBps) / 10_000;
  const progress = (message: string, current: number, total: number, state: 'running' | 'done' | 'failed' = 'running') =>
    store.saveProgress(owner, { kind: 'portfolio', state, message, current, total });

  progress('Evren belirleniyor…', 0, coins);
  const universe = (await getUniverse(client)).filter(i => (i.volumeUsdt ?? 0) > 0)
    .sort((a, b) => (b.volumeUsdt ?? 0) - (a.volumeUsdt ?? 0)).slice(0, coins);
  const to = Math.floor(Date.now() / DAY) * DAY - DAY, from = to - (days + 90) * DAY;
  const series: DailySeries[] = [];
  const skipped: string[] = [];
  let done = 0;
  for (const instrument of universe) {
    progress(`${instrument.base}: günlük geçmiş ve funding`, done, universe.length);
    try {
      const candles = await getHistoricalCandles(client, instrument.id, '1Dutc', { from, to, maxPages: 20 });
      if (candles.length < days) { skipped.push(instrument.base); done++; continue; }
      const funding = new Map<number, number>();
      let cursor = to + DAY;
      for (let page = 0; page < 12; page++) {
        const rows = await client.get<Record<string, unknown>>(`/api/v5/public/funding-rate-history?instId=${instrument.id}&limit=400&after=${cursor}`);
        if (!rows.length) break;
        let oldest = cursor;
        for (const row of rows) {
          const time = Number(row.fundingTime), rate = Number(row.realizedRate ?? row.fundingRate);
          if (!Number.isFinite(time) || !Number.isFinite(rate)) continue;
          funding.set(Math.floor(time / DAY) * DAY, (funding.get(Math.floor(time / DAY) * DAY) ?? 0) + rate);
          oldest = Math.min(oldest, time);
        }
        if (oldest <= from || oldest >= cursor) break;
        cursor = oldest;
      }
      series.push({ id: instrument.id, closes: new Map(candles.map(c => [c.time, c.close])), funding });
    } catch { skipped.push(instrument.base); }
    done++;
  }
  progress('Yürüyen doğrulama hesaplanıyor…', universe.length, universe.length);
  const base = { costRate, includeFunding: true };
  const forward = walkForward(series, CANDIDATES, base);
  const grid = CANDIDATES.map(candidate => {
    const metrics = scorePortfolio(runPortfolio(series, { ...base, ...candidate }));
    return { ...candidate, metrics };
  }).filter((row): row is typeof row & { metrics: NonNullable<typeof row.metrics> } => row.metrics !== null);
  // The same rule scored on a slightly different universe can swing from loss to large gain, so the
  // study reports that spread instead of a single flattering number an operator might trust.
  const sensitivity = [20, 30, 40, series.length].filter((size, index, sizes) => size >= 16 && size <= series.length && sizes.indexOf(size) === index)
    .map(size => ({ universe: size, metrics: walkForward(series.slice(0, size), CANDIDATES, base).metrics }))
    .filter((row): row is typeof row & { metrics: NonNullable<typeof row.metrics> } => row.metrics !== null);
  const latest = forward.picks.at(-1) ?? null;
  const result: BotPortfolio = {
    id: randomUUID(), createdAt: Date.now(), from, to, coins: series.map(s => s.id), skipped,
    costRate, walkForward: forward.metrics, picks: forward.picks, grid, sensitivity,
    // The live allocation uses the parameters the walk-forward last chose from past data only.
    current: latest && series.length ? runPortfolio(series, { ...base, lookbackDays: latest.lookbackDays, positions: latest.positions }).at(-1) ?? null : null,
  };
  store.savePortfolio(owner, result);
  progress(forward.metrics ? `Dış-örnek ${forward.metrics.days} gün · %${forward.metrics.returnPercent.toFixed(1)}` : 'Yeterli ortak gün bulunamadı.',
    universe.length, universe.length, forward.metrics ? 'done' : 'failed');
  return result;
}
