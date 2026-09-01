import { describe, expect, it } from "vitest";
import { calculatePortfolio } from "./portfolio";

describe("calculatePortfolio", () => {
  it("uses FIFO lots and includes commissions in realized and unrealized profit", () => {
    const summary = calculatePortfolio(
      [
        { id: "1", symbol: "TEST", name: "Test", assetClass: "foreignEquity", type: "buy", quantity: 10, unitPrice: 100, currency: "TRY", commission: 10, date: "2026-01-01" },
        { id: "2", symbol: "TEST", name: "Test", assetClass: "foreignEquity", type: "buy", quantity: 5, unitPrice: 120, currency: "TRY", commission: 5, date: "2026-02-01" },
        { id: "3", symbol: "TEST", name: "Test", assetClass: "foreignEquity", type: "sell", quantity: 8, unitPrice: 150, currency: "TRY", commission: 8, date: "2026-03-01" },
      ],
      { TEST: { price: 140, currency: "TRY", asOf: "2026-09-01", source: "test", status: "fresh" } },
      { TRY: 1 },
    );

    expect(summary.investedCapital).toBe(423);
    expect(summary.currentValue).toBe(980);
    expect(summary.realizedProfit).toBe(384);
    expect(summary.unrealizedProfit).toBe(173);
    expect(summary.totalProfit).toBe(557);
    expect(summary.holdings[0].quantity).toBe(7);
  });

  it("marks holdings without a current quote instead of inventing a value", () => {
    const summary = calculatePortfolio(
      [{ id: "1", symbol: "MISS", name: "Eksik", assetClass: "commodity", type: "buy", quantity: 1, unitPrice: 100, currency: "TRY", commission: 0, date: "2026-01-01" }],
      {},
      { TRY: 1 },
    );
    expect(summary.holdings[0].marketValue).toBeNull();
    expect(summary.missingQuotes).toEqual(["MISS"]);
  });
});
