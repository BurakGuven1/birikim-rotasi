import { expect, it } from 'vitest';
import { inspectMpaV2 } from './mpa-v2';
import { advancePosition, openPosition } from './position';
import { defaultBotSettings } from './config';
import { duration, type Candle, type Context, type Interval, type Signal } from './types';

const candle = (time: number, open = 100, high = 104, low = 96, close = 100): Candle => ({ time, open, high, low, close, volume: 100 });
function range(interval: Interval): Context {
  const bars = Array.from({ length: 100 }, (_, i) => {
    const close = 100 + 3 * Math.sin(i * Math.PI / 6);
    return candle(i * duration[interval], close, close + 1, close - 1, close);
  });
  bars[99] = candle(99 * duration[interval], 96, 98, 95, 97.5);
  return { now: 100 * duration[interval], ready: true, reasons: [], frames: { '15m': bars, '1H': bars, '4H': bars } };
}
it.each(['15m', '1H', '4H'] as const)('finds an independent range sweep at the %s close and never reuses a stale close', interval => {
  const context = range(interval);
  const signal = inspectMpaV2(context, interval).signal;
  expect(signal?.model).toBe('range-sweep-reclaim');
  expect(signal?.targets).toEqual([{ price: 104, fraction: 1 }]);
  expect(signal?.expiresAt).toBe(context.now + 900_000);
  expect(inspectMpaV2({ ...context, now: context.now + 900_000 }, interval).signal).toBeNull();
});
it('does not buy an unreclaimed sweep', () => {
  const context = range('15m'); context.frames['15m'][99].close = 95.5;
  expect(inspectMpaV2(context, '15m').signal).toBeNull();
});
it('recognizes displacement and retest without requiring a liquidity sweep', () => {
  const bars = Array.from({ length: 100 }, (_, i) => candle(i * 900_000, 100, 101, 99, 100));
  bars[97] = { ...candle(97 * 900_000, 100, 108, 100, 104), volume: 200 };
  bars[98] = candle(98 * 900_000, 104, 105, 102, 103);
  bars[99] = candle(99 * 900_000, 102, 103, 100.9, 102.5);
  const context: Context = { now: 90_000_000, ready: true, reasons: [], frames: { '15m': bars, '1H': [], '4H': [] } };
  const signal = inspectMpaV2(context, '15m').signal;
  expect(signal?.model).toBe('structure-break-retest');
  expect(signal?.targets[0].price).toBe(108);
  expect(signal?.stop).toBeLessThan(100.9);
});
it('executes a scheduled reversal at next open before later candle extremes or funding', () => {
  const instrument = { id: 'T', base: 'T', ctVal: 1, lotSz: 1, minSz: 1, tickSz: .01, maxLeverage: 10 };
  const settings = { ...defaultBotSettings, feeBps: 0, slippageBps: 0 };
  const signal: Signal = { direction: 'long', entry: 100, stop: 90, targets: [{ price: 120, fraction: 1 }], expiresAt: 1, confirmations: { '15m': '', '1H': '', '4H': '' }, maxHoldHours: 1, entryInterval: '1H', exitOnReversal: true };
  const position = openPosition('t', instrument, signal, 1, 0, settings);
  const closed = advancePosition({ ...position, pendingExit: 'reversal' }, candle(900_000, 102, 130, 80, 105), settings, [{ time: 900_000, markPrice: 100, rate: .01 }, { time: 1_000_000, markPrice: 100, rate: .01 }]);
  expect(closed.exits[0]).toMatchObject({ reason: 'reversal', time: 900_000, price: 102 });
  expect(closed.funding).toBe(1);
  expect(closed.realizedPnl).toBe(1);
  expect(position.entryInterval).toBe('1H');
  expect(advancePosition(position, candle(3_600_000), settings, []).exits[0].reason).toBe('timeout');
});
