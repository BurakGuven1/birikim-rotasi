import { describe, expect, it } from 'vitest';
import { alignHigher, atr, ema, highest, linreg, lowest, percentRank, rma, rsi, sma, stdev } from './eth-indicators';
import type { Candle } from './types';

const bar = (time: number, high: number, low: number, close: number, open = close): Candle => ({ time, open, high, low, close, volume: 1 });

describe('pine indicator port', () => {
  it('leaves a moving average undefined until its window is full', () => {
    const out = sma([1, 2, 3, 4], 2);
    expect(out[0]).toBeNaN();
    expect(out.slice(1)).toEqual([1.5, 2.5, 3.5]);
  });

  it('recovers once a leading gap slides out of the window, instead of staying poisoned', () => {
    // The daily volatility regime is sma(atr(14), 100): its input is undefined for the first 13
    // bars. A running sum that adds those straight in returns NaN forever and silently blocks
    // every entry the strategy would have taken.
    const withGap = [NaN, NaN, 3, 4, 5];
    expect(sma(withGap, 3)[3]).toBeNaN();
    expect(sma(withGap, 3)[4]).toBeCloseTo(4, 12);
    expect(ema(withGap, 3)[4]).toBeCloseTo(4, 12);
    expect(rma(withGap, 3)[4]).toBeCloseTo(4, 12);
  });

  it('seeds the ema with a simple average, the way Pine does', () => {
    // A port that seeds from the first value instead reports 1.9375 here and drifts for hundreds
    // of bars; the seeded series is exactly 2.5 at the first defined bar.
    const out = ema([1, 2, 3, 4], 4);
    expect(out.slice(0, 3).every(Number.isNaN)).toBe(true);
    expect(out[3]).toBeCloseTo(2.5, 12);
    const next = ema([1, 2, 3, 4, 5], 4);
    expect(next[4]).toBeCloseTo(5 * .4 + 2.5 * .6, 12);
  });

  it('smooths with Wilder’s rule after the same simple-average seed', () => {
    const out = rma([1, 2, 3, 4, 5], 4);
    expect(out[3]).toBeCloseTo(2.5, 12);
    expect(out[4]).toBeCloseTo((2.5 * 3 + 5) / 4, 12);
  });

  it('uses the population standard deviation, not the sample one', () => {
    // Mean 5, squared deviations sum to 32 over 8 values: population 2, sample would be ~2.138.
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9], 8)[7]).toBeCloseTo(2, 12);
  });

  it('measures true range against the previous close', () => {
    const bars = [bar(0, 10, 9, 10), bar(1, 12, 11, 12)];
    // The gap from the first close to the second low is wider than the second bar's own range.
    expect(atr(bars, 2)[1]).toBeCloseTo((1 + 2) / 2, 12);
  });

  it('returns 100 for an unbroken advance and 0 for an unbroken decline', () => {
    expect(rsi([1, 2, 3, 4, 5, 6], 3).at(-1)).toBeCloseTo(100, 9);
    expect(rsi([6, 5, 4, 3, 2, 1], 3).at(-1)).toBeCloseTo(0, 9);
  });

  it('fits a straight line exactly and extrapolates the last point', () => {
    expect(linreg([1, 2, 3, 4, 5], 5, 0)[4]).toBeCloseTo(5, 12);
    // With offset 1 the fitted value one bar back is returned.
    expect(linreg([1, 2, 3, 4, 5], 5, 1)[4]).toBeCloseTo(4, 12);
  });

  it('ranks the current value against the window that precedes it', () => {
    expect(percentRank([1, 2, 3, 4, 5], 4)[4]).toBeCloseTo(100, 12);
    expect(percentRank([5, 4, 3, 2, 1], 4)[4]).toBeCloseTo(0, 12);
    expect(percentRank([1, 2, 9, 3, 4], 4)[4]).toBeCloseTo(75, 12);
  });

  it('reads the extremes of the trailing window', () => {
    expect(highest([3, 1, 4, 1, 5], 3)[4]).toBe(5);
    expect(lowest([3, 1, 4, 1, 5], 3)[4]).toBe(1);
  });
});

describe('higher timeframe alignment', () => {
  const hour = 3_600_000, quarter = 900_000;

  it('resolves to the last higher-timeframe bar that had already closed', () => {
    const entry = [0, 1, 2, 3, 4, 5].map(k => bar(k * quarter, 1, 1, 1));
    const higher = [bar(-hour, 1, 1, 1), bar(0, 1, 1, 1)];
    // The 1H bar opening at 0 closes at 3_600_000, so only the previous one is available until the
    // 15m bar that itself closes at 3_600_000 — the fourth.
    expect(alignHigher(entry, quarter, higher, hour)).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('reports no higher bar at all rather than borrowing one from the future', () => {
    const entry = [bar(0, 1, 1, 1)];
    expect(alignHigher(entry, quarter, [bar(0, 1, 1, 1)], hour)).toEqual([-1]);
  });
});
