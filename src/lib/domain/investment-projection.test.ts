import { describe, expect, it } from "vitest";
import { projectInvestment, realReturn } from "./investment-projection";

describe("investment projection", () => {
  it("uses a ratio for real return, including FX in Turkish purchasing power", () => {
    expect(realReturn(0.1, 0.03)).toBeCloseTo(1.1 / 1.03 - 1);
    expect(realReturn(0.1, 0.3, 0.2)).toBeCloseTo(1.1 * 1.2 / 1.3 - 1);
  });
  it("preserves nominal contributions when return and inflation are zero", () => {
    const result = projectInvestment({ monthlyUsd: 1000, initialUsd: 500, years: 10, nominalReturn: 0, usInflation: 0, trInflation: 0, fxDepreciation: 0, usdTry: 40 });
    expect(result.at(-1)).toMatchObject({ contributedUsd: 120500, nominalUsd: 120500, realUsd: 120500, realTry: 4820000 });
  });
  it("deflates the final portfolio rather than treating nominal contributions as real contributions", () => {
    const result = projectInvestment({ monthlyUsd: 1000, initialUsd: 0, years: 1, nominalReturn: 0, usInflation: 0.1, trInflation: 0.2, fxDepreciation: 0.1, usdTry: 40 });
    expect(result.at(-1)!.realUsd).toBeCloseTo(12000 / 1.1);
    expect(result.at(-1)!.realTry).toBeCloseTo(12000 * 40 * 1.1 / 1.2);
  });
});
