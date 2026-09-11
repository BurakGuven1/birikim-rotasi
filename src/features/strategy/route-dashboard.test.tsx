import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_STRATEGY_PROFILE, buildContributionPlan } from "@/lib/domain/strategy";
import type { TacticalSetup } from "@/lib/domain/tactical";
import { RouteDashboardView } from "./route-dashboard";

const setup: TacticalSetup = {
  id: "SP500-2026-09-04",
  symbol: "SP500",
  name: "S&P 500",
  action: "long",
  generatedAt: "2026-09-04T00:00:00.000Z",
  expiresAt: "2026-09-11T00:00:00.000Z",
  entryZone: [100, 101],
  invalidation: 95,
  targetZones: [112, 118],
  riskReward: 2.4,
  confidence: 0.8,
  positionSizeUsd: 2_000,
  portfolioRiskUsd: 100,
  reasons: ["Trend ve momentum aynı yönde."],
};

describe("investment route dashboard", () => {
  it("renders the action-first monthly plan and separates target from achieved performance", () => {
    const plan = buildContributionPlan(DEFAULT_STRATEGY_PROFILE, 5, { hasEligibleSetup: true });
    const html = renderToStaticMarkup(<RouteDashboardView
      plan={plan}
      profile={DEFAULT_STRATEGY_PROFILE}
      setups={[setup]}
      usdTry={48.25}
      portfolioValueUsd={20_000}
      portfolioValueEstimated={false}
      loading={false}
      errors={[]}
    />);

    expect(html).toContain("Bu ayın yatırım rotası");
    expect(html).toContain("Çekirdek");
    expect(html).toContain("Taktik / swing");
    expect(html).toContain("Fırsat rezervi");
    expect(html).toContain("Reel USD hedefi");
    expect(html).toContain("Hedef, garanti değil");
    expect(html).toContain("S&amp;P 500");
  });
});
