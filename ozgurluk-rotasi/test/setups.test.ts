import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { findDailySetups, fullSession, orbHistory, orbState, plan, rsi, sessionBars, timeMachine, verdict, type Series } from "../src/setups.ts";

// Paketin "reel" örneği: TSLA, 19 Ekim 2026 (fikstürler paketten)
const FIX = new URL("./fixtures/day-trader-skill/", import.meta.url);
function series(j: any): Series {
  const r = j.chart.result[0], q = r.indicators.quote[0];
  const s: Series = { t: [], o: [], h: [], l: [], c: [], v: [], periods: (r.meta.tradingPeriods ?? []).flat(), current: r.meta.currentTradingPeriod.regular, gmtoffset: r.meta.gmtoffset, price: r.meta.regularMarketPrice };
  r.timestamp.forEach((t: number, i: number) => {
    if (q.close[i] == null || q.high[i] == null) return;
    s.t.push(t); s.o.push(q.open[i]); s.h.push(q.high[i]); s.l.push(q.low[i]); s.c.push(q.close[i]); s.v.push(q.volume[i] ?? 0);
  });
  return s;
}
const START = Date.UTC(2026, 9, 19, 13, 30) / 1000, END = START + 6.5 * 3600;

test("ORB: paketteki TSLA örneği (aralık, tetik, plan)", () => {
  const day = series(JSON.parse(readFileSync(new URL("TSLA-2026-10-19-5m.json", FIX), "utf8")));
  const at1012 = Date.UTC(2026, 9, 19, 14, 12) / 1000;
  assert.equal(orbState(sessionBars(day, START, END, at1012), { start: START, end: END }, at1012).status, "waiting");
  const at1015 = Date.UTC(2026, 9, 19, 14, 15) / 1000;
  const st = orbState(sessionBars(day, START, END, at1015), { start: START, end: END }, at1015);
  assert.equal(st.status, "triggered");
  assert.equal(st.side, "long");
  assert.equal(st.orHigh!.toFixed(2), "362.18");
  assert.equal(st.orLow!.toFixed(2), "354.47");
  assert.equal(st.trigger!.price, 364.18);
  assert.equal(st.trigger!.at, at1015); // 10:10 barı 10:15'te kapanır
  assert.equal(st.trigger!.barIndex, 8);
  assert.equal(st.plan1R!.stop, 358.32);
  assert.equal(st.plan1R!.target, 370.04);
  assert.equal(st.plan2R!.target, 375.9);
});

test("Zaman Makinesi ve geçmiş: paketteki TSLA sonuçları", () => {
  const big = series(JSON.parse(gunzipSync(readFileSync(new URL("TSLA-60d5m.json.gz", FIX))).toString()));
  const past = big.periods.filter((p) => p.start < START - 60).map((p) => fullSession(big, p)).filter((b) => b && b.length === 78) as NonNullable<ReturnType<typeof fullSession>>[];
  assert.equal(past.length, 59);
  // Geçmiş birebir: 33 tetik, 13 hedef, 15 stop, 5 hiçbiri, ort. R −0,062
  const h = orbHistory(past, "long", 1);
  assert.deepEqual([h.fired, h.target, h.stop, h.neither], [33, 13, 15, 5]);
  assert.equal(h.avgR.toFixed(3), "-0.062");
  // Simülasyon farklı RNG ile istatistiksel olarak aynı (paket: %29,4 / %25,5 / %45,1)
  const p = plan("long", 364.18, (362.18 + 354.47) / 2, 1)!;
  const mc = timeMachine(past, { side: "long", entry: p.entry, stop: p.stop, target: p.target, R: 1, entryBar: 8, nBars: 78 });
  assert.ok(Math.abs(mc.targetFirst - 0.294) < 0.015, `hedef ${mc.targetFirst}`);
  assert.ok(Math.abs(mc.stopFirst - 0.255) < 0.015, `stop ${mc.stopFirst}`);
  assert.ok(Math.abs(mc.neither - 0.451) < 0.015, `hiçbiri ${mc.neither}`);
  assert.ok(Math.abs(mc.closeP50 - 364.36) < 1.5);
  // Aynı tohum, aynı sonuç
  const mc2 = timeMachine(past, { side: "long", entry: p.entry, stop: p.stop, target: p.target, R: 1, entryBar: 8, nBars: 78 });
  assert.equal(mc2.targetFirst, mc.targetFirst);
  assert.match(verdict(Math.round(mc.targetFirst * 1e4), Math.round(mc.stopFirst * 1e4), 1, 1e4).text, /Yazı tura/);
});

test("plan: stop girişten uzağa yuvarlanır, çok dar risk reddedilir", () => {
  assert.equal(plan("long", 100, 98.555, 2)!.stop, 98.55);
  assert.equal(plan("short", 100, 101.441, 1)!.stop, 101.45);
  assert.equal(plan("short", 100, 101.45, 2)!.target, 97.1);
  assert.equal(plan("long", 100, 99.99, 1), null);
  assert.equal(plan("long", 100, 101, 1), null);
});

test("verdict: başabaş 1/(1+R)", () => {
  assert.equal(verdict(50, 50, 1, 100).tone, "neutral");
  assert.match(verdict(40, 60, 2, 100).text, /Hafifçe hedefe/);
  assert.match(verdict(20, 80, 1, 100).text, /Belirgin şekilde stopa/);
});

test("günlük kurulumlar: paket kuralları ve yaklaşanlar", () => {
  const flat = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 0.5);
  assert.ok(findDailySetups([...flat, 103]).tags.includes("breakout_20d"));
  assert.ok(findDailySetups([...flat, 97]).tags.includes("breakdown_20d"));
  const near = findDailySetups([...flat, 100.2]);
  assert.ok(near.tags.includes("near_breakout"));
  // bayrak: 10 seansta %12 koşu, sonra 5 seans dar bant
  const run = Array.from({ length: 30 }, () => 100).concat(Array.from({ length: 10 }, (_, i) => 100 + (i + 1) * 1.25), [112.4, 112.8, 112.2, 112.6, 112.5]);
  assert.ok(findDailySetups(run).tags.includes("bull_flag"));
  const down = Array.from({ length: 40 }, (_, i) => 100 - i);
  assert.ok((rsi(down) ?? 100) < 30);
  assert.ok(findDailySetups(down).tags.includes("oversold"));
  assert.ok(findDailySetups([...down, 62]).tags.includes("oversold_bounce"));
});
