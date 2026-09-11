import { describe, expect, it } from 'vitest';
import { closedContext } from './market';
import { openPosition, advancePosition } from './position';
import { runBacktest } from './backtest';
import { defaultBotSettings } from './config';
import type { Candle, Strategy, Signal, Instrument } from './types';

const instrument: Instrument = { id: 'TEST-USDT-SWAP', base: 'TEST', ctVal: 1, lotSz: .1, minSz: .1, tickSz: .01, maxLeverage: 10 };
const settings = { ...defaultBotSettings, feeBps: 0, slippageBps: 0, fundingBufferBps: 0 };
const bar = (time: number, open = 100, high = 101, low = 99.5, close = 100): Candle => ({ time, open, high, low, close, volume: 100 });
const signal: Signal = { direction: 'long', entry: 100, stop: 99, targets: [{ price: 103, fraction: 1 }], expiresAt: 99_000_000, confirmations: { '15m': 'yes', '1H': 'yes', '4H': 'yes' } };

describe('closed multi-timeframe inputs', () => {
  it('excludes a higher timeframe candle that has not closed at decision time', () => {
    const context = closedContext({ '15m': [bar(0), bar(900_000)], '1H': [bar(0)], '4H': [bar(0)] }, 3_600_000, { '15m': 1, '1H': 1, '4H': 0 });
    expect(context.frames['1H']).toHaveLength(1);
    expect(context.frames['4H']).toHaveLength(0);
  });
  it('blocks gapped and stale data', () => {
    const data = { '15m': [bar(0), bar(1_800_000)], '1H': [bar(0)], '4H': [bar(0)] };
    expect(closedContext(data, 14_400_000, { '15m': 2, '1H': 1, '4H': 1 }).ready).toBe(false);
  });
});

describe('position execution model', () => {
  it('takes the stop first when the same candle also touches the target', () => {
    const p = openPosition('test', instrument, signal, 1, 0, settings);
    const next = advancePosition(p, bar(900_000, 100, 104, 98), settings, []);
    expect(next.remaining).toBe(0);
    expect(next.realizedPnl).toBe(-1);
    expect(next.exits[0].reason).toBe('stop');
  });
  it('fills a gap through the stop at the worse open', () => {
    const p = openPosition('test', instrument, signal, 1, 0, settings);
    expect(advancePosition(p, bar(900_000, 97, 100, 96, 98), settings, []).realizedPnl).toBe(-3);
  });
  it('moves stop only after the trigger candle and never widens it', () => {
    const p = openPosition('test', instrument, { ...signal, breakEvenAtR: 1 }, 1, 0, settings);
    const next = advancePosition(p, bar(900_000, 100, 101.5, 99.5, 101), settings, []);
    expect(next.remaining).toBe(1);
    expect(next.stop).toBe(100);
    expect(advancePosition(next, bar(1_800_000, 100.5, 102, 99.5, 101), settings, []).remaining).toBe(0);
  });
  it('accounts for partial TP and charges funding once', () => {
    const p = openPosition('test', instrument, { ...signal, targets: [{ price: 102, fraction: .5 }, { price: 104, fraction: .5 }] }, 1, 0, settings);
    const next = advancePosition(p, bar(900_000, 100, 102.5, 100, 102), settings, [{ time: 1_000_000, rate: .001, markPrice: 100 }]);
    expect(next.remaining).toBe(.5);
    expect(next.realizedPnl).toBeCloseTo(.9);
    expect(advancePosition(next, bar(1_800_000, 102, 104.5, 101, 104), settings, []).realizedPnl).toBeCloseTo(2.9);
  });
});

describe('strategy backtest harness', () => {
  it('latches a new UTC day equity breach even when a carried trade recovers', () => {
    const frames = { '15m': [bar(84_600_000), bar(85_500_000), bar(86_400_000, 106, 106.5, 105, 106), bar(87_300_000, 103, 107, 103, 107), bar(88_200_000, 107, 109, 106, 108), bar(89_100_000)], '1H': [], '4H': [] };
    const strategy: Strategy = { id: 'fixture', version: '1', warmup: { '15m': 1, '1H': 0, '4H': 0 }, evaluate: () => ({ ...signal, targets: [{ price: 108, fraction: 1 }] }) };
    const result = runBacktest({ instrument, frames, strategy, settings: { ...settings, dailyLossPercent: .5 }, funding: [], fundingComplete: true });
    expect(result.trades).toHaveLength(1);
  });
  it('does not manufacture performance when no strategy is installed', () => {
    expect(() => runBacktest({ instrument, frames: { '15m': [], '1H': [], '4H': [] }, strategy: null, settings, funding: [], fundingComplete: true })).toThrow(/strateji/i);
  });
  it('uses the next open and keeps incomplete costs out of live eligibility', () => {
    const frames = { '15m': [bar(0), bar(900_000, 100.5, 104, 100, 103), bar(1_800_000)], '1H': [], '4H': [] };
    const strategy: Strategy = { id: 'fixture', version: '1', warmup: { '15m': 1, '1H': 0, '4H': 0 }, evaluate: (ctx) => ctx.now === 900_000 ? signal : null };
    const result = runBacktest({ instrument, frames, strategy, settings: { ...settings, minRewardRisk: 1 }, funding: [], fundingComplete: false });
    expect(result.trades[0].entry).toBe(100.5);
    expect(result.trades[0].openedAt).toBe(900_000);
    expect(result.eligible).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
