import { describe, expect, it } from "vitest";
import {
  closeTacticalTrade,
  createPlannedTrade,
  openTacticalTrade,
} from "./tactical-trade-repository";
import type { TacticalSetup } from "../domain/tactical";

const setup: TacticalSetup = {
  id: "SP500-2026-09-04",
  symbol: "SP500",
  name: "S&P 500",
  action: "long",
  generatedAt: "2026-09-04T00:00:00.000Z",
  expiresAt: "2026-09-11T00:00:00.000Z",
  entryZone: [99, 101],
  invalidation: 95,
  targetZones: [110, 115],
  riskReward: 2,
  confidence: 0.8,
  positionSizeUsd: 2_000,
  portfolioRiskUsd: 100,
  reasons: ["Trend pozitif."],
};

describe("tactical trade journal transitions", () => {
  it("freezes the generated setup inside a planned journal row", () => {
    const trade = createPlannedTrade(setup, "trade-1");

    setup.reasons.push("Sonradan değişti.");
    expect(trade.status).toBe("planned");
    expect(JSON.parse(trade.setupSnapshot).reasons).toEqual(["Trend pozitif."]);
    expect(trade.plannedEntry).toBe(100);
  });

  it("opens a planned trade at the actual fill without rewriting its plan", () => {
    const planned = createPlannedTrade(setup, "trade-2");
    const opened = openTacticalTrade(planned, 100.5, "2026-09-05T12:00:00.000Z");

    expect(opened).toMatchObject({ status: "open", actualEntry: 100.5, openedAt: "2026-09-05T12:00:00.000Z", plannedEntry: 100 });
  });

  it("closes an open trade and calculates realized dollar profit", () => {
    const opened = openTacticalTrade(createPlannedTrade(setup, "trade-3"), 100, "2026-09-05T12:00:00.000Z");
    const closed = closeTacticalTrade(opened, 110, "2026-09-20T12:00:00.000Z");

    expect(closed).toMatchObject({ status: "closed", actualExit: 110, realizedPnlUsd: 200 });
  });

  it("rejects invalid state transitions", () => {
    const planned = createPlannedTrade(setup, "trade-4");

    expect(() => closeTacticalTrade(planned, 110, "2026-09-20T12:00:00.000Z")).toThrow("Yalnızca açık işlem kapatılabilir");
  });
});
