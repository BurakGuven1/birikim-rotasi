import { afterEach, describe, expect, it, vi } from "vitest";
import { yahooProvider } from "./yahoo";

afterEach(() => vi.unstubAllGlobals());

describe("Yahoo history symbols", () => {
  it("uses BTC-USD rather than an unrelated BTC ticker", async () => {
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.includes("/BTC-USD?")) throw new Error(`Unexpected URL: ${url}`);
      return new Response(JSON.stringify({ chart: { result: [{
        meta: { regularMarketPrice: 80_000, currency: "USD" },
        timestamp: [Date.UTC(2026, 8, 1) / 1000],
        indicators: { quote: [{ close: [80_000] }] },
      }], error: null } }), { status: 200 });
    });

    const points = await yahooProvider.getHistory("BTC", "10y");

    expect(points[0].close).toBe(80_000);
  });
});
