import { describe, expect, it } from "vitest";
import { buildMonthlyInvestment, nextContributionDate, valueInvestmentHoldings, assessInvestmentData } from "./monthly-investment";
import { DEFAULT_INVESTMENT_POLICY } from "./investment-policy";
import type { MarketSnapshot, PricePoint, Transaction } from "./types";
import { normalizeInvestmentPolicy } from "./investment-policy";

const now = new Date("2026-10-05T12:00:00Z");
const policy = { ...DEFAULT_INVESTMENT_POLICY, allocationMode: "legacy" as const, horizonYears: 10, maxDrawdown: 0.3, emergencyMonths: 6, highInterestDebt: false };
const quote: MarketSnapshot = { price: 150, currency: "USD", asOf: now.toISOString(), source: "fixture", status: "fresh" };
const history: PricePoint[] = Array.from({ length: 240 }, (_, i) => ({ date: new Date(now.getTime() - (240 - i) * 86400000).toISOString(), close: 100 + i / 5 }));
const market = Object.fromEntries(["foreignEquity", "commodity", "bitcoin", "turkishEquity"].map(key => [key, { quote: { ...quote, currency: key === "turkishEquity" ? "TRY" : "USD" }, history, source: "fixture" }]));
const input = { budgetUsd: 1000, policy, market, now, currentValues: { foreignEquity: 0, commodity: 0, bitcoin: 0, turkishEquity: 0, cash: 0 }, valuationComplete: true, fxHistory: history.map(p => ({ ...p, close: 40 })) };

describe("monthly investment", () => {
  it("keeps risk blockers when an unrelated stored field is invalid", () => {
    const migrated = normalizeInvestmentPolicy({ ...policy, highInterestDebt: true, hasEmergencyFund: false, feeBps: "30" });
    expect(migrated.highInterestDebt).toBe(true);
    expect(migrated.hasEmergencyFund).toBe(false);
  });
  it("measures crypto momentum over six calendar months", () => {
    const prices = history.map((point, index) => ({ ...point, close: index < 80 ? 200 : index < 130 ? 50 : 100 }));
    const assessment = assessInvestmentData({ quote, history: prices, source: "fixture" }, "bitcoin", now);
    expect(assessment.signal).toBeLessThan(0);
  });
  it("does not value Turkish holdings using a negative exchange rate", () => {
    const tx = [{ id: "1", symbol: "BIST100", name: "TR", assetClass: "turkishEquity", type: "buy", quantity: 2, unitPrice: 80, commission: 0, currency: "TRY", date: "2026-10-01" }] as Transaction[];
    expect(valueInvestmentHoldings(tx, { BIST100: { ...quote, currency: "TRY" } }, -40, 0, now).complete).toBe(false);
  });
  it("starts on October 5 and respects Istanbul midnight and month boundaries", () => {
    expect(nextContributionDate("2026-10-05", 5, new Date("2026-09-07T12:00:00Z"))).toBe("2026-10-05");
    expect(nextContributionDate("2026-10-05", 5, new Date("2026-10-04T22:00:00Z"))).toBe("2026-10-05");
    expect(nextContributionDate("2026-10-05", 5, new Date("2026-12-06T00:00:00Z"))).toBe("2027-01-05");
  });
  it("conserves every cent including costs and reserve", () => {
    const plan = buildMonthlyInvestment({ ...input, budgetUsd: 1000.37 });
    expect(plan.rows.reduce((sum, row) => sum + Math.round(row.amountUsd * 100), 0) + Math.round(plan.costUsd * 100)).toBe(100037);
    expect(plan.rows.reduce((sum, row) => sum + row.contributionWeight, 0) + plan.costUsd / plan.budgetUsd).toBeCloseTo(1, 10);
    expect(plan.rows.find(row => row.key === "bitcoin")!.targetWeight).toBeLessThanOrEqual(0.05);
  });
  it("directs new contributions away from an already overweight crypto position", () => {
    const plan = buildMonthlyInvestment({ ...input, currentValues: { ...input.currentValues, bitcoin: 5000 } });
    expect(plan.rows.find(row => row.key === "bitcoin")!.amountUsd).toBe(0);
    expect(plan.warnings.join(" ")).toContain("Bitcoin");
  });
  it("does not invest with incomplete valuation, insufficient emergency savings or high-interest debt", () => {
    for (const overrides of [{ valuationComplete: false }, { policy: { ...policy, emergencyMonths: 1 } }, { policy: { ...policy, highInterestDebt: true } }]) {
      const plan = buildMonthlyInvestment({ ...input, ...overrides });
      expect(plan.rows.find(row => row.key === "cash")!.amountUsd).toBe(1000);
      expect(plan.status).toBe("blocked");
    }
  });
  it("marks an unanswered profile as a draft", () => {
    expect(buildMonthlyInvestment({ ...input, policy: DEFAULT_INVESTMENT_POLICY }).status).toBe("draft");
  });
  it("holds the full contribution when every feed is missing and rejects nonfinite budgets", () => {
    expect(buildMonthlyInvestment({ ...input, market: {} }).rows.find(row => row.key === "cash")!.amountUsd).toBe(1000);
    expect(() => buildMonthlyInvestment({ ...input, budgetUsd: NaN })).toThrow();
  });
  it("rejects stale, future and weekly data even if a provider calls them fresh", () => {
    for (const asOf of ["2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z", "bad-date"]) {
      expect(assessInvestmentData({ quote: { ...quote, asOf }, history, source: "fixture" }, "foreignEquity", now).usable).toBe(false);
    }
    const weekly = history.map((p, i) => ({ ...p, date: new Date(now.getTime() - (240 - i) * 7 * 86400000).toISOString() }));
    expect(assessInvestmentData({ quote, history: weekly, source: "fixture" }, "foreignEquity", now).usable).toBe(false);
  });
  it("does not interpret a rising TRY index with faster FX depreciation as positive USD momentum", () => {
    const fxHistory = history.map((p, i) => ({ ...p, close: 20 + i / 3 }));
    const plan = buildMonthlyInvestment({ ...input, fxHistory });
    expect(plan.rows.find(row => row.key === "turkishEquity")!.signal).toBeLessThan(0);
  });
  it("uses held units and live currencies rather than future salary for the capital base", () => {
    const tx = [{ id: "1", symbol: "VTI", name: "US", assetClass: "foreignEquity", type: "buy", quantity: 2, unitPrice: 80, commission: 0, currency: "USD", date: "2026-10-01" }] as Transaction[];
    const value = valueInvestmentHoldings(tx, { VTI: quote }, 40, 50, now);
    expect(value.values.foreignEquity).toBe(300);
    expect(value.values.cash).toBe(50);
    expect(value.complete).toBe(true);
    expect(valueInvestmentHoldings(tx, {}, 40, 0, now).complete).toBe(false);
  });
});
