import { describe, expect, it } from "vitest";
import { DEFAULT_STRATEGY_PROFILE } from "./strategy";
import { runCoreTacticalBacktest, type TacticalSetupFactory } from "./tactical-backtest";
import type { PricePoint } from "./types";

const point = (date: string, close: number, low = close, high = close): PricePoint => ({
  date,
  open: close,
  low,
  high,
  close,
});

describe("core + tactical backtest", () => {
  it("never exposes observations after the setup date", () => {
    const dates = ["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07"];
    const core = dates.map((date, index) => point(date, 100 + index));
    const tactical = dates.map((date, index) => point(date, 50 + index));
    const seen: Array<{ generatedAt: string; historyEnd: string; length: number }> = [];
    const setupFactory: TacticalSetupFactory = (input) => {
      seen.push({
        generatedAt: input.prices.at(-1)!.date,
        historyEnd: input.prices.at(-1)!.date,
        length: input.prices.length,
      });
      return {
        id: `wait-${input.prices.length}`,
        symbol: input.symbol,
        name: input.name,
        action: "wait",
        generatedAt: input.prices.at(-1)!.date,
        expiresAt: input.prices.at(-1)!.date,
        entryZone: [0, 0],
        invalidation: 0,
        targetZones: [0, 0],
        riskReward: 0,
        confidence: 0,
        positionSizeUsd: 0,
        portfolioRiskUsd: 0,
        reasons: [],
      };
    };

    runCoreTacticalBacktest({
      monthlyContribution: 1_000,
      annualContribution: 0,
      annualContributionMonth: 1,
      corePrices: core,
      tacticalPrices: tactical,
      profile: DEFAULT_STRATEGY_PROFILE,
      setupFactory,
    });

    expect(seen.map((entry) => entry.length)).toEqual([1, 2, 3, 4]);
    expect(seen.every((entry) => entry.generatedAt === entry.historyEnd)).toBe(true);
  });

  it("uses the stop first when one bar touches both stop and target", () => {
    const core = [point("2026-01-02", 100), point("2026-01-05", 100, 100, 100)];
    const tactical = [point("2026-01-02", 100), point("2026-01-05", 100, 80, 120)];
    const setupFactory: TacticalSetupFactory = (input) => ({
      id: "setup-1",
      symbol: input.symbol,
      name: input.name,
      action: "long",
      generatedAt: input.prices.at(-1)!.date,
      expiresAt: "2026-01-10",
      entryZone: [99, 101],
      invalidation: 90,
      targetZones: [110, 120],
      riskReward: 2,
      confidence: 0.8,
      positionSizeUsd: 200,
      portfolioRiskUsd: 20,
      reasons: [],
    });

    const result = runCoreTacticalBacktest({
      monthlyContribution: 1_000,
      annualContribution: 0,
      annualContributionMonth: 1,
      corePrices: core,
      tacticalPrices: tactical,
      profile: DEFAULT_STRATEGY_PROFILE,
      setupFactory,
      spreadBps: 0,
      commissionUsd: 0,
    });

    expect(result.tradeCount).toBe(1);
    expect(result.winRate).toBe(0);
    expect(result.tacticalPnlUsd).toBeCloseTo(-20, 8);
  });

  it("reports matched core and tactical quality metrics after costs", () => {
    const core = [
      point("2026-01-02", 100),
      point("2026-01-05", 100),
      point("2026-01-06", 100),
    ];
    const tactical = [
      point("2026-01-02", 100),
      point("2026-01-05", 100, 80, 120),
      point("2026-01-06", 100, 99, 115),
    ];
    const setupFactory: TacticalSetupFactory = (input) => ({
      id: `setup-${input.prices.length}`,
      symbol: input.symbol,
      name: input.name,
      action: "long",
      generatedAt: input.prices.at(-1)!.date,
      expiresAt: "2026-01-10",
      entryZone: [99, 101],
      invalidation: 90,
      targetZones: [110, 120],
      riskReward: 2,
      confidence: 0.8,
      positionSizeUsd: 200,
      portfolioRiskUsd: 20,
      reasons: [],
    });

    const result = runCoreTacticalBacktest({
      monthlyContribution: 1_000,
      annualContribution: 0,
      annualContributionMonth: 1,
      corePrices: core,
      tacticalPrices: tactical,
      profile: DEFAULT_STRATEGY_PROFILE,
      setupFactory,
      spreadBps: 0,
      commissionUsd: 0,
    });

    expect(result.coreOnly.finalValue).toBe(1_000);
    expect(result.tacticalOnly).toMatchObject({
      realizedPnlUsd: 0,
      tradeCount: 2,
      winRate: 0.5,
      payoffRatio: 1,
      profitFactor: 1,
    });
    expect(result.tacticalOnly.turnover).toBeCloseTo(0.8, 8);
    expect(result.benchmarkDelta).toBe(0);
  });

  it("does not count monthly or annual cash deposits as investment returns", () => {
    const dates = ["2026-01-02", "2026-02-02", "2026-03-02"];
    const flat = dates.map((date) => point(date, 100));

    const result = runCoreTacticalBacktest({
      monthlyContribution: 1_000,
      annualContribution: 3_750,
      annualContributionMonth: 2,
      corePrices: flat,
      tacticalPrices: flat,
      profile: DEFAULT_STRATEGY_PROFILE,
      setupFactory: (input) => ({
        id: `wait-${input.prices.length}`,
        symbol: input.symbol,
        name: input.name,
        action: "wait",
        generatedAt: input.prices.at(-1)!.date,
        expiresAt: input.prices.at(-1)!.date,
        entryZone: [0, 0],
        invalidation: 0,
        targetZones: [0, 0],
        riskReward: 0,
        confidence: 0,
        positionSizeUsd: 0,
        portfolioRiskUsd: 0,
        reasons: [],
      }),
    });

    expect(result.totalInvested).toBe(6_750);
    expect(result.annualizedReturn).toBe(0);
    expect(result.volatility).toBe(0);
    expect(result.maximumDrawdown).toBe(0);
  });
});
