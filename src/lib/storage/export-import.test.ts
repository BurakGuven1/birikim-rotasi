import { describe, expect, it } from "vitest";
import { exportPortfolioJson, exportTransactionsCsv, parsePortfolioJson } from "./export-import";

const transaction = {
  id: "tx-1",
  symbol: "BTC",
  name: "Bitcoin",
  assetClass: "bitcoin" as const,
  type: "buy" as const,
  quantity: 0.01,
  unitPrice: 2_000_000,
  currency: "TRY" as const,
  commission: 25,
  date: "2026-09-01",
};

describe("portfolio export and import", () => {
  it("round-trips a versioned JSON backup", () => {
    const json = exportPortfolioJson([transaction]);
    expect(parsePortfolioJson(json)).toEqual([transaction]);
  });

  it("rejects malformed backup data instead of partially importing it", () => {
    expect(() => parsePortfolioJson('{"version":1,"transactions":[{"symbol":"BTC"}]}')).toThrow("Geçersiz");
  });

  it("escapes CSV fields that contain separators", () => {
    const csv = exportTransactionsCsv([{ ...transaction, name: "Bitcoin, spot" }]);
    expect(csv).toContain('"Bitcoin, spot"');
  });
});
