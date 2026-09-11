import { describe, expect, it } from "vitest";
import { buildPortfolioHistory, positionAverageCost } from "./portfolio-history";
import type { Transaction } from "./types";

const buy: Transaction = { id: "1", symbol: "ABC", name: "ABC", assetClass: "foreignEquity", type: "buy", quantity: 2, unitPrice: 100, commission: 2, currency: "USD", date: "2026-01-01" };
const prices = { ABC: { currency: "USD" as const, points: [{ date: "2026-01-01", close: 100 }, { date: "2026-01-02", close: 120 }] } };
const fx = [{ date: "2026-01-01", close: 30 }, { date: "2026-01-02", close: 40 }];

describe("historical portfolio valuation", () => {
  it("fixes cash flows at transaction-date FX and values holdings at each day's FX", () => {
    const rows = buildPortfolioHistory([buy], prices, fx, "2026-01-02");
    expect(rows[0]).toMatchObject({ invested: 6060, value: 6000, profit: -60 });
    expect(rows[1]).toMatchObject({ invested: 6060, value: 9600, profit: 3540 });
  });
  it("deducts net sale proceeds and reduces holdings on the sale date", () => {
    const sale = { ...buy, id: "2", type: "sell" as const, date: "2026-01-02", quantity: 1, unitPrice: 120, commission: 1 };
    expect(buildPortfolioHistory([sale, buy], prices, fx, "2026-01-02")[1]).toMatchObject({ invested: 1300, value: 4800, profit: 3500 });
  });
  it("does not backfill from future prices or invent missing FX", () => {
    const rows = buildPortfolioHistory([buy], { ABC: { ...prices.ABC, points: prices.ABC.points.slice(1) } }, fx.slice(1), "2026-01-02");
    expect(rows[0]).toMatchObject({ invested: null, value: null, profit: null });
    expect(rows[1]).toMatchObject({ invested: null, value: 9600, profit: null });
  });
  it("carries recent closes over holidays but leaves prolonged gaps empty", () => {
    const rows = buildPortfolioHistory([{ ...buy, currency: "TRY" }], { ABC: { currency: "TRY", points: prices.ABC.points.slice(0, 1) } }, [], "2026-01-07");
    expect(rows[2].value).toBe(200);
    expect(rows[6].value).toBeNull();
  });
  it("rejects overselling and keeps a closed position's value at zero", () => {
    expect(() => buildPortfolioHistory([{ ...buy, type: "sell" }], prices, fx, "2026-01-02")).toThrow();
    const sale = { ...buy, id: "2", type: "sell" as const, date: "2026-01-02" };
    expect(buildPortfolioHistory([buy, sale], {}, fx, "2026-01-02")[1].value).toBe(0);
  });
  it("does not infer EUR FX or use current transaction currency as quote currency", () => {
    expect(buildPortfolioHistory([{ ...buy, currency: "EUR" }], prices, fx, "2026-01-01")[0].invested).toBeNull();
    expect(buildPortfolioHistory([buy], {}, fx, "2026-01-01")[0].value).toBeNull();
  });
});

describe("chart position cost", () => {
  it("uses remaining FIFO lots including commissions in the chart currency", () => {
    const second = { ...buy, id: "2", date: "2026-01-02", unitPrice: 200 };
    const sale = { ...buy, id: "3", date: "2026-01-03", type: "sell" as const, quantity: 2 };
    expect(positionAverageCost([buy, second, sale], "USD")).toBe(201);
  });
  it("hides costs for mixed currencies and closed positions", () => {
    expect(positionAverageCost([buy], "TRY")).toBeNull();
    expect(positionAverageCost([buy, { ...buy, id: "2", type: "sell" }], "USD")).toBeNull();
  });
});
