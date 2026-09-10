import { describe, expect, it } from 'vitest';
import { researchFrames } from './comparison';
import { strategyVariants } from '../../bot/strategy';
import { closedContext } from '../../bot/market';
import { createEfloudStrategy } from '../../bot/efloud';
import type { Candle, Frames } from '../../bot/types';

const series = (count: number, span: number, end: number): Candle[] =>
  Array.from({ length: count }, (_, index) => ({ time: end - (count - index) * span, open: 100, high: 101, low: 99, close: 100, volume: 10 }));

describe('comparison research frames', () => {
  it('fetches the weekly frame whenever a rostered model requires the bias', () => {
    // Efloud is on the roster and requires it; leaving 1Wutc out made every comparison row read
    // "no trades" instead of failing, because an empty bias series reads as missing data.
    expect(researchFrames(strategyVariants())).toContain('1Wutc');
  });

  it('never asks for 15m, whose short history is what caps a multi-year window', () => {
    expect(researchFrames(strategyVariants())).not.toContain('15m');
  });

  it('leaves it out when nothing on the list reads it', () => {
    expect(researchFrames(strategyVariants(['supertrend', 'combined']))).toEqual(['1H', '4H', '1Dutc']);
  });

  it('is exactly what a bias-requiring model needs to become ready', () => {
    const now = 1_700_000_000_000;
    const frames: Frames = {
      '15m': series(300, 900_000, now), '1H': series(300, 3_600_000, now), '4H': series(300, 14_400_000, now),
      bias: { daily: series(300, 86_400_000, now), weekly: series(80, 604_800_000, now) },
    };
    const strategy = createEfloudStrategy('1H');
    expect(closedContext(frames, now, strategy.warmup, true).ready).toBe(true);
    // Drop only the weekly series and the same context stops being ready at all.
    const starved = { ...frames, bias: { daily: frames.bias!.daily, weekly: [] } };
    expect(closedContext(starved, now, strategy.warmup, true).ready).toBe(false);
  });
});
