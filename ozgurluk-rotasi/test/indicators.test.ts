import { test } from "node:test";
import assert from "node:assert/strict";
import { atr, donchian, rsi, sma } from "../src/engine/indicators.ts";

test("sma", () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3).map((x) => (Number.isNaN(x) ? null : x)), [null, null, 2, 3, 4]);
});

test("rsi: sürekli yükselişte 100, sürekli düşüşte 0", () => {
  const up = rsi([1, 2, 3, 4, 5, 6], 2);
  assert.equal(up[5], 100);
  const down = rsi([6, 5, 4, 3, 2, 1], 2);
  assert.equal(down[5], 0);
});

test("rsi: Wilder yumuşatması elle hesapla eşleşir", () => {
  // değişimler: +1, -1, +2 ; n=2 → ilk ort. kazanç 0.5, kayıp 0.5; sonra kazanç (0.5+2)/2=1.25, kayıp 0.25
  const r = rsi([10, 11, 10, 12], 2);
  assert.ok(Math.abs(r[2] - 50) < 1e-9);
  assert.ok(Math.abs(r[3] - (100 - 100 / (1 + 1.25 / 0.25))) < 1e-9);
});

test("donchian mevcut barı içermez (ileriye bakma yok)", () => {
  const bars = [1, 2, 3, 10].map((c) => ({ high: c, low: c, close: c }));
  const d = donchian(bars, 3);
  assert.equal(d.upper[3], 3);
  assert.equal(d.lower[3], 1);
});

test("atr sabit aralıkta aralığa eşit", () => {
  const bars = Array.from({ length: 30 }, () => ({ high: 11, low: 9, close: 10 }));
  assert.ok(Math.abs(atr(bars, 14)[29] - 2) < 1e-9);
});
