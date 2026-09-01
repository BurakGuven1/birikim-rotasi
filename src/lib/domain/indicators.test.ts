import { describe, expect, it } from "vitest";
import { percentileRank, simpleMovingAverage, volatilityNormalizedDistance } from "./indicators";

describe("simpleMovingAverage", () => {
  it("does not leak future values into earlier windows", () => {
    expect(simpleMovingAverage([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("rejects an invalid period", () => {
    expect(() => simpleMovingAverage([1, 2], 0)).toThrow("Pozitif");
  });
});

describe("percentileRank", () => {
  it("returns the historical position on a zero-to-one scale", () => {
    expect(percentileRank([10, 20, 30, 40], 30)).toBeCloseTo(2 / 3, 8);
  });
});

describe("volatilityNormalizedDistance", () => {
  it("is zero for a flat price series and finite for a rising series", () => {
    expect(volatilityNormalizedDistance([100, 100, 100, 100], 3)).toBe(0);
    expect(volatilityNormalizedDistance([100, 105, 103, 111, 118], 3)).toBeGreaterThan(0);
  });
});
