import { describe, expect, it } from "vitest";
import {
  DEFAULT_STRATEGY_PROFILE,
  buildContributionPlan,
  tacticalShareForDrawdown,
} from "./strategy";

describe("core tactical contribution strategy", () => {
  it("routes the exact monthly contribution into core, tactical and reserve layers", () => {
    const result = buildContributionPlan(DEFAULT_STRATEGY_PROFILE, 5, { hasEligibleSetup: true });

    expect(result).toMatchObject({ total: 1_000, core: 700, tactical: 200, reserve: 100 });
    expect(result.core + result.tactical + result.reserve).toBe(result.total);
  });

  it("moves unused tactical capital to reserve instead of forcing a trade", () => {
    const result = buildContributionPlan(DEFAULT_STRATEGY_PROFILE, 5, { hasEligibleSetup: false });

    expect(result).toMatchObject({ total: 1_000, core: 700, tactical: 0, reserve: 300 });
  });

  it("deploys half of the annual top-up immediately and stages the other half over three months", () => {
    const first = buildContributionPlan(DEFAULT_STRATEGY_PROFILE, 1, { hasEligibleSetup: false });
    const second = buildContributionPlan(DEFAULT_STRATEGY_PROFILE, 2, { hasEligibleSetup: false });
    const fourth = buildContributionPlan(DEFAULT_STRATEGY_PROFILE, 4, { hasEligibleSetup: false });

    expect(first).toMatchObject({ total: 3_500, annualImmediateCore: 1_875, annualStaged: 625, core: 2_575, reserve: 925 });
    expect(second).toMatchObject({ total: 1_625, annualImmediateCore: 0, annualStaged: 625, core: 700, reserve: 925 });
    expect(fourth).toMatchObject({ total: 1_000, annualImmediateCore: 0, annualStaged: 0 });
  });

  it("wraps staged annual capital across December into January and February", () => {
    const profile = { ...DEFAULT_STRATEGY_PROFILE, annualContributionMonth: 12 };

    expect(buildContributionPlan(profile, 1, { hasEligibleSetup: true }).annualStaged).toBe(625);
    expect(buildContributionPlan(profile, 2, { hasEligibleSetup: true }).annualStaged).toBe(625);
    expect(buildContributionPlan(profile, 3, { hasEligibleSetup: true }).annualStaged).toBe(0);
  });

  it("halves tactical risk at a 12% drawdown and blocks it at 18%", () => {
    expect(tacticalShareForDrawdown(0.2, -0.119)).toBe(0.2);
    expect(tacticalShareForDrawdown(0.2, -0.12)).toBe(0.1);
    expect(tacticalShareForDrawdown(0.2, -0.18)).toBe(0);
  });

  it("rejects invalid layer totals before creating a plan", () => {
    const invalid = { ...DEFAULT_STRATEGY_PROFILE, reserveShare: 0.2 };

    expect(() => buildContributionPlan(invalid, 5, { hasEligibleSetup: true })).toThrow("Katman oranları toplam yüzde 100 olmalı");
  });
});
