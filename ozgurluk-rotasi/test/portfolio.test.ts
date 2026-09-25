import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTx, valuate } from "../src/portfolio.ts";

const q = (price: number) => ({ price, time: "2026-09-24T00:00:00Z", label: "t", unit: "ons" });

test("400$ XAU @ 4000 → 0.1 ons; %10 artışta 440$ ve +40$ kâr", () => {
  const tx = makeTx({ asset: "GLD", usd: 400, price: 4000, date: "2026-08-29" }, undefined);
  assert.equal(tx.quantity, 0.1);
  const v = valuate([tx], { GLD: q(4400) });
  const p = v.positions[0];
  assert.ok(Math.abs(p.value - 440) < 1e-9);
  assert.ok(Math.abs(p.pnl - 40) < 1e-9);
  assert.ok(Math.abs(p.pnlPct - 0.1) < 1e-9);
  assert.ok(Math.abs(v.totals.pnl - 40) < 1e-9);
});

test("ortalama maliyet ve satışta gerçekleşen kâr", () => {
  const a = makeTx({ asset: "BTC", usd: 100, price: 50_000 }, undefined);
  const b = makeTx({ asset: "BTC", usd: 300, price: 100_000 }, undefined);
  const s = makeTx({ asset: "BTC", side: "sell", quantity: 0.002, price: 120_000 }, undefined);
  const v = valuate([a, b, s], { BTC: q(120_000) });
  const p = v.positions[0];
  // 0.002 + 0.003 = 0.005 BTC, maliyet 400 → ort. 80.000; 0.002 satış @120k → gerçekleşen 80
  assert.ok(Math.abs(p.quantity - 0.003) < 1e-12);
  assert.ok(Math.abs(p.avgCost - 80_000) < 1e-6);
  assert.ok(Math.abs(p.realized - 80) < 1e-6);
  assert.ok(Math.abs(p.value - 360) < 1e-6);
});

test("nakit kalemi fiyatı 1; tutar/miktar yoksa hata", () => {
  const c = makeTx({ asset: "NAKIT", usd: 88 }, undefined);
  assert.equal(c.price, 1);
  assert.throws(() => makeTx({ asset: "SPY" }, 700));
  assert.throws(() => makeTx({ asset: "XYZ", usd: 5 }, 1));
});
