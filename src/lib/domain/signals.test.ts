import { describe, expect, it } from "vitest";
import { deriveBitcoinMacroSignal, derivePriceSignal } from "./signals";

describe("derivePriceSignal", () => {
  it("does not call a strongly falling market a maximum-buy opportunity", () => {
    const closes = Array.from({ length: 220 }, (_, index) => 220 - index * 0.6);
    const signal = derivePriceSignal(closes, 1.8);
    expect(signal.score).toBeLessThan(0.5);
    expect(signal.fallingKnife).toBe(true);
  });

  it("gives a positive signal near the long trend after a recovery", () => {
    const closes = [...Array.from({ length: 200 }, () => 100), ...Array.from({ length: 20 }, () => 90), ...Array.from({ length: 40 }, () => 100)];
    const signal = derivePriceSignal(closes, 1);
    expect(signal.score).toBeGreaterThan(0);
    expect(signal.confidence).toBeGreaterThan(0.7);
  });
});

describe("deriveBitcoinMacroSignal", () => {
  it("raises opportunity strength when BTC/M2 is historically cheap and price has reclaimed the 200-week average", () => {
    const weeklyPrices = Array.from({ length: 220 }, (_, index) => ({
      date: new Date(Date.UTC(2022, 0, 2 + index * 7)).toISOString(),
      close: index < 200 ? 100 : 100 + (index - 199) * 0.3,
    }));
    const m2 = Array.from({ length: 220 }, (_, index) => ({
      date: weeklyPrices[index].date,
      close: index < 200 ? 100 : 100 + (index - 199) * 5,
    }));

    const priceOnly = derivePriceSignal(weeklyPrices.map((point) => point.close), 1.8);
    const combined = deriveBitcoinMacroSignal(weeklyPrices, m2);

    expect(combined.score).toBeGreaterThan(priceOnly.score);
    expect(combined.m2Percentile).toBeLessThan(0.25);
    expect(combined.weeklySma200).toBeGreaterThan(0);
    expect(combined.reasons.join(" ")).toContain("BTC/M2");
  });
});
