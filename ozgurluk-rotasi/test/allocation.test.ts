import { test } from "node:test";
import assert from "node:assert/strict";
import { splitContribution, strategyWeights } from "../src/allocation.ts";
import type { AssetId } from "../src/config.ts";

const allOn = { SPY: 1, QQQ: 1, GLD: 1, BIST: 1, BTC: 1, ETH: 1, DBC: 1 } as Record<AssetId, number>;
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

test("üç strateji: ağırlıklar toplamı 1", () => {
  for (const k of ["static", "hybrid", "main"] as const) {
    const { weights } = strategyWeights(k, { ...allOn, BTC: 0, GLD: 0.5 });
    assert.ok(Math.abs(sum(weights) - 1) < 1e-12, k);
  }
});

test("al-tut trende bakmaz; hibrit kapalı varlığın yarısını nakde alır", () => {
  const scores = { ...allOn, BTC: 0 };
  assert.equal(strategyWeights("static", scores).weights.BTC, 0.15);
  const h = strategyWeights("hybrid", scores);
  assert.ok(Math.abs(h.weights.BTC - 0.075) < 1e-12);
  assert.ok(Math.abs(h.weights.NAKIT - 0.075) < 1e-12);
  assert.ok(Math.abs((h.hedge.BTC ?? 0) - 0.5) < 1e-12);
  const m = strategyWeights("main", allOn);
  assert.equal(m.weights.SWING, 0.2);
  assert.ok(Math.abs(m.weights.SPY - 0.24) < 1e-12);
});

test("katkı tam dolara bölünür ve toplam korunur", () => {
  const { weights } = strategyWeights("hybrid", { ...allOn, BTC: 0.5, ETH: 0.5, GLD: 0.5 });
  const parts = splitContribution(weights, 1000);
  assert.equal(sum(parts), 1000);
  assert.ok(Object.values(parts).every((v) => Number.isInteger(v)));
});

test("mevcut portföyle: katkı hedefin altındaki kaleme gider", () => {
  const w = { A: 0.5, B: 0.5 };
  const parts = splitContribution(w, 1000, { A: 3000, B: 1000 });
  assert.equal(parts.B, 1000);
  assert.equal(parts.A, 0);
});
