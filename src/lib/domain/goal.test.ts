import { describe, expect, it } from "vitest";
import {
  inflationAdjustedTarget,
  monthsToInflationAdjustedGoal,
  requiredMonthlyContributionForHorizon,
  trailingYearInflation,
} from "./goal";

describe("USD wealth goal", () => {
  it("raises today's target by cumulative US inflation", () => {
    expect(inflationAdjustedTarget(500_000, 0.03, 5)).toBeCloseTo(579_637.04, 2);
  });

  it("reaches a twelve-thousand-dollar target in twelve flat months", () => {
    expect(monthsToInflationAdjustedGoal({
      monthlyContribution: 1_000,
      targetToday: 12_000,
      annualReturn: 0,
      annualInflation: 0,
    })).toBe(12);
  });

  it("requires the full target divided by months when returns and inflation are zero", () => {
    expect(requiredMonthlyContributionForHorizon({
      targetToday: 500_000,
      years: 5,
      annualReturn: 0,
      annualInflation: 0,
    })).toBeCloseTo(8_333.33, 2);
  });

  it("requires more monthly savings when the target inflates faster", () => {
    const flat = requiredMonthlyContributionForHorizon({ targetToday: 500_000, years: 5, annualReturn: 0.08, annualInflation: 0 });
    const inflationAdjusted = requiredMonthlyContributionForHorizon({ targetToday: 500_000, years: 5, annualReturn: 0.08, annualInflation: 0.03 });
    expect(inflationAdjusted).toBeGreaterThan(flat);
  });

  it("derives the latest twelve-month inflation rate from CPI points", () => {
    expect(trailingYearInflation([
      { date: "2025-06-01T00:00:00Z", close: 100 },
      { date: "2026-01-01T00:00:00Z", close: 101 },
      { date: "2026-06-01T00:00:00Z", close: 103 },
    ])).toBeCloseTo(0.03, 8);
  });
});
