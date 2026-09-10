import { describe, expect, it } from 'vitest';
import { contiguousTail, decideEth, ETH_LIVE_WINDOW } from './eth-live';
import { defaultEthMomentumSettings } from './eth-momentum';
import type { Candle, Instrument } from './types';

const SPAN = 900_000;
const instrument: Instrument = { id: 'ETH-USDT-SWAP', base: 'ETH', ctVal: .1, lotSz: .01, minSz: .01, tickSz: .01, maxLeverage: 100 };

/** A quiet, drifting series: enough bars for every warmup, no setup the model would take. */
function series(count: number, span: number, start = 0): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const price = 2000 + Math.sin(index / 9) * 12;
    return { time: start + index * span, open: price, high: price + 3, low: price - 3, close: price, volume: 100 };
  });
}

describe('eth live decision', () => {
  it('keeps only the unbroken recent tail, rather than stitching over a hole', () => {
    const bars = series(10, SPAN);
    const gapped = [...bars.slice(0, 4), ...bars.slice(6)];
    const tail = contiguousTail(gapped);
    expect(tail).toHaveLength(4);
    expect(tail[0].time).toBe(bars[6].time);
  });

  it('reports the last closed bar, never the one still forming', () => {
    const bars15m = series(600, SPAN);
    const now = bars15m.at(-1)!.time + SPAN;
    const decision = decideEth({
      instrument, bars15m: [...bars15m, { ...bars15m.at(-1)!, time: now }],
      bars1H: series(400, 3_600_000), barsDaily: series(300, 86_400_000),
      settings: defaultEthMomentumSettings, now,
    });
    expect(decision.state.barTime).toBe(bars15m.at(-1)!.time);
    expect(decision.window.bars).toBe(600);
  });

  it('never looks at more than the declared window, so cycles stay bounded', () => {
    const bars15m = series(ETH_LIVE_WINDOW + 500, SPAN);
    const now = bars15m.at(-1)!.time + SPAN;
    const decision = decideEth({ instrument, bars15m, bars1H: series(500, 3_600_000), barsDaily: series(300, 86_400_000), settings: defaultEthMomentumSettings, now });
    expect(decision.window.bars).toBe(ETH_LIVE_WINDOW);
  });

  it('names why a flat bar took no entry instead of reporting silence', () => {
    const bars15m = series(600, SPAN);
    const now = bars15m.at(-1)!.time + SPAN;
    const decision = decideEth({ instrument, bars15m, bars1H: series(400, 3_600_000), barsDaily: series(300, 86_400_000), settings: defaultEthMomentumSettings, now });
    expect(decision.state.position).toBeNull();
    expect(decision.state.pending).toBeNull();
    expect(typeof decision.state.blocked).toBe('string');
    expect(decision.blocked.length).toBeGreaterThan(0);
  });

  it('refuses to decide on a history too short or too broken to compute the filters', () => {
    const bars15m = series(300, SPAN);
    const now = bars15m.at(-1)!.time + SPAN;
    expect(() => decideEth({ instrument, bars15m, bars1H: series(400, 3_600_000), barsDaily: series(300, 86_400_000), settings: defaultEthMomentumSettings, now }))
      .toThrow(/yetersiz veya kesintili/);
  });
});
