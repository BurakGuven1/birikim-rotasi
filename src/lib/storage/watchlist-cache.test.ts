// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { readWatchlistCache, saveWatchlistCache, readPreviousWatchlistCache, savePreviousWatchlistCache } from "./watchlist-cache";
import { parseScannerRows, FUNDAMENTAL_COLUMNS, type StockSnapshot } from "../domain/stock-watchlist";

beforeEach(() => localStorage.clear());
const base = ["AAPL", "Apple", 200, "USD", 20, 5, 12, 150, 1000, "Technology", "streaming", 1788825600, 2];
function snapshot(expanded = true): StockSnapshot {
  const fields: Record<string, unknown> = { industry: "Software", return_on_equity: 20, total_debt_fq: 0, earnings_release_date: 1785443580 };
  return { market: "US", fetchedAt: "2026-09-08T10:00:00Z", source: "test", rows: parseScannerRows({ data: [{ s: "NASDAQ:AAPL", d: expanded ? [...base, ...FUNDAMENTAL_COLUMNS.map(k => fields[k] ?? null)] : base }] }, "US") };
}
describe("watchlist snapshot persistence", () => {
  it("preserves fundamentals instead of stripping fields on reload", () => {
    saveWatchlistCache({ US: snapshot() });
    expect(readWatchlistCache().US?.rows[0].fundamentals).toMatchObject({ roe: 20, debt: 0, industry: "Software" });
  });
  it("loads old v1 snapshots without inventing fundamentals", () => {
    saveWatchlistCache({ US: snapshot(false) });
    expect(readWatchlistCache().US?.rows[0].fundamentals).toBeUndefined();
  });
  it("keeps previous snapshots independent of the current snapshot", () => {
    savePreviousWatchlistCache({ US: snapshot() });
    saveWatchlistCache({ US: { ...snapshot(), fetchedAt: "2026-09-08T11:00:00Z" } });
    expect(readPreviousWatchlistCache().US?.fetchedAt).toBe("2026-09-08T10:00:00Z");
    expect(readWatchlistCache().US?.fetchedAt).toBe("2026-09-08T11:00:00Z");
  });
});
