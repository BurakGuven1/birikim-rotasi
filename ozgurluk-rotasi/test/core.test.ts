import { test } from "node:test";
import assert from "node:assert/strict";
import { runCore, trendScore, type CoreData } from "../src/engine/core.ts";
import { irrMonthly, maxDrawdown } from "../src/engine/metrics.ts";
import { monthRange } from "../src/engine/series.ts";
import { futureValue } from "../src/engine/montecarlo.ts";
import { requiredReturn } from "../src/engine/goal.ts";

function flatData(growthPerMonth: number): CoreData {
  const months = monthRange("2000-01", "2010-12");
  const px = new Map(months.map((m, i) => [m, 100 * (1 + growthPerMonth) ** i]));
  const zero = new Map(months.map((m) => [m, 0]));
  const cpi = new Map(months.map((m) => [m, 100]));
  return { months, prices: { SPY: px } as CoreData["prices"], tbill: zero, cpi, costBps: { SPY: 0 } as CoreData["costBps"] };
}

const contrib = { monthly: 1000, annual: 0, annualMonth: 1, inflationIndexed: false };

test("sıfır getiride son değer = yatırılan, IRR = 0", () => {
  const r = runCore(flatData(0), { name: "t", weights: { SPY: 1 }, rule: "none", contributions: contrib, start: "2002-01", end: "2004-12" });
  assert.ok(Math.abs(r.metrics.finalValue - r.metrics.totalContributed) < 1e-6);
  assert.ok(Math.abs(r.metrics.irr) < 1e-6);
});

test("sabit %1 aylık getiride CAGR ve IRR ≈ 12.68%", () => {
  const r = runCore(flatData(0.01), { name: "t", weights: { SPY: 1 }, rule: "none", contributions: contrib, start: "2002-01", end: "2006-12" });
  assert.ok(Math.abs(r.metrics.cagr - (1.01 ** 12 - 1)) < 1e-9);
  assert.ok(Math.abs(r.metrics.irr - (1.01 ** 12 - 1)) < 1e-6);
});

test("düşen varlıkta trend filtresi kapanır", () => {
  const d = flatData(-0.02);
  const closes = d.months.map((m) => d.prices.SPY.get(m));
  assert.equal(trendScore(closes, 30, "blend", d.months.map(() => 0)), 0);
  const up = flatData(0.02);
  assert.equal(trendScore(up.months.map((m) => up.prices.SPY.get(m)), 30, "blend", up.months.map(() => 0)), 1);
});

test("irr ve drawdown", () => {
  assert.ok(Math.abs(irrMonthly([-100, 110]) - 0.1) < 1e-9);
  assert.ok(Math.abs(maxDrawdown([0.1, -0.5, 0.2]) + 0.5) < 1e-12);
});

test("gereken getiri, futureValue ile tutarlı", () => {
  const r = requiredReturn(1_500_000, 20, 1000, 3500);
  assert.ok(Math.abs(futureValue(r, 20, 1000, 3500) - 1_500_000) < 1);
});

test("takvim oranı: walk-forward yalnız verilen indekse kadar olan yılları kullanır", async () => {
  const { seasonalUpRatio } = await import("../src/engine/core.ts");
  const months = monthRange("2000-01", "2003-12");
  // Ocak ayları: 2001 ↑, 2002 ↓, 2003 ↑
  const closes = months.map((m) => (m === "2001-01" ? 110 : m === "2002-01" ? 90 : m === "2003-01" ? 120 : 100));
  const upto2002 = seasonalUpRatio(months, closes, 1, months.indexOf("2002-12"), 10);
  assert.deepEqual(upto2002, { up: 1, n: 2 }); // 2000-01 öncesi veri yok; 2001 ↑, 2002 ↓ (2003 henüz bilinmiyor)
  const all = seasonalUpRatio(months, closes, 1, months.length - 1, 10);
  assert.equal(all.up, 2);
});
