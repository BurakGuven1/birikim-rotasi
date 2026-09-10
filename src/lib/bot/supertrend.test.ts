import { describe, expect, it } from 'vitest';
import { supertrend, inspectSupertrend } from './supertrend';
import type { Candle, Context } from './types';

const bar = (time: number, close: number, range = 2): Candle =>
  ({ time, open: close, high: close + range, low: close - range, close, volume: 100 });
const build = (closes: number[]) => closes.map((close, i) => bar(i * 900_000, close));
const context = (bars: Candle[]): Context =>
  ({ now: bars.at(-1)!.time + 900_000, frames: { '15m': bars, '1H': [], '4H': [] }, ready: true, reasons: [] });

describe('supertrend', () => {
  it('holds the up trend through a sustained rise', () => {
    const line = supertrend(build(Array.from({ length: 60 }, (_, i) => 100 + i)));
    expect(line.at(-1)!.trend).toBe(1);
    expect(line.at(-1)!.band).toBeLessThan(159);
  });

  it('flips to the down trend when price closes through the lower band', () => {
    const rise = Array.from({ length: 60 }, (_, i) => 100 + i);
    const line = supertrend(build([...rise, 120, 110, 100]));
    expect(line.at(-1)!.trend).toBe(-1);
    expect(line.some(point => point.flipped)).toBe(true);
  });

  it('never uses a future bar: truncating the series leaves earlier points unchanged', () => {
    const closes = [...Array.from({ length: 60 }, (_, i) => 100 + i), 120, 110, 100, 140];
    const full = supertrend(build(closes)), truncated = supertrend(build(closes.slice(0, -1)));
    expect(full.slice(0, truncated.length)).toEqual(truncated);
  });

  it('signals only on the bar the trend actually flipped', () => {
    // The rise runs to 159, then a close at 120 breaks the ratcheted up band and flips the trend.
    const closes = [...Array.from({ length: 60 }, (_, i) => 100 + i), 120];
    expect(inspectSupertrend(context(build(closes)), '15m')).toMatchObject({ direction: 'short', model: 'supertrend-flip' });
    // Later bars continue the same down trend and are no longer entries.
    expect(inspectSupertrend(context(build([...closes, 110])), '15m')).toBeNull();
    expect(inspectSupertrend(context(build([...closes, 110, 100])), '15m')).toBeNull();
  });

  it('places the stop on the band whose breach would flip the trend back', () => {
    const closes = [...Array.from({ length: 60 }, (_, i) => 100 + i), 120];
    const signal = inspectSupertrend(context(build(closes)), '15m')!;
    const band = supertrend(build(closes)).at(-1)!.band;
    expect(signal.stop).toBeCloseTo(band, 6);
    expect(signal.stop).toBeGreaterThan(signal.entry);
  });

  it('stays silent until the entry bar has closed', () => {
    const bars = build([...Array.from({ length: 60 }, (_, i) => 100 + i), 120]);
    expect(inspectSupertrend({ ...context(bars), now: bars.at(-1)!.time + 450_000 }, '15m')).toBeNull();
  });
});
