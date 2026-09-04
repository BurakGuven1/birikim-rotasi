import { describe, expect, it } from "vitest";
import { normalizeUserSettings } from "./settings-repository";

describe("settings migration", () => {
  it("does not reinterpret the legacy TRY budget as USD", () => {
    expect(normalizeUserSettings({ monthlyBudget: 50_000 })).toMatchObject({ monthlyBudgetUsd: 1_000, targetUsd: 500_000 });
  });

  it("preserves an explicitly saved USD budget and target", () => {
    expect(normalizeUserSettings({ monthlyBudgetUsd: 1_250, targetUsd: 600_000, riskAnswersCompleted: true })).toEqual({
      monthlyBudgetUsd: 1_250,
      targetUsd: 600_000,
      riskAnswersCompleted: true,
      annualContributionUsd: 3_750,
      annualContributionMonth: 1,
      tacticalShare: 0.2,
      perTradeRisk: 0.005,
      minRiskReward: 2,
      minConfidence: 0.6,
    });
  });

  it("bounds unsafe strategy settings while preserving valid values", () => {
    expect(normalizeUserSettings({
      monthlyBudgetUsd: 900,
      annualContributionUsd: 4_000,
      annualContributionMonth: 13,
      tacticalShare: 0.8,
      perTradeRisk: 0.04,
      minRiskReward: 1,
      minConfidence: 0.2,
    })).toMatchObject({
      monthlyBudgetUsd: 900,
      annualContributionUsd: 4_000,
      annualContributionMonth: 1,
      tacticalShare: 0.25,
      perTradeRisk: 0.01,
      minRiskReward: 2,
      minConfidence: 0.6,
    });
  });
});
