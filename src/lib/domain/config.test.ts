import { describe, expect, it } from "vitest";
import { DEFAULT_MONTHLY_BUDGET_USD, DEFAULT_TARGET_USD } from "./config";

describe("USD-first defaults", () => {
  it("starts from the approved monthly contribution and purchasing-power target", () => {
    expect(DEFAULT_MONTHLY_BUDGET_USD).toBe(1_000);
    expect(DEFAULT_TARGET_USD).toBe(500_000);
  });
});
