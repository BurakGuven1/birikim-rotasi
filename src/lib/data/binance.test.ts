import { afterEach, describe, expect, it, vi } from "vitest";
import { binanceProvider, getFundingHistory } from "./binance";

afterEach(() => vi.unstubAllGlobals());

describe("Binance market data", () => {
  it("pages futures klines and removes the still-open candle", async () => {
    const now = Date.now(); let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return new Response(JSON.stringify(calls === 1
        ? [[now - 20_000, "1", "2", "1", "2", "3", now - 10_000], [now - 9_000, "2", "3", "2", "3", "4", now + 60_000]]
        : []));
    });
    const points = await binanceProvider.getHistory("ETH", "1y", { market: "futures", interval: "4h", from: now - 30_000, to: now });
    expect(points).toHaveLength(1);
    expect(points[0].close).toBe(2);
  });

  it("pages funding history without duplicating page boundaries", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(++calls === 1
      ? [{ fundingTime: 1000, fundingRate: "0.001", markPrice: "10" }, { fundingTime: 2000, fundingRate: "0.002", markPrice: "11" }]
      : [])));
    const rows = await getFundingHistory("BTC", 0, 3000);
    expect(rows.map(row => row.time)).toEqual([new Date(1000).toISOString(), new Date(2000).toISOString()]);
  });
});
