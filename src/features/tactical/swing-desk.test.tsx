import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_STRATEGY_PROFILE } from "@/lib/domain/strategy";
import type { TacticalSetup } from "@/lib/domain/tactical";
import { createPlannedTrade } from "@/lib/storage/tactical-trade-repository";
import { SwingDeskView } from "./swing-desk";

const setup: TacticalSetup = {
  id: "BTC-2026-09-04",
  symbol: "BTC",
  name: "Bitcoin",
  action: "long",
  generatedAt: "2026-09-04T00:00:00.000Z",
  expiresAt: "2026-09-11T00:00:00.000Z",
  entryZone: [78_000, 80_000],
  invalidation: 74_000,
  targetZones: [90_000, 96_000],
  riskReward: 2.2,
  confidence: 0.75,
  positionSizeUsd: 2_000,
  portfolioRiskUsd: 100,
  reasons: ["Trend pozitif.", "Momentum pozitif."],
};

describe("swing desk", () => {
  it("renders risk controls, complete setup levels and the immutable journal", () => {
    const availableHtml = renderToStaticMarkup(<SwingDeskView
      profile={DEFAULT_STRATEGY_PROFILE}
      setups={[setup]}
      trades={[]}
      loading={false}
      errors={[]}
      onPlan={() => undefined}
      onOpen={() => undefined}
      onClose={() => undefined}
      onRemove={() => undefined}
    />);
    const journalHtml = renderToStaticMarkup(<SwingDeskView
      profile={DEFAULT_STRATEGY_PROFILE}
      setups={[setup]}
      trades={[createPlannedTrade(setup, "trade-1")]}
      loading={false}
      errors={[]}
      onPlan={() => undefined}
      onOpen={() => undefined}
      onClose={() => undefined}
      onRemove={() => undefined}
    />);

    expect(availableHtml).toContain("Swing masası");
    expect(availableHtml).toContain("İşlem başına risk");
    expect(availableHtml).toContain("%0,50");
    expect(availableHtml).toContain("Geçersizleşme");
    expect(availableHtml).toContain("Hedef 1");
    expect(availableHtml).toContain("Planı günlüğe ekle");
    expect(journalHtml).toContain("Planlandı");
    expect(journalHtml).toContain("Günlükte mevcut");
  });
});
