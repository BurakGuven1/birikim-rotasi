import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
const payload = { data: [{ s: "NASDAQ:AAPL", d: ["AAPL", "Apple", 200, "USD", 20, 5, 12, 150, 1000, "Technology", "streaming", 1788825600, 2] }] };
describe("watchlist data fallback", () => {
  it("preserves the basic watchlist if expanded field support fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("unsupported column", { status: 400 })).mockResolvedValueOnce(Response.json(payload)));
    const { refreshStockWatchlist } = await import("./stock-watchlist-service");
    const result = await refreshStockWatchlist("US");
    expect(result.rows[0].symbol).toBe("AAPL");
    expect(result.rows[0].fundamentals).toBeUndefined();
    expect(result.fundamentalsWarning).toContain("Temel veri");
  });
  it("does not retry a rate limit and pretend a new snapshot exists", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rate limit", { status: 429 })));
    const { refreshStockWatchlist } = await import("./stock-watchlist-service");
    await expect(refreshStockWatchlist("US")).rejects.toThrow("istek sınırına");
  });
});
