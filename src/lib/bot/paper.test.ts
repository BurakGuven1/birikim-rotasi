import { describe, expect, it } from 'vitest';
import { replayPaperCycle } from './paper';
import { defaultBotSettings } from './config';
import type { Candle, Strategy, Instrument } from './types';
import type { PaperState } from './dashboard-types';
const candle = (time: number): Candle => ({ time, open: 100, high: 100.5, low: 99.5, close: 100, volume: 1 });
const state: PaperState = { cash: 200, equity: 200, day: '', dayStartEquity: 200, dailyHalted: false, positions: [], trades: [], lastCycle: null };
const instrument: Instrument = { id: 'T-USDT-SWAP', base: 'T', ctVal: 1, lotSz: .1, minSz: .1, tickSz: .01, maxLeverage: 10 };
const data = [{ instrument, frames: { '15m': [candle(0), candle(900_000)], '1H': [], '4H': [] }, funding: [] }];
const strategy: Strategy = { id: 'fixture', version: '1', warmup: { '15m': 1, '1H': 0, '4H': 0 }, evaluate: () => ({ direction: 'long', entry: 100, stop: 97, targets: [{ price: 107, fraction: 1 }], expiresAt: 9_000_000, confirmations: { '15m': 'a', '1H': 'b', '4H': 'c' } }) };

describe('durable paper replay', () => {
  it('opens only once when replaying the same closed candle after restart', () => {
    const one = replayPaperCycle(state, data, defaultBotSettings, strategy, 1_800_000, true);
    expect(one.state.positions).toHaveLength(1);
    expect(one.signals).toHaveLength(1);
    const two = replayPaperCycle(one.state, data, defaultBotSettings, strategy, 1_800_000, true);
    expect(two.state.positions).toHaveLength(1);
    expect(two.signals).toHaveLength(0);
  });
  it('does not enter when the user has stopped automatic trading', () => {
    expect(replayPaperCycle(state, data, defaultBotSettings, strategy, 1_800_000, false).state.positions).toHaveLength(0);
  });
  it('rejects missing bars for an existing position instead of silently skipping stops', () => {
    const one = replayPaperCycle(state, data, defaultBotSettings, strategy, 1_800_000, true);
    const gap = [{ ...data[0], frames: { ...data[0].frames, '15m': [candle(3_600_000)] } }];
    expect(() => replayPaperCycle(one.state, gap, defaultBotSettings, strategy, 4_500_000, true)).toThrow(/boşluğu/i);
  });
});
