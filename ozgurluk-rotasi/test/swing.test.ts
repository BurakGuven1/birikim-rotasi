import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate, type Strategy } from "../src/engine/swing.ts";
import type { Bar } from "../src/data/types.ts";

const day = (i: number) => new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);
const bar = (i: number, o: number, h: number, l: number, c: number): Bar => ({ date: day(i), open: o, high: h, low: l, close: c, volume: 0 });

function once(stop: number, target?: number): Strategy {
  return {
    id: "donchian",
    label: "test",
    riskPct: null,
    entry: (i) => (i === 0 ? { side: 1, stop, target, reason: "test" } : null),
    exit: () => null,
  };
}

test("giriş sonraki bar açılışında, stop bar içinde dolar", () => {
  const bars = [bar(0, 100, 101, 99, 100), bar(1, 100, 102, 99, 101), bar(2, 101, 101, 94, 95)];
  const r = simulate(bars, once(96), { costBps: 0, carryAnnual: 0, maxLeverage: 1 });
  assert.equal(r.trades.length, 1);
  assert.equal(r.trades[0].entry, 100);
  assert.equal(r.trades[0].exit, 96);
  assert.equal(r.trades[0].exitReason, "stop");
  assert.ok(Math.abs(r.trades[0].r + 1) < 1e-9);
});

test("boşluklu açılışta stop açılıştan dolar (daha kötü)", () => {
  const bars = [bar(0, 100, 101, 99, 100), bar(1, 100, 102, 99, 101), bar(2, 90, 91, 89, 90)];
  const r = simulate(bars, once(96), { costBps: 0, carryAnnual: 0, maxLeverage: 1 });
  assert.equal(r.trades[0].exit, 90);
});

test("aynı barda stop ve hedef → stop varsayılır", () => {
  const bars = [bar(0, 100, 101, 99, 100), bar(1, 100, 100, 100, 100), bar(2, 100, 120, 80, 100)];
  const r = simulate(bars, once(90, 110), { costBps: 0, carryAnnual: 0, maxLeverage: 1 });
  assert.equal(r.trades[0].exitReason, "stop");
});

test("maliyet uygulanır", () => {
  const bars = [bar(0, 100, 101, 99, 100), bar(1, 100, 100, 100, 100), bar(2, 100, 120, 100, 110)];
  const r = simulate(bars, once(90, 110), { costBps: 10, carryAnnual: 0, maxLeverage: 1 });
  assert.ok(Math.abs(r.trades[0].entry - 100.1) < 1e-9);
  assert.ok(Math.abs(r.trades[0].exit - 110 * 0.999) < 1e-9);
});
