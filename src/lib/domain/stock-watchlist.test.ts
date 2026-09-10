import { describe, expect, it } from "vitest";
import { parseScannerRows, scannerRequest, validateWatchlistTrade, FUNDAMENTAL_COLUMNS } from "./stock-watchlist";
import type { Transaction } from "./types";

describe("stock watchlist", () => {
  it("requests weekly SMA200 and a bounded market-cap US stock universe", () => {
    const request = scannerRequest("US");
    expect(request.columns).toContain("SMA200|1W");
    expect(request.columns).not.toContain("SMA200");
    expect(request.range).toEqual([0, 100]);
    expect(request.sort.sortBy).toBe("market_cap_basic");
    expect(scannerRequest("TR").symbols).toEqual({ symbolset: ["SYML:BIST;XU100"] });
  });
  it("maps BIST symbols, keeps missing ratios unknown and distinguishes retrieval from price time", () => {
    const rows = parseScannerRows({ data: [{ s: "BIST:THYAO", d: ["THYAO", "Turk Hava Yollari", 300, "TRY", null, .8, -2, 250, 1234, "Transportation", "delayed_streaming_900", null, 2] }] }, "TR");
    expect(rows[0]).toMatchObject({ symbol: "THYAO.IS", price: 300, pe: null, pb: .8, evEbitda: null, sma200Weekly: 250, smaDistance: 20, priceAsOf: null, delayMinutes: 15 });
  });
  it("rejects malformed payloads and wrong-market/currency rows", () => {
    expect(() => parseScannerRows({ error: "bad" }, "US")).toThrow();
    expect(parseScannerRows({ data: [{ s: "BIST:THYAO", d: ["THYAO", "Turk", 30, "USD"] }] }, "US")).toEqual([]);
  });
  it("does not coerce null, string or non-finite numbers into zero", () => {
    const rows = parseScannerRows({ data: [{ s: "NASDAQ:AAPL", d: ["AAPL", "Apple", null, "USD", "0", NaN, Infinity, 0, 123, "Technology", "streaming", null, null] }] }, "US");
    expect(rows[0]).toMatchObject({ price: null, pe: null, pb: null, evEbitda: null, sma200Weekly: null, smaDistance: null });
  });
  it("keeps signed cash flow and growth, maps TTM debt inputs and the reported release date", () => {
    const base = ["AAPL", "Apple", 200, "USD", 20, 5, 12, 150, 1000, "Electronic technology", "streaming", 1788825600, 2];
    const fundamentals: Record<string, unknown> = { industry: "Telecommunications equipment", return_on_equity: 25, return_on_assets: 10, return_on_invested_capital: 18, total_debt_fq: 0, ebitda_ttm: 100, price_free_cash_flow_ttm: -20, cash_f_operating_activities_ttm: -30, net_income_ttm: 50, earnings_per_share_diluted_yoy_growth_ttm: -10, total_revenue_yoy_growth_ttm: 0, "Perf.1M": 5, "Perf.6M": 20, "Perf.Y": 30, earnings_release_date: 1785443580, piotroski_f_score_ttm: 7 };
    const [row] = parseScannerRows({ data: [{ s: "NASDAQ:AAPL", d: [...base, ...FUNDAMENTAL_COLUMNS.map(key => fundamentals[key] ?? null)] }] }, "US");
    expect(row.fundamentals).toMatchObject({ roe: 25, roic: 18, debt: 0, ebitda: 100, priceFcf: -20, operatingCashflow: -30, epsGrowth: -10, revenueGrowth: 0, fScore: 7, reportedAt: new Date(1785443580000).toISOString() });
  });
  it("keeps source update time separate when the feed omits last trade time", () => {
    const base = ["AAPL", "Apple", 200, "USD", 20, 5, 12, 150, 1000, "Technology", "streaming", null, 2];
    const [row] = parseScannerRows({ data: [{ s: "NASDAQ:AAPL", d: [...base, ...FUNDAMENTAL_COLUMNS.map(key => key === "update_time" ? 1788566398 : null)] }] }, "US");
    expect(row.priceAsOf).toBeNull();
    expect(row.priceUpdatedAt).toBe(new Date(1788566398000).toISOString());
  });
});

const buy: Transaction = { id: "1", symbol: "AAPL", name: "Apple", assetClass: "foreignEquity", type: "buy", quantity: 2, unitPrice: 100, currency: "USD", commission: 1, date: "2026-01-02" };
describe("watchlist portfolio actions", () => {
  it("allows a partial sale and rejects overselling including backdated sales", () => {
    const sell = { ...buy, id: "2", type: "sell" as const, date: "2026-01-03", quantity: 1 };
    expect(() => validateWatchlistTrade([buy], sell, "2026-02-01")).not.toThrow();
    expect(() => validateWatchlistTrade([buy], { ...sell, quantity: 3 }, "2026-02-01")).toThrow();
    expect(() => validateWatchlistTrade([buy], { ...sell, date: "2026-01-01" }, "2026-02-01")).toThrow();
  });
  it("rejects NaN, future dates and impossible calendar dates", () => {
    expect(() => validateWatchlistTrade([], { ...buy, quantity: NaN }, "2026-02-01")).toThrow();
    expect(() => validateWatchlistTrade([], { ...buy, date: "2027-01-01" }, "2026-02-01")).toThrow();
    expect(() => validateWatchlistTrade([], { ...buy, date: "2026-02-30" }, "2026-03-01")).toThrow();
  });
});
