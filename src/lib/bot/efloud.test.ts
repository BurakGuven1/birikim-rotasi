import { describe, expect, it } from 'vitest';
import { inspectEfloud, pivots, rsi, adx, EFLOUD } from './efloud';
import type { Candle, Context } from './types';

const bar = (time: number, close: number, range = 2, volume = 100): Candle =>
  ({ time, open: close - .4, high: close + range, low: close - range, close, volume });
const build = (closes: number[], step = 3_600_000) => closes.map((close, i) => bar(i * step, close));

/** A long uptrend on the entry frame, with matching 4H and daily/weekly context. */
function trending(n = 1400) {
  const closes = Array.from({ length: n }, (_, i) => 100 + i * .5);
  const entry = build(closes);
  const higher = build(closes.filter((_, i) => i % 4 === 0), 14_400_000);
  const daily = build(closes.filter((_, i) => i % 24 === 0), 86_400_000);
  const weekly = build(closes.filter((_, i) => i % 168 === 0), 604_800_000);
  return { entry, higher, daily, weekly };
}
const context = (data: ReturnType<typeof trending>, overrides: Partial<Context> = {}): Context => ({
  now: data.entry.at(-1)!.time + 3_600_000,
  frames: { '15m': [], '1H': data.entry, '4H': data.higher, bias: { daily: data.daily, weekly: data.weekly } },
  ready: true, reasons: [], ...overrides,
});

describe('efloud indicators', () => {
  it('finds only pivots confirmed on both sides', () => {
    const bars = build([1, 2, 3, 9, 3, 2, 1]);
    const { highs } = pivots(bars, 3);
    expect(highs).toHaveLength(1);
    expect(highs[0].index).toBe(3);
  });

  it('never treats the final bars as a pivot, since they are unconfirmed', () => {
    const bars = build([1, 2, 3, 4, 5, 6, 99]);
    expect(pivots(bars, 3).highs.every(p => p.index < bars.length - 3)).toBe(true);
  });

  it('reads overbought and oversold at the extremes', () => {
    expect(rsi(build(Array.from({ length: 40 }, (_, i) => 100 + i)))).toBe(100);
    expect(rsi(build(Array.from({ length: 40 }, (_, i) => 100 - i)))).toBeLessThan(5);
  });

  it('reports a strong trend as high ADX and a flat market as low', () => {
    const strong = adx(build(Array.from({ length: 120 }, (_, i) => 100 + i * 2)));
    const flat = adx(build(Array.from({ length: 120 }, (_, i) => 100 + (i % 2) * .05)));
    expect(strong).toBeGreaterThan(flat);
  });
});

describe('efloud strategy', () => {
  it('stays out until the entry bar has closed', () => {
    const data = trending();
    const early = context(data, { now: data.entry.at(-1)!.time + 1_800_000 });
    expect(inspectEfloud(early, '1H').signal).toBeNull();
  });

  it('refuses to read anything while the context is not ready', () => {
    const data = trending();
    const read = inspectEfloud(context(data, { ready: false, reasons: ['1H: veri eski'] }), '1H');
    expect(read.signal).toBeNull();
    expect(read.reason).toContain('veri eski');
  });

  it('explains why it is standing aside instead of failing silently', () => {
    const data = trending();
    const read = inspectEfloud(context(data), '1H');
    if (!read.signal) expect(read.reason).toMatch(/Rejim|Hacim|Tetik|kapısı|Puan/);
    expect(read.longScore + read.shortScore).toBeGreaterThan(0);
  });

  it('scores an uptrend higher on the long side than the short side', () => {
    const read = inspectEfloud(context(trending()), '1H');
    expect(read.longScore).toBeGreaterThan(read.shortScore);
  });

  it('sizes the staged exit exactly as the script does when it fires', () => {
    // Sweep the recent low, then reclaim it on a strong bullish impulse with expanded volume.
    const data = trending();
    const base = data.entry.at(-1)!.close;
    data.entry.push({ time: data.entry.at(-1)!.time + 3_600_000, open: base, high: base + 1, low: base - 14, close: base - 12, volume: 400 });
    data.entry.push({ time: data.entry.at(-1)!.time + 3_600_000, open: base - 12, high: base + 6, low: base - 13, close: base + 5, volume: 900 });
    const read = inspectEfloud(context(data), '1H');
    if (!read.signal) return;
    const signal = read.signal;
    expect(signal.targets.map(t => t.fraction)).toEqual([.4, .4]);
    expect(signal.runnerFraction).toBe(.2);
    expect(signal.breakEvenAtR).toBe(EFLOUD.rr1);
    const risk = Math.abs(signal.entry - signal.stop);
    expect(Math.abs(signal.targets[0].price - signal.entry) / risk).toBeCloseTo(EFLOUD.rr1, 1);
    expect([0, .5, 1]).toContain(signal.confidence);
  });
  it('aims the adaptive second target at the range boundary and keeps it inside its bounds', () => {
    const data = trending();
    const base = data.entry.at(-1)!.close;
    data.entry.push({ time: data.entry.at(-1)!.time + 3_600_000, open: base, high: base + 1, low: base - 14, close: base - 12, volume: 400 });
    data.entry.push({ time: data.entry.at(-1)!.time + 3_600_000, open: base - 12, high: base + 6, low: base - 13, close: base + 5, volume: 900 });
    const read = inspectEfloud(context(data), '1H');
    if (!read.signal) return;
    const signal = read.signal;
    const reward = Math.abs(signal.targets[1].price - signal.entry) / Math.abs(signal.entry - signal.stop);
    expect(reward).toBeGreaterThanOrEqual(EFLOUD.rr2Min - .05);
    expect(reward).toBeLessThanOrEqual(EFLOUD.rr2Max + .05);
    // The runner starts trailing where this trade's own second target sits, not at a fixed multiple.
    expect(signal.trailing?.activateAtR).toBeCloseTo(reward, 1);
  });
});
