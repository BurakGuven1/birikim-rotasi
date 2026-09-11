import { describe, expect, it } from 'vitest';
import { runPortfolio, scorePortfolio, commonDays, walkForward, DAY, type DailySeries } from './cross-sectional';

const series = (id: string, closes: number[], funding?: number[]): DailySeries => ({
  id,
  closes: new Map(closes.map((close, i) => [i * DAY, close])),
  funding: funding && new Map(funding.map((rate, i) => [i * DAY, rate])),
});
const flat = (id: string, value = 100, n = 12) => series(id, Array.from({ length: n }, () => value));

describe('cross-sectional portfolio', () => {
  it('only rebalances on days every contract has priced', () => {
    const partial: DailySeries = { id: 'B', closes: new Map([[0, 10], [2 * DAY, 12]]) };
    expect(commonDays([flat('A'), partial])).toEqual([0, 2 * DAY]);
  });

  it('earns the spread between the strongest and weakest contract', () => {
    // A rises every day, B falls; long A short B must be profitable before costs.
    const up = series('A', [100, 101, 102, 103, 104, 105]);
    const down = series('B', [100, 99, 98, 97, 96, 95]);
    const results = runPortfolio([up, down], { lookbackDays: 2, positions: 1, costRate: 0, includeFunding: false });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.ret > 0)).toBe(true);
    expect(results[0].longs).toEqual(['A']);
    expect(results[0].shorts).toEqual(['B']);
  });

  it('charges cost on the weight actually traded', () => {
    const up = series('A', [100, 101, 102, 103, 104, 105]);
    const down = series('B', [100, 99, 98, 97, 96, 95]);
    const free = runPortfolio([up, down], { lookbackDays: 2, positions: 1, costRate: 0, includeFunding: false });
    const costed = runPortfolio([up, down], { lookbackDays: 2, positions: 1, costRate: .01, includeFunding: false });
    expect(costed[0].ret).toBeLessThan(free[0].ret);
    expect(costed[0].turnover).toBeGreaterThan(0);
  });

  it('makes a long pay funding and a short receive it', () => {
    const up = series('A', [100, 101, 102, 103, 104, 105], [0, 0, 0, .01, .01, .01]);
    const down = series('B', [100, 99, 98, 97, 96, 95], [0, 0, 0, 0, 0, 0]);
    const off = runPortfolio([up, down], { lookbackDays: 2, positions: 1, costRate: 0, includeFunding: false });
    const on = runPortfolio([up, down], { lookbackDays: 2, positions: 1, costRate: 0, includeFunding: true });
    expect(on[0].ret).toBeLessThan(off[0].ret);
  });

  it('refuses to trade a universe too small to take both sides', () => {
    expect(runPortfolio([flat('A')], { lookbackDays: 2, positions: 1, costRate: 0, includeFunding: false })).toEqual([]);
  });

  it('reports no metrics for an empty run rather than a fabricated zero', () => {
    expect(scorePortfolio([])).toBeNull();
  });

  it('scores drawdown and turnover from the realised daily path', () => {
    const metrics = scorePortfolio([
      { time: 0, ret: .1, turnover: 1, longs: [], shorts: [] },
      { time: DAY, ret: -.5, turnover: 1, longs: [], shorts: [] },
    ])!;
    expect(metrics.days).toBe(2);
    expect(metrics.maxDrawdownPercent).toBeCloseTo(50, 6);
    expect(metrics.averageTurnoverPercent).toBeCloseTo(100, 6);
  });

  it('walk-forward never scores a block with parameters chosen after it', () => {
    const long = Array.from({ length: 300 }, (_, i) => 100 + i);
    const short = Array.from({ length: 300 }, (_, i) => 100 - i * .1);
    const result = walkForward([series('A', long), series('B', short)],
      [{ lookbackDays: 7, positions: 1 }, { lookbackDays: 14, positions: 1 }], { costRate: 0, includeFunding: false }, 180, 30);
    expect(result.days).toBeGreaterThan(0);
    expect(result.picks.length).toBe(Math.floor((result.days) / 30));
    expect(result.metrics!.days).toBe(result.days);
  });
});
