import { describe, expect, it } from "vitest";
import { derivePriceSignal } from "./signals";

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
