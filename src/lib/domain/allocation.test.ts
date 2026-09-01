import { describe, expect, it } from "vitest";
import { buildAllocation } from "./allocation";

describe("buildAllocation", () => {
  it("keeps neutral weights and distributes the complete budget when signals are neutral", () => {
    const result = buildAllocation({
      monthlyBudget: 50_000,
      signals: { foreignEquity: 0, commodity: 0, bitcoin: 0, turkishEquity: 0 },
      confidence: { foreignEquity: 1, commodity: 1, bitcoin: 1, turkishEquity: 1 },
    });

    expect(result.items.map((item) => item.weight)).toEqual([0.35, 0.25, 0.2, 0.2]);
    expect(result.items.reduce((sum, item) => sum + item.amount, 0)).toBe(50_000);
  });

  it("respects class limits and monthly turnover under extreme signals", () => {
    const result = buildAllocation({
      monthlyBudget: 50_000,
      signals: { foreignEquity: -1, commodity: -1, bitcoin: 1, turkishEquity: -1 },
      confidence: { foreignEquity: 1, commodity: 1, bitcoin: 1, turkishEquity: 1 },
      previousWeights: { foreignEquity: 0.35, commodity: 0.25, bitcoin: 0.2, turkishEquity: 0.2 },
    });

    const bitcoin = result.items.find((item) => item.assetClass === "bitcoin")!;
    expect(bitcoin.weight).toBeLessThanOrEqual(0.3);
    expect(bitcoin.weight).toBeLessThanOrEqual(0.35);
    expect(result.items.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(1, 8);
  });
});
