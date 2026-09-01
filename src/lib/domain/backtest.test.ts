import { describe, expect, it } from "vitest";
import { maxDrawdown, runAllocationBacktest, runDcaBacktest } from "./backtest";

describe("backtest", () => {
  it("buys only at each historical timestamp without seeing the next price", () => {
    const result = runDcaBacktest({
      monthlyContribution: 100,
      prices: [
        { date: "2026-01-01", close: 10 },
        { date: "2026-02-01", close: 5 },
        { date: "2026-03-01", close: 10 },
      ],
    });
    expect(result.totalInvested).toBe(300);
    expect(result.units).toBe(40);
    expect(result.finalValue).toBe(400);
  });

  it("calculates drawdown from the prior peak", () => {
    expect(maxDrawdown([100, 120, 90, 135])).toBeCloseTo(-0.25, 8);
  });

  it("passes only observations available at that month to a dynamic allocator", () => {
    const points = [10, 11, 12].map((close, index) => ({ date: `2026-0${index + 1}-01`, close }));
    const seenLengths: number[] = [];
    const result = runAllocationBacktest({
      monthlyContribution: 100,
      series: { foreignEquity: points, commodity: points, bitcoin: points, turkishEquity: points },
      allocate: (history) => {
        seenLengths.push(history.bitcoin.length);
        return { foreignEquity: 0.35, commodity: 0.25, bitcoin: 0.2, turkishEquity: 0.2 };
      },
    });
    expect(seenLengths).toEqual([1, 2, 3]);
    expect(result.totalInvested).toBe(300);
  });
});
