import { describe, expect, it } from "vitest";
import { rankStockOpportunities, opportunityChanges, skippedMonthReturn } from "./stock-opportunities";
import type { StockRow, StockSnapshot } from "./stock-watchlist";

const now = new Date("2026-09-08T12:00:00Z");
function row(i: number, sector = "Technology services"): StockRow {
  return { symbol: `S${i}`, ticker: `S${i}`, name: `Stock ${i}`, market: "US", sector, scannerSymbol: `NASDAQ:S${i}`, currency: "USD", price: 100, change: 0, pe: 10 + i, pb: 1 + i, evEbitda: 5 + i, marketCap: 1e9, sma200Weekly: 50, smaDistance: 100, priceAsOf: "2026-09-08T10:00:00Z", delayMinutes: 15,
    fundamentals: { industry: "Software", roe: 30 - i, roa: 10, roic: 25 - i, debt: 100, ebitda: 100, priceFcf: 10 + i, operatingCashflow: 150 - i, netIncome: 100, epsGrowth: 10, revenueGrowth: 5, perf1m: 0, perf6m: 30 - i, perf12m: 50 - i, reportedAt: "2026-08-01T12:00:00Z", fScore: 8 } };
}
function snapshot(rows = Array.from({ length: 10 }, (_, i) => row(i))): StockSnapshot { return { market: "US", rows, fetchedAt: now.toISOString(), source: "test" }; }

