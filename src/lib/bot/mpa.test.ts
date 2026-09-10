import { describe, expect, it } from 'vitest';
import { confirmedSwings, displacement, inspectMpa } from './mpa';
import type { Candle, Context } from './types';
import { advancePosition, openPosition } from './position';
import { defaultBotSettings } from './config';
import { sizeTrade } from './risk';
const b = (time: number, open: number, high: number, low: number, close: number, volume = 100): Candle => ({ time, open, high, low, close, volume });

describe('causal MPA rules', () => {
  it('does not expose a swing before its right-hand confirmation closes', () => {
    const bars = [b(0,100,101,99,100), b(1,100,102,99,101), b(2,101,103,100,102), b(3,102,110,101,104), b(4,104,105,98,100), b(5,100,102,98,100), b(6,100,101,97,98)];
    expect(confirmedSwings(bars.slice(0, 6)).some(s => s.index === 3)).toBe(false);
    expect(confirmedSwings(bars).find(s => s.index === 3 && s.kind === 'high')).toMatchObject({ price: 110, confirmedAt: 6 });
  });
  it('requires displacement volume versus prior bars, not merely a green candle', () => {
    const bars = Array.from({ length: 25 }, (_,i) => b(i, 100,101,99,100));
    expect(displacement([...bars,b(25,100,104,99.8,103.5,100)],26-1)).toBe(false);
    expect(displacement([...bars,b(25,100,104,99.8,103.5,200)],26-1)).toBe(true);
  });
  it('blocks without independently closed daily and weekly context', () => {
    const context: Context = { now: Date.now(), frames: { '15m': [], '1H': [], '4H': [] }, ready: true, reasons: [] };
    expect(inspectMpa(context).signal).toBeNull();
    expect(inspectMpa(context).reason).toMatch(/günlük|haftalık/i);
  });
  it('rounds the TP down to contracts and waits for an actual TP1 fill before moving stop', () => {
    const instrument = { id: 'TEST-USDT-SWAP', base: 'TEST', ctVal: 1, lotSz: .1, minSz: .1, tickSz: .1, maxLeverage: 10 };
    const signal = { direction: 'long' as const, entry: 100, stop: 98, targets: [{ price: 110, fraction: .85 }], runnerFraction: .15, manageAfterTp1: true, expiresAt: 10_000_000, confirmations: { '15m': 'ok', '1H': 'ok', '4H': 'ok' } };
    const settings = { ...defaultBotSettings, feeBps: 0, slippageBps: 0, fundingBufferBps: 0 };
    expect(sizeTrade(instrument, signal, { equity: 200, available: 200, openRisk: 0, openMargin: 0, openPositions: 0, dayStartEquity: 200 }, settings).ok).toBe(true);
    let p = openPosition('runner', instrument, signal, 1, 0, settings);
    p = advancePosition(p, b(0,100,109,99,108), settings, []);
    expect(p.stop).toBe(98);
    p = advancePosition(p, b(900_000,108,111,107,110), settings, []);
    expect(p.remaining).toBeCloseTo(.2);
    expect(p.stop).toBe(100);
    p = advancePosition(p, b(1_800_000,99,101,98,100), settings, []);
    expect(p.remaining).toBe(0);
    expect(p.exits.at(-1)?.price).toBe(99);
  });
});
