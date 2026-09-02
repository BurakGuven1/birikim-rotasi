import { describe, expect, it } from "vitest";
import { averageAllocationWeights, blendAllocationWeights, buildAllocation, buildHybridAllocation } from "./allocation";

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

  it("can materially overweight bitcoin when opportunity strength and data confidence are both high", () => {
    const result = buildAllocation({
      monthlyBudget: 50_000,
      signals: { foreignEquity: -0.5, commodity: -0.5, bitcoin: 1, turkishEquity: -0.5 },
      confidence: { foreignEquity: 1, commodity: 1, bitcoin: 1, turkishEquity: 1 },
    });

    const bitcoin = result.items.find((item) => item.assetClass === "bitcoin")!;
    expect(bitcoin.weight).toBeGreaterThan(0.35);
    expect(bitcoin.weight).toBeLessThanOrEqual(0.45);
  });
});

describe("hybrid monthly allocation", () => {
  it("uses the balanced consensus as 70% core and the dynamic model as 30% tilt", () => {
    const balanced = { foreignEquity: 0.3, commodity: 0.3, bitcoin: 0.15, turkishEquity: 0.25 };
    const dynamic = { foreignEquity: 0.4, commodity: 0.2, bitcoin: 0.25, turkishEquity: 0.15 };

    const result = blendAllocationWeights(balanced, dynamic);

    expect(result.foreignEquity).toBeCloseTo(0.33, 8);
    expect(result.commodity).toBeCloseTo(0.27, 8);
    expect(result.bitcoin).toBeCloseTo(0.18, 8);
    expect(result.turkishEquity).toBeCloseTo(0.22, 8);
  });

  it("enforces the live purchase limits after blending", () => {
    const concentrated = { foreignEquity: 0, commodity: 0, bitcoin: 1, turkishEquity: 0 };

    const result = blendAllocationWeights(concentrated, concentrated);

    expect(result.bitcoin).toBe(0.45);
    expect(result.foreignEquity).toBeGreaterThanOrEqual(0.25);
    expect(result.commodity).toBeGreaterThanOrEqual(0.1);
    expect(result.turkishEquity).toBeGreaterThanOrEqual(0.1);
    expect(Object.values(result).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 8);
  });

  it("averages all available backtest horizons instead of trusting one period", () => {
    const result = averageAllocationWeights([
      { foreignEquity: 0.4, commodity: 0.2, bitcoin: 0.2, turkishEquity: 0.2 },
      { foreignEquity: 0.2, commodity: 0.3, bitcoin: 0.4, turkishEquity: 0.1 },
    ]);

    expect(result).toEqual({ foreignEquity: 0.3, commodity: 0.25, bitcoin: 0.3, turkishEquity: 0.15 });
  });

  it("turns the hybrid weights into an exact actionable monthly budget", () => {
    const result = buildHybridAllocation({
      monthlyBudget: 50_000,
      signals: { foreignEquity: 0, commodity: 0, bitcoin: 0, turkishEquity: 0 },
      confidence: { foreignEquity: 1, commodity: 1, bitcoin: 1, turkishEquity: 1 },
      balancedWeights: { foreignEquity: 0.25, commodity: 0.35, bitcoin: 0.3, turkishEquity: 0.1 },
    });

    expect(result.items.map((item) => item.weight)).toEqual([0.28, 0.32, 0.27, 0.13]);
    expect(result.items.reduce((sum, item) => sum + item.amount, 0)).toBe(50_000);
    expect(result.dynamicWeights).toEqual({ foreignEquity: 0.35, commodity: 0.25, bitcoin: 0.2, turkishEquity: 0.2 });
  });
});
