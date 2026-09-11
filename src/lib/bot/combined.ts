import { inspectMpaV2 } from './mpa-v2';
import { supertrend } from './supertrend';
import { duration, type Context, type Interval, type Signal, type Strategy } from './types';

/**
 * MPA entries taken only in the direction the SuperTrend regime already points.
 *
 * The two models fail in different ways on their own: MPA finds structure but no directional edge,
 * SuperTrend has direction but enters late and rarely. Pairing them is the one combination with a
 * reason behind it — trend supplies the side, structure supplies the level — rather than an
 * arbitrary blend. It is a filter, so it can only reduce MPA's trades, never invent new ones.
 */
/** The SuperTrend side at the last closed bar, or null when there is not enough history for it. */
export function trendRegime(context: Context, interval: Interval): 1 | -1 | null {
  const bars = context.frames[interval].filter(b => b.time + duration[interval] <= context.now).slice(-260);
  return supertrend(bars).at(-1)?.trend ?? null;
}

export function inspectTrendFilteredMpa(context: Context, interval: Interval): { signal: Signal | null; reason: string } {
  const base = inspectMpaV2(context, interval);
  if (!base.signal) return base;
  const regime = trendRegime(context, interval);
  if (regime === null) return { signal: null, reason: 'Trend rejimi hesaplanamadı.' };
  const wanted = base.signal.direction === 'long' ? 1 : -1;
  if (regime !== wanted) return { signal: null, reason: `Yapı sinyali ${base.signal.direction}, SuperTrend rejimi ters.` };
  return { signal: { ...base.signal, model: `${base.signal.model}+trend`,
    setupId: base.signal.setupId && `${base.signal.setupId}:trend`,
    confirmations: { ...base.signal.confirmations, '4H': `${base.signal.confirmations['4H']} SuperTrend rejimi aynı yönde.` } },
    reason: `${base.reason} Trend rejimi teyit etti.` };
}

export function createTrendFilteredMpaStrategy(interval: Interval): Strategy {
  return { id: `MPA+Trend ${interval}`, version: 'mt-1.0.0', entryInterval: interval, requireBias: false,
    warmup: { '15m': interval === '15m' ? 100 : 40, '1H': interval === '1H' ? 100 : 40, '4H': interval === '4H' ? 100 : 40 },
    evaluate: context => inspectTrendFilteredMpa(context, interval).signal };
}
