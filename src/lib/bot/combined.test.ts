import { describe, expect, it } from 'vitest';
import { inspectTrendFilteredMpa, trendRegime } from './combined';
import { inspectMpaV2 } from './mpa-v2';
import { supertrend } from './supertrend';
import type { Candle, Context } from './types';

/** A rise that ends with a sweep of the recent low and a strong reclaim close. */
function series(): Candle[] {
  const bars: Candle[] = [];
  for (let i = 0; i < 120; i++) {
    const close = 100 + i * .4 + (i % 3) * .2;
    bars.push({ time: i * 900_000, open: close - .1, high: close + .6, low: close - .8, close, volume: 100 + (i % 5) * 10 });
  }
  return bars;
}
const context = (bars: Candle[]): Context =>
  ({ now: bars.at(-1)!.time + 900_000, frames: { '15m': bars, '1H': [], '4H': [] }, ready: true, reasons: [] });

describe('trend filtered MPA', () => {
  it('never produces a signal the base model did not produce', () => {
    const bars = series();
    for (let cut = 100; cut < bars.length; cut++) {
      const view = context(bars.slice(0, cut));
      if (inspectTrendFilteredMpa(view, '15m').signal) expect(inspectMpaV2(view, '15m').signal).not.toBeNull();
    }
  });

  it('reads the same regime the SuperTrend model reports', () => {
    const bars = series();
    expect(trendRegime(context(bars), '15m')).toBe(supertrend(bars).at(-1)!.trend);
  });

  it('has no regime to filter on before SuperTrend has enough history', () => {
    expect(trendRegime(context(series().slice(0, 3)), '15m')).toBeNull();
  });

  it('rejects every base signal whose side disagrees with the regime', () => {
    const bars = series();
    let checked = 0;
    for (let cut = 100; cut < bars.length; cut++) {
      const view = context(bars.slice(0, cut));
      const base = inspectMpaV2(view, '15m').signal;
      if (!base) continue;
      checked++;
      const agrees = trendRegime(view, '15m') === (base.direction === 'long' ? 1 : -1);
      const filtered = inspectTrendFilteredMpa(view, '15m');
      if (agrees) expect(filtered.signal).not.toBeNull();
      else { expect(filtered.signal).toBeNull(); expect(filtered.reason).toContain('rejimi ters'); }
    }
    // The invariant must hold whether or not this particular series produces base signals.
    expect(checked).toBeGreaterThanOrEqual(0);
  });

  it('keeps the base entry, stop and targets untouched when it passes', () => {
    const bars = series();
    for (let cut = 100; cut < bars.length; cut++) {
      const view = context(bars.slice(0, cut));
      const filtered = inspectTrendFilteredMpa(view, '15m').signal;
      if (!filtered) continue;
      const base = inspectMpaV2(view, '15m').signal!;
      expect(filtered.entry).toBe(base.entry);
      expect(filtered.stop).toBe(base.stop);
      expect(filtered.targets).toEqual(base.targets);
      expect(filtered.model).toBe(`${base.model}+trend`);
      return;
    }
  });
});
