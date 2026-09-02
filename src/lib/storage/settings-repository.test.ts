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
    });
  });
});
