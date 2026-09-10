import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getHistory, getProviderStatus, getQuote, resolveQuote } from "./market-service";
import type { MarketDataProvider } from "./provider";

beforeEach(() => { vi.useFakeTimers({toFake:["Date"]}); vi.setSystemTime(new Date("2026-09-07T00:00:00Z")); });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("resolveQuote", () => {
  it("falls back to the next provider after a provider error", async () => {
    const failing: MarketDataProvider = {
      id: "failing",
      supports: () => true,
      getQuote: async () => { throw new Error("down"); },
      getHistory: async () => [],
    };
    const working: MarketDataProvider = {
      id: "working",
      supports: () => true,
      getQuote: async () => ({ price: 100, currency: "TRY", asOf: "2026-09-01T10:00:00Z", source: "working", status: "fresh" }),
      getHistory: async () => [],
    };
    const result = await resolveQuote("TEST", [failing, working]);
    expect(result.source).toBe("working");
    expect(result.price).toBe(100);
  });

  it("returns a marked stale cache only when every live source fails", async () => {
    const failing: MarketDataProvider = {
      id: "failing",
      supports: () => true,
      getQuote: async () => { throw new Error("down"); },
      getHistory: async () => [],
    };
    const result = await resolveQuote("TEST", [failing], {
      price: 90, currency: "TRY", asOf: "2026-08-30T10:00:00Z", source: "cache", status: "fresh",
    });
    expect(result.status).toBe("stale");
    expect(result.source).toContain("önbellek");
  });

  it("uses authenticated EODHD quotes and maps internal symbols", async () => {
    vi.stubEnv("EODHD_API_KEY", "test-eodhd-key");
    vi.stubEnv("ALPHA_VANTAGE_API_KEY", "");
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.includes("eodhd.com/api/real-time/VOO.US")) throw new Error(`Unexpected URL: ${url}`);
      return new Response(JSON.stringify({
        code: "VOO.US",
        timestamp: Math.floor(Date.now() / 1000),
        close: 701.25,
        previousClose: 695,
        change_p: 0.8993,
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const quote = await getQuote("VOO");

    expect(quote).toMatchObject({ price: 701.25, currency: "USD", source: "EODHD", changePercent: 0.8993 });
  });

  it("uses EODHD end-of-day history with OHLCV values", async () => {
    vi.stubEnv("EODHD_API_KEY", "test-eodhd-key");
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.includes("eodhd.com/api/eod/VOO.US")) throw new Error(`Unexpected URL: ${url}`);
      return new Response(JSON.stringify(Array.from({ length: 366 }, (_, index) => ({
        date: new Date(Date.UTC(2025, 8, 7 + index)).toISOString().slice(0, 10),
        open: 696, high: 702, low: 695, close: 701.25, volume: 4_000_000,
      }))), { status: 200, headers: { "content-type": "application/json" } });
    });

    const history = await getHistory("VOO", "1y");

    expect(history.source).toBe("EODHD");
    expect(history.points[0]).toEqual({ date: "2025-09-07T00:00:00Z", open: 696, high: 702, low: 695, close: 701.25, volume: 4_000_000 });
  });

  it("falls back to Alpha Vantage when EODHD is not configured", async () => {
    vi.stubEnv("EODHD_API_KEY", "");
    vi.stubEnv("ALPHA_VANTAGE_API_KEY", "test-alpha-key");
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.includes("alphavantage.co/query") || !url.includes("function=GLOBAL_QUOTE")) throw new Error(`Unexpected URL: ${url}`);
      return new Response(JSON.stringify({
        "Global Quote": {
          "01. symbol": "BND",
          "05. price": "75.4200",
          "07. latest trading day": "2026-09-01",
          "08. previous close": "75.0000",
          "10. change percent": "0.5600%",
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const quote = await getQuote("BND");

    expect(quote).toMatchObject({ price: 75.42, currency: "USD", source: "Alpha Vantage", changePercent: 0.56 });
  });

  it("reports only the configured provider stack", () => {
    vi.stubEnv("EODHD_API_KEY", "test-eodhd-key");
    vi.stubEnv("ALPHA_VANTAGE_API_KEY", "test-alpha-key");
    const statuses = getProviderStatus();

    expect(statuses.map((provider) => provider.name)).toEqual([
      "Binance Public",
      "Massive",
      "EODHD",
      "Alpha Vantage",
      "FRED",
      "Yahoo-compatible",
      "Stooq",
    ]);
    expect(statuses.find((provider) => provider.name === "EODHD")?.active).toBe(true);
  });

  it("rejects a non-empty provider response when it does not cover the requested months", async () => {
    vi.stubEnv("EODHD_API_KEY", "test-eodhd-key");
    vi.stubEnv("ALPHA_VANTAGE_API_KEY", "");
    const shortRows = Array.from({ length: 13 }, (_, index) => ({
      date: new Date(Date.UTC(2025, 8 + index, 1)).toISOString().slice(0, 10),
      close: 100 + index,
    }));
    const completeTimestamps = Array.from({ length: 1096 }, (_, index) => Date.UTC(2023, 8, 7 + index) / 1000);
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("eodhd.com/api/eod/XU100.INDX")) return new Response(JSON.stringify(shortRows), { status: 200 });
      if (url.includes("query1.finance.yahoo.com") && url.includes("XU100.IS")) return new Response(JSON.stringify({ chart: { result: [{
        meta: { regularMarketPrice: 12000, currency: "TRY" },
        timestamp: completeTimestamps,
        indicators: { quote: [{ close: completeTimestamps.map((_, index) => 9000 + index * 100) }] },
      }], error: null } }), { status: 200 });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const history = await getHistory("BIST100", "3y");

    expect(history.source).toBe("Yahoo Finance (anahtarsız)");
    expect(new Set(history.points.map((point) => point.date.slice(0, 7))).size).toBeGreaterThanOrEqual(36);
  });

  it("requires a full ten years of daily observations when max is requested", async () => {
    vi.stubEnv("EODHD_API_KEY", "test-eodhd-key");
    vi.stubEnv("ALPHA_VANTAGE_API_KEY", "");
    const rows = (months: number, startYear: number) => Array.from({ length: months }, (_, index) => ({
      date: new Date(Date.UTC(startYear, index, 1)).toISOString().slice(0, 10),
      close: 100 + index,
    }));
    const complete = Array.from({length:3653},(_,index)=>({date:new Date(Date.UTC(2016,8,7+index)).toISOString().slice(0,10),close:100+index}));
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("eodhd.com/api/eod/XU100.INDX")) return new Response(JSON.stringify(rows(60, 2021)), { status: 200 });
      if (url.includes("query1.finance.yahoo.com") && url.includes("XU100.IS")) return new Response(JSON.stringify({ chart: { result: [{
        meta: { regularMarketPrice: 12000, currency: "TRY" },
        timestamp: complete.map((row) => Date.parse(row.date) / 1000),
        indicators: { quote: [{ close: complete.map((row) => row.close) }] },
      }], error: null } }), { status: 200 });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const history = await getHistory("BIST100", "max");

    expect(history.source).toBe("Yahoo Finance (anahtarsız)");
    expect(new Set(history.points.map((point) => point.date.slice(0, 7))).size).toBeGreaterThanOrEqual(120);
  });

  it("returns explicit partial coverage when the caller allows it", async () => {
    vi.stubEnv("MASSIVE_API_KEY", "");
    vi.stubEnv("EODHD_API_KEY", "");
    vi.stubEnv("ALPHA_VANTAGE_API_KEY", "");
    const timestamps = Array.from({ length: 12 }, (_, index) => Date.UTC(2025, index, 1) / 1000);
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      if (!String(input).includes("query1.finance.yahoo.com")) throw new Error("fallback unavailable");
      return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 1, currency: "USD" }, timestamp: timestamps, indicators: { quote: [{ close: timestamps.map(() => 1) }] } }], error: null } }));
    });
    const result = await getHistory("UNKNOWN", "10y", { allowPartial: true });
    expect(result.coverage).toMatchObject({ complete: false, partial: true, coveredMonths: 12, requestedMonths: 120 });
  });

  it("does not use daily fallback providers for an explicit futures 4h request", async () => {
    const now = Date.now();
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.includes("fapi.binance.com/fapi/v1/klines")) throw new Error(`Unexpected fallback: ${url}`);
      return new Response(JSON.stringify([[now - 8 * 3_600_000, "1", "2", "1", "2", "3", now - 4 * 3_600_000]]));
    });
    const result = await getHistory("BTC", "1y", { interval: "4h", market: "futures", from: now - 12 * 3_600_000, to: now, allowPartial: true });
    expect(result.source).toBe("Binance Public");
    expect(result.coverage).toMatchObject({ interval: "4h", market: "futures", observations: 1, complete: false });
  });
});
