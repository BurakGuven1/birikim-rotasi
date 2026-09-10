import { describe, expect, it } from "vitest";
import { projectInvestment } from "./investment-projection";
import { reserveSummary, EMPTY_EARN_RESERVE } from "./earn-reserve";
import { assessOpportunity, allocateOpportunities } from "./opportunity-investment";

describe("opportunity capital accounting", () => {
  it("keeps BTC below its cap after fees on other assets", () => {
    const result = allocateOpportunities({budgetUsd:0,reserveUsd:1000,portfolioUsd:10000,feeBps:100,minOrderUsd:1,candidates:[
      {key:"bitcoin",score:1,stage:1,currentUsd:3990,cap:.4},
      {key:"foreignEquity",score:.9,stage:1,currentUsd:0,cap:.65},
    ]});
    expect((3990+(result.amounts.bitcoin??0))/(10000-result.costUsd)).toBeLessThanOrEqual(.4);
    expect(result.investedUsd+result.costUsd+result.remainingUsd).toBeCloseTo(1000,8);
    expect(result.amounts.foreignEquity).toBeGreaterThan(0);
  });
  it("includes ten annual bonuses, not eleven, for a December start", () => {
    const result = projectInvestment({ monthlyUsd: 1000, initialUsd: 0, years: 10, nominalReturn: 0, usInflation: 0, trInflation: 0, fxDepreciation: 0, startDate: "2026-12-05", annualUsd: 3500, annualMonth: 4, firstAnnualYear: 2027 });
    expect(result.at(-1)?.contributedUsd).toBe(155000);
    expect(result.at(-1)?.nominalUsd).toBe(155000);
  });
  it("counts rewards once and excludes locked and future balances from available capital", () => {
    const state = { ...EMPTY_EARN_RESERVE, unavailableUsdt: 200, usdPerUsdt: 1, rateAsOf: "2026-09-07", entries: [
      { id: "1", date: "2026-09-06", kind: "deposit" as const, amountUsdt: 1000 },
      { id: "2", date: "2026-09-07", kind: "reward" as const, amountUsdt: .28 },
      { id: "3", date: "2026-12-05", kind: "deposit" as const, amountUsdt: 1000 },
    ] };
    const result = reserveSummary(state, new Date("2026-09-07T12:00:00Z"));
    expect(result.balanceUsdt).toBeCloseTo(1000.28);
    expect(result.availableUsdt).toBeCloseTo(800.28);
    expect(result.rewardsUsdt).toBe(.28);
  });
  it("does not call a short declining history cheap", () => {
    const prices = Array.from({ length: 100 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, i + 1)).toISOString(), close: 100 - i / 2 }));
    expect(assessOpportunity(prices, new Date("2026-05-01")).state).toBe("insufficient");
  });
  it("keeps all capital in reserve without a confirmed entry", () => {
    const result = allocateOpportunities({ budgetUsd: 1000, reserveUsd: 2000, portfolioUsd: 2000, feeBps: 30, minOrderUsd: 25, candidates: [] });
    expect(result.investedUsd).toBe(0);
    expect(result.remainingUsd).toBe(3000);
  });
  it("applies BTC cap to gross derivative exposure as well as spot and conserves cents", () => {
    const result = allocateOpportunities({ budgetUsd: 1000, reserveUsd: 0, portfolioUsd: 10000, feeBps: 30, minOrderUsd: 25, candidates: [{ key: "bitcoin", score: 1, stage: 3, currentUsd: 4200, cap: .4, grossExtraUsd: 200 }] });
    expect(result.investedUsd).toBe(0);
    expect(result.remainingUsd).toBe(1000);
  });
});
