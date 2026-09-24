import { test } from "node:test";
import assert from "node:assert/strict";
import { binomialP, eventStudy, monthStats, monthlyReturns } from "../src/engine/seasonality.ts";
import type { Bar } from "../src/data/types.ts";

const bar = (date: string, close: number): Bar => ({ date, open: close, high: close, low: close, close, volume: 0 });

test("aylık getiri ay sonu kapanışından, devam eden ay işaretli", () => {
  const bars = [bar("2020-01-15", 90), bar("2020-01-31", 100), bar("2020-02-28", 110), bar("2020-03-10", 99)];
  const r = monthlyReturns(bars, "2020-03-20");
  assert.equal(r.length, 2);
  assert.ok(Math.abs(r[0].ret - 0.1) < 1e-12);
  assert.equal(r[0].partial, false);
  assert.ok(Math.abs(r[1].ret - -0.1) < 1e-12);
  assert.equal(r[1].partial, true);
});

test("ay istatistikleri yalnız kapanmış ayları ve son N gözlemi kullanır", () => {
  const bars: Bar[] = [bar("2009-12-31", 100)];
  let p = 100;
  for (let y = 2010; y <= 2021; y++)
    for (let m = 1; m <= 12; m++) {
      p *= m === 1 ? (y >= 2012 ? 1.05 : 0.95) : 1.0;
      bars.push(bar(`${y}-${String(m).padStart(2, "0")}-28`, p));
    }
  const { stats } = monthStats(monthlyReturns(bars, "2030-01-01"), 10);
  assert.equal(stats[0].n, 10);
  assert.equal(stats[0].up, 10); // 2012–2021 hepsi yükseliş; 2010–2011 pencere dışında
  assert.equal(stats[1].up, 0);
});

test("binom testi", () => {
  // 10/10 yükseliş, p=0.5 → iki yönlü ≈ 2/1024
  assert.ok(Math.abs(binomialP(10, 10, 0.5) - 2 / 1024) < 1e-12);
  assert.equal(binomialP(10, 5, 0.5), 1);
});

test("olay çalışması: seçim öncesi/sonrası pencere getirisi", () => {
  const bars: Bar[] = [];
  const start = Date.parse("2017-06-01");
  for (let d = 0; d < 600; d++) {
    const date = new Date(start + d * 86_400_000).toISOString().slice(0, 10);
    bars.push(bar(date, 100 + d));
  }
  const res = eventStudy(bars, ["TR"], ["tr_general"]);
  assert.equal(res.length, 1);
  const row = res[0].rows.find((r) => r.event.date === "2018-06-24")!;
  const dayIdx = (iso: string) => Math.round((Date.parse(iso) - start) / 86_400_000);
  const ev = dayIdx("2018-06-24");
  assert.ok(Math.abs(row.pre! - ((100 + ev) / (100 + ev - 182) - 1)) < 1e-12);
  assert.ok(Math.abs(row.post3m! - ((100 + ev + 91) / (100 + ev) - 1)) < 1e-12);
  // 2023 seçimi veri dışında → dahil edilmez
  assert.ok(!res[0].rows.some((r) => r.event.date.startsWith("2023")));
});