describe("long-term opportunity screening", () => {
  it("ranks stronger quality and cheaper peers first without requiring a price below SMA", () => {
    const result = rankStockOpportunities(snapshot(), now);
    expect(result.candidates[0].stock.symbol).toBe("S0");
    expect(result.candidates[0].score).toBeGreaterThan(result.candidates.at(-1)!.score);
    expect(result.candidates[0].recovery).toBe("supported");
    expect(result.validation).toBe("unvalidated");
  });
  it("uses compounded 6–1 momentum rather than subtracting returns", () => {
    expect(skippedMonthReturn(32, 10)).toBeCloseTo(20);
    expect(skippedMonthReturn(10, -100)).toBeNull();
  });
  it("does not reward a cheap company with negative free cash flow", () => {
    const data = snapshot(); data.rows[0].fundamentals!.priceFcf = -1;
    const result = rankStockOpportunities(data, now);
    expect(result.candidates.some(c => c.stock.symbol === "S0")).toBe(false);
    expect(result.excluded.find(c => c.symbol === "S0")?.reasons.join(" ")).toContain("nakit");
  });
  it("rejects debt-heavy and deteriorating companies despite cheap multiples", () => {
    const data = snapshot(); data.rows[0].fundamentals!.debt = 900; data.rows[1].fundamentals!.epsGrowth = -30;
    const result = rankStockOpportunities(data, now);
    expect(result.candidates.map(c => c.stock.symbol)).not.toContain("S0");
    expect(result.candidates.map(c => c.stock.symbol)).not.toContain("S1");
  });
  it("fails closed for missing fundamentals and a thin peer group", () => {
    const data = snapshot(); delete data.rows[0].fundamentals;
    expect(rankStockOpportunities(data, now).excluded.find(c => c.symbol === "S0")?.reasons.join(" ")).toContain("eksik");
    expect(rankStockOpportunities(snapshot([row(1), row(2)]), now).candidates).toHaveLength(0);
  });
  it("rejects stale retrieval, stale price and future release times", () => {
    const old = snapshot(); old.fetchedAt = "2026-08-01T12:00:00Z";
    expect(rankStockOpportunities(old, now).candidates).toHaveLength(0);
    const data = snapshot(); data.rows[0].priceAsOf = "2026-08-01T12:00:00Z"; data.rows[1].fundamentals!.reportedAt = "2026-10-01T12:00:00Z";
    expect(rankStockOpportunities(data, now).candidates.map(c => c.stock.symbol)).not.toEqual(expect.arrayContaining(["S0", "S1"]));
    expect(rankStockOpportunities(data, now).excluded.map(c => c.symbol)).toEqual(expect.arrayContaining(["S0", "S1"]));
  });
  it("accepts a dated source quote update without inventing a last trade time", () => {
    const data = snapshot(); data.rows.forEach(r => { r.priceUpdatedAt = r.priceAsOf; r.priceAsOf = null; });
    const candidate = rankStockOpportunities(data, now).candidates[0];
    expect(candidate.stock.symbol).toBe("S0");
    expect(candidate.stock.priceAsOf).toBeNull();
  });
  it("does not change sector value scores when unrelated sector multiples change", () => {
    const data = snapshot([...Array.from({ length: 10 }, (_, i) => row(i)), ...Array.from({ length: 10 }, (_, i) => row(i + 20, "Energy minerals"))]);
    const before = rankStockOpportunities(data, now).candidates.find(c => c.stock.symbol === "S0")!.value;
    data.rows.filter(r => r.sector === "Energy minerals").forEach(r => { r.pe = 1; r.evEbitda = 1; });
    expect(rankStockOpportunities(data, now).candidates.find(c => c.stock.symbol === "S0")!.value).toBe(before);
  });
  it("uses bank-specific inputs and does not penalize absent bank EBITDA/cash flow", () => {
    const rows = Array.from({ length: 10 }, (_, i) => { const r = row(i, "Finance"); r.fundamentals = { ...r.fundamentals!, industry: "Major Banks", roa: 2 - i / 10, ebitda: null, priceFcf: null, operatingCashflow: null, fScore: null }; r.evEbitda = null; return r; });
    const result = rankStockOpportunities(snapshot(rows), now);
    expect(result.candidates[0].model).toBe("bank");
    expect(result.candidates[0].limitations.join(" ")).toContain("sermaye yeterliliği");
  });
  it("does not run banks' model on insurance, REITs or holding companies", () => {
    const rows = Array.from({ length: 10 }, (_, i) => { const r = row(i, "Finance"); r.fundamentals!.industry = "Investment Managers"; return r; });
    expect(rankStockOpportunities(snapshot(rows), now).candidates).toHaveLength(0);
  });
  it("does not fill 20 places or amplify a single sector", () => {
    expect(rankStockOpportunities(snapshot(), now).candidates.length).toBeLessThanOrEqual(5);
    const rows = Array.from({ length: 6 }, (_, s) => Array.from({ length: 10 }, (_, i) => ({ ...row(i, `Sector ${s}`), symbol: `S${s}-${i}`, ticker: `S${s}-${i}` }))).flat();
    const result = rankStockOpportunities(snapshot(rows), now);
    expect(result.candidates).toHaveLength(20);
    expect(new Set(result.candidates.map(c => c.stock.symbol)).size).toBe(20);
    expect(result.candidates.every((c, i, all) => i === 0 || all[i - 1].score >= c.score)).toBe(true);
  });
  it("distinguishes deterioration from a rank/sector-cap exit", () => {
    const before = snapshot(); before.fetchedAt = "2026-09-08T11:00:00Z"; const after = snapshot(); after.rows[0].fundamentals!.operatingCashflow = -50;
    const changes = opportunityChanges(before, after, now);
    expect(changes.find(c => c.symbol === "S0")?.reason).toContain("nakit");
  });
  it("deduplicates symbols and excludes wrong-market rows and non-finite fundamentals", () => {
    const data = snapshot(); data.rows.push(structuredClone(data.rows[0])); data.rows[1].market = "TR"; data.rows[2].fundamentals!.roe = Infinity;
    const result = rankStockOpportunities(data, now);
    expect(result.candidates.filter(c => c.stock.symbol === "S0")).toHaveLength(1);
    expect(result.candidates.map(c => c.stock.symbol)).not.toContain("S1");
    expect(result.candidates.map(c => c.stock.symbol)).not.toContain("S2");
  });
});
