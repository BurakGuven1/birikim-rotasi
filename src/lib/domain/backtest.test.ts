import { describe, expect, it } from "vitest";
import { applyUsdInflation, convertTrySeriesToUsd, maxDrawdown, optimizeBalancedConsensus, optimizeStaticAllocation, runAllocationBacktest, runDcaBacktest, runPerfectForesightBacktest } from "./backtest";

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

  it("does not count new monthly deposits as portfolio return or volatility", () => {
    const points = [100, 100, 100, 100].map((close, index) => ({ date: `2026-0${index + 1}-01`, close }));
    const result = runAllocationBacktest({
      monthlyContribution: 100,
      series: { foreignEquity: points, commodity: points, bitcoin: points, turkishEquity: points },
      allocate: () => ({ foreignEquity: 0.25, commodity: 0.25, bitcoin: 0.25, turkishEquity: 0.25 }),
    });

    expect(result.annualizedReturn).toBe(0);
    expect(result.volatility).toBe(0);
    expect(result.maximumDrawdown).toBe(0);
  });

  it("detects market drawdown even when a new deposit keeps account value rising", () => {
    const points = [100, 50, 50].map((close, index) => ({ date: `2026-0${index + 1}-01`, close }));
    const result = runAllocationBacktest({
      monthlyContribution: 100,
      series: { foreignEquity: points, commodity: points, bitcoin: points, turkishEquity: points },
      allocate: () => ({ foreignEquity: 0.25, commodity: 0.25, bitcoin: 0.25, turkishEquity: 0.25 }),
    });

    expect(result.maximumDrawdown).toBeCloseTo(-0.5, 8);
  });

  it("supports a fixed TRY deposit converted to a different USD amount each month", () => {
    const points = [10, 10].map((close, index) => ({ date: `2026-0${index + 1}-01`, close }));
    const result = runDcaBacktest({
      monthlyContribution: 100,
      contributionForDate: (date) => date.startsWith("2026-01") ? 10 : 5,
      prices: points,
    });

    expect(result.totalInvested).toBe(15);
    expect(result.finalValue).toBe(15);
  });

  it("converts TRY prices with the latest USDTRY rate available on that date", () => {
    const converted = convertTrySeriesToUsd(
      [{ date: "2026-01-15T00:00:00Z", close: 1_000 }],
      [
        { date: "2026-01-01T00:00:00Z", close: 10 },
        { date: "2026-02-01T00:00:00Z", close: 20 },
      ],
    );

    expect(converted).toEqual([{ date: "2026-01-15T00:00:00Z", close: 100 }]);
  });

  it("compares the final USD value with the CPI-adjusted purchasing-power hurdle", () => {
    const result = runDcaBacktest({
      monthlyContribution: 100,
      prices: [
        { date: "2026-01-01T00:00:00Z", close: 10 },
        { date: "2026-02-01T00:00:00Z", close: 10 },
      ],
    });
    const adjusted = applyUsdInflation(result, [
      { date: "2026-01-01T00:00:00Z", close: 100 },
      { date: "2026-02-01T00:00:00Z", close: 110 },
    ]);

    expect(adjusted.inflationAdjustedInvested).toBeCloseTo(210, 8);
    expect(adjusted.realReturn).toBeCloseTo(200 / 210 - 1, 8);
    expect(adjusted.series.at(-1)?.inflationHurdle).toBeCloseTo(210, 8);
  });

  it("limits contributions to the exact requested number of months", () => {
    const prices = Array.from({ length: 13 }, (_, index) => ({ date: new Date(Date.UTC(2025, 8 + index, 1)).toISOString(), close: 10 }));
    const result = runDcaBacktest({ monthlyContribution: 50_000, prices, maxPeriods: 12 } as Parameters<typeof runDcaBacktest>[0] & { maxPeriods: number });

    expect(result.totalInvested).toBe(600_000);
    expect(result.series).toHaveLength(12);
    expect(result.series[0].date.slice(0, 7)).toBe("2025-10");
  });

  it.each([12, 36, 60, 120])("uses exactly %i contributions for the period selector", (months) => {
    const prices = Array.from({ length: 150 }, (_, index) => ({
      date: new Date(Date.UTC(2014, index, 1)).toISOString(),
      close: 100 + index,
    }));

    const result = runDcaBacktest({ monthlyContribution: 50_000, prices, maxPeriods: months });

    expect(result.series).toHaveLength(months);
    expect(result.totalInvested).toBe(50_000 * months);
  });

  it("aligns allocation assets by common calendar month instead of array index", () => {
    const points = (months: string[]) => months.map((month) => ({ date: `${month}-01T00:00:00Z`, close: 10 }));
    const result = runAllocationBacktest({
      monthlyContribution: 100,
      series: {
        foreignEquity: points(["2026-01", "2026-02", "2026-03"]),
        commodity: points(["2026-01", "2026-03", "2026-04"]),
        bitcoin: points(["2026-01", "2026-02", "2026-03"]),
        turkishEquity: points(["2026-01", "2026-02", "2026-03"]),
      },
      allocate: () => ({ foreignEquity: 0.25, commodity: 0.25, bitcoin: 0.25, turkishEquity: 0.25 }),
    });

    expect(result.totalInvested).toBe(200);
    expect(result.series.map((point) => point.date.slice(0, 7))).toEqual(["2026-01", "2026-03"]);
  });

  it("finds the maximum-return static allocation without balance limits", () => {
    const points = (closes: number[]) => closes.map((close, index) => ({ date: `2026-0${index + 1}-01T00:00:00Z`, close }));
    const series = {
      foreignEquity: points([100, 101, 102, 103]),
      commodity: points([100, 100, 100, 100]),
      bitcoin: points([100, 130, 170, 220]),
      turkishEquity: points([100, 99, 101, 100]),
    };

    const optimum = optimizeStaticAllocation({ monthlyContribution: 100, series, objective: "maximumReturn" });

    expect(optimum.weights).toEqual({ foreignEquity: 0, commodity: 0, bitcoin: 1, turkishEquity: 0 });
    expect(optimum.result.finalValue).toBeGreaterThan(optimum.result.totalInvested);
  });

  it("keeps every asset diversified in the risk-adjusted balanced optimum", () => {
    const points = (closes: number[]) => closes.map((close, index) => ({ date: `2026-0${index + 1}-01T00:00:00Z`, close }));
    const series = {
      foreignEquity: points([100, 101, 102, 103]),
      commodity: points([100, 100, 100, 100]),
      bitcoin: points([100, 110, 120, 130]),
      turkishEquity: points([100, 101, 100, 102]),
    };

    const optimum = optimizeStaticAllocation({ monthlyContribution: 100, series, objective: "balanced" });

    expect(Object.values(optimum.weights).every((weight) => weight >= 0.1 && weight <= 0.5)).toBe(true);
    expect(optimum.weights.bitcoin).toBe(0.5);
    expect(Object.values(optimum.weights).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 8);
  });

  it("builds the balanced baseline from every complete requested horizon", () => {
    const points = Array.from({ length: 40 }, (_, index) => ({
      date: new Date(Date.UTC(2023, index, 1)).toISOString(),
      close: 100 + index,
    }));
    const series = { foreignEquity: points, commodity: points, bitcoin: points, turkishEquity: points };

    const consensus = optimizeBalancedConsensus({ monthlyContribution: 100, series, periods: [12, 36, 60] });

    expect(consensus.periods).toEqual([12, 36]);
    expect(Object.values(consensus.weights).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 8);
    expect(consensus.optimizations).toHaveLength(2);
  });

  it("builds a clearly separate perfect-foresight upper bound", () => {
    const points = (closes: number[]) => closes.map((close, index) => ({ date: `2026-0${index + 1}-01T00:00:00Z`, close }));
    const series = {
      foreignEquity: points([100, 101, 102, 103]),
      commodity: points([100, 100, 100, 100]),
      bitcoin: points([100, 130, 170, 220]),
      turkishEquity: points([100, 99, 101, 100]),
    };

    const upperBound = runPerfectForesightBacktest({ monthlyContribution: 100, series });

    expect(upperBound.result.finalValue).toBeGreaterThanOrEqual(optimizeStaticAllocation({ monthlyContribution: 100, series, objective: "maximumReturn" }).result.finalValue);
    expect(upperBound.monthlyChoices).toHaveLength(4);
    expect(Object.values(upperBound.weights).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 8);
  });

  it("weights perfect-foresight allocation percentages by historical USD contribution", () => {
    const points = (closes: number[]) => closes.map((close, index) => ({ date: `2026-0${index + 1}-01T00:00:00Z`, close }));
    const series = {
      foreignEquity: points([100, 400, 400]),
      commodity: points([100, 100, 100]),
      bitcoin: points([100, 100, 300]),
      turkishEquity: points([100, 100, 100]),
    };

    const upperBound = runPerfectForesightBacktest({
      monthlyContribution: 1,
      contributionForDate: (_date, index) => [100, 400, 100][index],
      series,
    });

    expect(upperBound.weights.foreignEquity).toBeCloseTo(1 / 3, 8);
    expect(upperBound.weights.bitcoin).toBeCloseTo(2 / 3, 8);
    expect(upperBound.monthlyChoices[1].contribution).toBe(400);
  });
});
