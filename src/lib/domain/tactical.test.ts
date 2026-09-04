import { describe, expect, it } from "vitest";
import { DEFAULT_STRATEGY_PROFILE } from "./strategy";
import {
  calculatePositionSize,
  deriveTacticalSetup,
  reviewTacticalBudget,
} from "./tactical";
import type { PricePoint } from "./types";

function trendingPoints(length: number): PricePoint[] {
  return Array.from({ length }, (_, index) => {
    const close = 100 + index * 0.5;
    return {
      date: new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
      open: close - 0.5,
      high: close + 2,
      low: close - 2,
      close,
      volume: 1_000_000 + index,
    };
  });
}

describe("tactical setup engine", () => {
  it("returns wait when long-regime evidence is incomplete", () => {
    const setup = deriveTacticalSetup({
      symbol: "SP500",
      name: "S&P 500",
      prices: trendingPoints(80),
      portfolioValueUsd: 20_000,
      profile: DEFAULT_STRATEGY_PROFILE,
    });

    expect(setup.action).toBe("wait");
    expect(setup.positionSizeUsd).toBe(0);
    expect(setup.reasons).toContain("En az 200 işlem günü geçmişi gerekiyor.");
  });

  it("creates a risk-sized long setup when trend, momentum and reward agree", () => {
    const setup = deriveTacticalSetup({
      symbol: "SP500",
      name: "S&P 500",
      prices: trendingPoints(260),
      portfolioValueUsd: 20_000,
      profile: DEFAULT_STRATEGY_PROFILE,
    });

    expect(setup.action).toBe("long");
    expect(setup.confidence).toBeGreaterThanOrEqual(0.6);
    expect(setup.riskReward).toBeGreaterThanOrEqual(2);
    expect(setup.positionSizeUsd).toBeGreaterThan(0);
    expect(setup.positionSizeUsd).toBeLessThanOrEqual(5_000);
    expect(setup.invalidation).toBeLessThan(setup.entryZone[0]);
    expect(setup.targetZones[0]).toBeGreaterThan(setup.entryZone[1]);
  });

  it("caps position size at the tactical sleeve", () => {
    expect(calculatePositionSize({
      portfolioValueUsd: 10_000,
      entry: 100,
      invalidation: 99,
      perTradeRisk: 0.005,
      tacticalCapShare: 0.2,
    })).toBe(2_000);
  });

  it("refuses position sizing when invalidation does not limit downside", () => {
    expect(calculatePositionSize({
      portfolioValueUsd: 10_000,
      entry: 100,
      invalidation: 101,
      perTradeRisk: 0.005,
      tacticalCapShare: 0.2,
    })).toBe(0);
  });

  it("cuts the tactical budget after underperformance and blocks it after two failed reviews", () => {
    expect(reviewTacticalBudget({ baseShare: 0.2, completedTrades: 12, monthsObserved: 12, benchmarkDelta: -0.01, maximumDrawdown: -0.08, consecutiveFailedReviews: 1 })).toBe(0.1);
    expect(reviewTacticalBudget({ baseShare: 0.2, completedTrades: 20, monthsObserved: 24, benchmarkDelta: -0.02, maximumDrawdown: -0.1, consecutiveFailedReviews: 2 })).toBe(0);
  });

  it("does not increase the tactical budget before twelve trades and twelve months", () => {
    expect(reviewTacticalBudget({ baseShare: 0.2, completedTrades: 6, monthsObserved: 8, benchmarkDelta: 0.2, maximumDrawdown: -0.02, consecutiveFailedReviews: 0 })).toBe(0.2);
  });
});
