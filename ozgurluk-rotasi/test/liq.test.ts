import { test } from "node:test";
import assert from "node:assert/strict";
import { TIERS, classify, liqPrice, simulate, type Bar } from "../src/liq.ts";

test("liqPrice: long altta, short üstte; kaldıraç arttıkça yaklaşır", () => {
  assert.ok(Math.abs(liqPrice(100, 10, "long") - 90.5) < 1e-9);
  assert.ok(Math.abs(liqPrice(100, 10, "short") - 109.5) < 1e-9);
  assert.ok(liqPrice(100, 100, "long") > liqPrice(100, 25, "long"));
  assert.ok(liqPrice(100, 100, "short") < liqPrice(100, 25, "short"));
});

const bar = (t: number, l: number, h: number, c = (l + h) / 2): Bar => ({ t, o: c, h, l, c });
const BINS = { lo: 50, hi: 150, n: 100 };

test("simulate: OI artışı seviye açar, fiyat değince silinir ve tetiklenir", () => {
  // 2. barda $1M yeni OI, alış payı %50 → long ve short'a $500k
  const bars = [bar(0, 99, 101, 100), bar(1, 99, 101, 100), bar(2, 99.6, 100.4, 100)];
  const r1 = simulate(bars, [0, 1e6, 1e6], [0.5, 0.5, 0.5], BINS);
  const sum = (side: string) => r1.outstanding.filter((x) => x.side === side).reduce((s, x) => s + x.usd, 0);
  assert.equal(r1.outstanding.length, TIERS.length * 2);
  assert.ok(Math.abs(sum("long") - 5e5) < 1);
  assert.ok(Math.abs(sum("short") - 5e5) < 1);
  // Isı haritası toplamı açık seviyelere eşit
  assert.ok(Math.abs(r1.heat[2].reduce((s, v) => s + v, 0) - 1e6) < 1);

  // 3. bar 98'e iner → 100x long (≈99.5) ve 50x long (≈98.5) tasfiye
  const bars2 = [bar(0, 99, 101, 100), bar(1, 99, 101, 100), bar(2, 97.9, 100, 98.5)];
  const r2 = simulate(bars2, [0, 1e6, 1e6], [0.5, 0.5, 0.5], BINS);
  const expected = 5e5 * (TIERS[2].w + TIERS[3].w);
  assert.ok(Math.abs(r2.triggered[2].long - expected) < 1);
  assert.equal(r2.triggered[2].short, 0);
  assert.equal(r2.outstanding.filter((x) => x.side === "long").length, 2);
});

test("simulate: OI düşüşü seviyeleri orantılı azaltır", () => {
  const bars = [bar(0, 99, 101), bar(1, 99, 101), bar(2, 99.6, 100.4)];
  const r = simulate(bars, [0, 1e6, 5e5], [0.5, 0.5, 0.5], BINS);
  const tot = r.outstanding.reduce((s, x) => s + x.usd, 0);
  assert.ok(Math.abs(tot - 5e5) < 1);
});

test("classify: fiyat/OI rejimleri", () => {
  assert.equal(classify(0.03, 0.05, 0.1, 0.01, 0.02), "uyumlu-yukselis");
  assert.equal(classify(0.03, 0.05, 0.5, 0.01, 0.02), "asiri-long");
  assert.equal(classify(0.03, -0.05, 0.1, 0.01, 0.02), "negatif-short-kapanisi");
  assert.equal(classify(-0.03, 0.05, 0.1, 0.01, 0.02), "ayi-yeni-short");
  assert.equal(classify(-0.03, 0.05, -0.1, 0.01, 0.02), "pozitif-short-birikimi");
  assert.equal(classify(-0.03, -0.05, 0.1, 0.01, 0.02), "pozitif-temizlik");
  assert.equal(classify(0.001, 0.05, 0.1, 0.01, 0.02), "sikisma");
  assert.equal(classify(0.001, 0.001, 0.1, 0.01, 0.02), "notr");
});
