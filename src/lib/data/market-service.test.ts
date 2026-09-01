import { describe, expect, it } from "vitest";
import { resolveQuote } from "./market-service";
import type { MarketDataProvider } from "./provider";

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
});
