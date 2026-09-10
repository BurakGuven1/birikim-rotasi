import { describe, expect, it } from 'vitest';
import { inspectDonchian, donchianLookback, donchianStopAtr } from './reference';
import type { Candle, Context } from './types';

const bar = (time: number, close: number, range = 1): Candle =>
  ({ time, open: close, high: close + range, low: close - range, close, volume: 100 });
const build = (closes: number[]): Candle[] => closes.map((close, index) => bar(index * 900_000, close));
const context = (bars: Candle[]): Context =>
  ({ now: bars.at(-1)!.time + 900_000, frames: { '15m': bars, '1H': [], '4H': [] }, ready: true, reasons: [] });

describe('donchian reference control', () => {
  const base = Array.from({ length: 80 }, (_, i) => 100 + (i % 2));

  it('does not signal while price stays inside the channel', () => {
    expect(inspectDonchian(context(build(base)), '15m')).toBeNull();
  });

  it('goes long on a close above the prior channel high with an ATR stop below entry', () => {
    const signal = inspectDonchian(context(build([...base, 130])), '15m');
    expect(signal).toMatchObject({ direction: 'long', model: 'donchian-breakout' });
    expect(signal!.stop).toBeLessThan(signal!.entry);
    expect(signal!.targets[0].price).toBeGreaterThan(signal!.entry);
  });

  it('goes short on a close below the prior channel low', () => {
    expect(inspectDonchian(context(build([...base, 70])), '15m')).toMatchObject({ direction: 'short' });
  });

  it('sizes the stop at the published ATR multiple, wide enough to survive trading costs', () => {
    const signal = inspectDonchian(context(build([...base, 130])), '15m')!;
    const channel = build([...base, 130]).slice(-(donchianLookback + 1), -1);
    expect(channel).toHaveLength(donchianLookback);
    // Stop distance is donchianStopAtr x ATR; with a range of 1 per bar the ATR is ~2.
    expect(signal.entry - signal.stop).toBeGreaterThan(donchianStopAtr);
  });

  it('stays silent until the entry bar has closed', () => {
    const bars = build([...base, 130]);
    expect(inspectDonchian({ ...context(bars), now: bars.at(-1)!.time + 450_000 }, '15m')).toBeNull();
  });
});
