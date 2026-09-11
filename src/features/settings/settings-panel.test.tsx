import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_MONTHLY_BUDGET_USD, DEFAULT_TARGET_USD } from "@/lib/domain/config";
import { StrategySettingsFields } from "./settings-panel";

describe("strategy settings fields", () => {
  it("renders the annual contribution and bounded tactical controls", () => {
    const html = renderToStaticMarkup(<StrategySettingsFields
      settings={{
        monthlyBudgetUsd: DEFAULT_MONTHLY_BUDGET_USD,
        targetUsd: DEFAULT_TARGET_USD,
        riskAnswersCompleted: false,
        annualContributionUsd: 3_750,
        annualContributionMonth: 1,
        tacticalShare: 0.2,
        perTradeRisk: 0.005,
        minRiskReward: 2,
        minConfidence: 0.6,
      }}
      onChange={() => undefined}
    />);

    expect(html).toContain("Yıllık ek katkı (USD)");
    expect(html).toContain("Yıllık ek katkı ayı");
    expect(html).toContain("Taktik bütçe (%)");
    expect(html).toContain("İşlem başına risk (%)");
    expect(html).toContain('value="3750"');
  });
});
