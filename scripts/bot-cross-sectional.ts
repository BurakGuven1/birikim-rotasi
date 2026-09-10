/**
 * Cross-sectional momentum on OKX USDT perpetuals.
 *
 * This is categorically different from every per-coin entry model tested so far: it does not try to
 * time one instrument, it ranks the whole universe each day and holds the strongest against the
 * weakest. Relative strength between coins is a different source of return from price structure
 * within one coin, which is why it is worth testing after the per-coin models failed.
 *
 * Honest scope: daily closes only, so intraday path is not modelled. Perp funding is NOT included;
 * a long-short book partly cancels funding but not exactly, so live results would differ. Costs are
 * charged on realised turnover at each rebalance. Universe is today's liquid contracts, so survivor
 * bias is present and is stated rather than hidden.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { OkxClient } from '../src/lib/server/okx/client';
import { getUniverse, getHistoricalCandles } from '../src/lib/server/okx/market';

const client = new OkxClient({ mode: 'public' });
const DAY = 86_400_000;
const arg = (name: string, fallback: number) => {
  const raw = process.argv.find(a => a.startsWith(`--${name}=`));
  return raw ? Number(raw.slice(name.length + 3)) : fallback;
};
const days = arg('days', 365), coinCount = arg('coins', 30);
const feeBps = arg('fee', 2), slipBps = arg('slip', 3);
const costRate = (feeBps + slipBps) / 10_000;

const universe = (await getUniverse(client))
  .filter(i => (i.volumeUsdt ?? 0) > 0)
  .sort((a, b) => (b.volumeUsdt ?? 0) - (a.volumeUsdt ?? 0))
  .slice(0, coinCount);
console.log(`Evren: ${universe.length} kontrat, en likit. Maliyet ${feeBps} bp + ${slipBps} bp kayma.`);

const to = Math.floor(Date.now() / DAY) * DAY - DAY;
const from = to - (days + 90) * DAY;
const closes = new Map<string, Map<number, number>>();
for (const instrument of universe) {
  const candles = await getHistoricalCandles(client, instrument.id, '1Dutc', { from, to, maxPages: 20 });
  if (candles.length < days) { console.log(`${instrument.base}: yetersiz gecmis (${candles.length} gun), atlandi`); continue; }
  closes.set(instrument.id, new Map(candles.map(c => [c.time, c.close])));
}
// Funding is a real cash flow on perpetuals: a long pays a positive rate, a short receives it.
// Ignoring it would flatter a long-short book, so every settlement in the window is summed per day.
const funding = new Map<string, Map<number, number>>();
for (const id of closes.keys()) {
  const daily = new Map<number, number>();
  let cursor = to + DAY;
  for (let page = 0; page < 12; page++) {
    const rows = await client.get<Record<string, unknown>>(`/api/v5/public/funding-rate-history?instId=${id}&limit=400&after=${cursor}`);
    if (!rows.length) break;
    let oldest = cursor;
    for (const row of rows) {
      const time = Number(row.fundingTime), rate = Number(row.realizedRate ?? row.fundingRate);
      if (!Number.isFinite(time) || !Number.isFinite(rate)) continue;
      const day = Math.floor(time / DAY) * DAY;
      daily.set(day, (daily.get(day) ?? 0) + rate);
      oldest = Math.min(oldest, time);
    }
    if (oldest <= from || oldest >= cursor) break;
    cursor = oldest;
  }
  funding.set(id, daily);
}
console.log(`Funding gecmisi ${funding.size} kontrat icin yuklendi.`);

// Open interest is an independent data source, not a rearrangement of OHLCV. The claim under test:
// a price move backed by rising OI is new money and continues, while one on falling OI is closing
// flow and fades. OKX serves this per currency with roughly 180 daily points, so the OI comparison
// runs on a shorter window than the rest of the study and is reported separately.
const openInterest = new Map<string, Map<number, number>>();
for (const id of closes.keys()) {
  const ccy = id.split('-')[0];
  try {
    const rows = await client.get<unknown>(`/api/v5/rubik/stat/contracts/open-interest-volume?ccy=${ccy}&period=1D`);
    const series = new Map<number, number>();
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const time = Number(row[0]), value = Number(row[1]);
      if (Number.isFinite(time) && Number.isFinite(value) && value > 0) series.set(Math.floor(time / DAY) * DAY, value);
    }
    if (series.size) openInterest.set(id, series);
  } catch { /* Absent OI for a contract simply removes it from the OI comparison. */ }
}
console.log(`Open interest ${openInterest.size} kontrat icin yuklendi.`);

const ids = [...closes.keys()];
const grid: number[] = [];
for (let t = from; t <= to; t += DAY) if (ids.every(id => closes.get(id)!.has(t))) grid.push(t);
console.log(`Ortak gun sayisi: ${grid.length}, coin: ${ids.length}\n`);

/** One long-short run. Returns the daily net returns so any window can be scored from them. */
function run(lookback: number, k: number, rate = costRate, leg: 'both' | 'long' | 'short' = 'both', withFunding = true, useOi = false): { time: number; ret: number; turnover: number }[] {
  const out: { time: number; ret: number; turnover: number }[] = [];
  let held = new Map<string, number>();
  for (let i = lookback; i < grid.length - 1; i++) {
    const scored = ids.map(id => {
      const now = closes.get(id)!.get(grid[i])!, past = closes.get(id)!.get(grid[i - lookback])!;
      return { id, score: now / past - 1 };
    }).sort((a, b) => b.score - a.score);
    // OI confirmation: keep a long only if open interest rose with price, a short only if OI rose
    // as price fell. Rising OI means new positions, not an unwind of existing ones.
    const confirms = (id: string, direction: number) => {
      if (!useOi) return true;
      const series = openInterest.get(id);
      const now = series?.get(grid[i]), past = series?.get(grid[i - lookback]);
      if (now === undefined || past === undefined || past <= 0) return false;
      return direction > 0 ? now > past : now > past;
    };
    const target = new Map<string, number>();
    const longs = scored.filter(x => confirms(x.id, 1)).slice(0, k);
    const shorts = scored.filter(x => confirms(x.id, -1)).slice(-k);
    if (leg !== 'short') for (const { id } of longs) target.set(id, .5 / Math.max(1, longs.length));
    if (leg !== 'long') for (const { id } of shorts) target.set(id, -.5 / Math.max(1, shorts.length));
    // Turnover is the absolute weight change actually traded at this rebalance.
    let turnover = 0;
    for (const id of new Set([...held.keys(), ...target.keys()])) turnover += Math.abs((target.get(id) ?? 0) - (held.get(id) ?? 0));
    let gross = 0, fundingCost = 0;
    for (const [id, weight] of target) {
      gross += weight * (closes.get(id)!.get(grid[i + 1])! / closes.get(id)!.get(grid[i])! - 1);
      // A long position pays the settled rate; a short receives it.
      fundingCost += weight * (funding.get(id)?.get(grid[i + 1]) ?? 0);
    }
    out.push({ time: grid[i + 1], ret: gross - turnover * rate - (withFunding ? fundingCost : 0), turnover });
    held = target;
  }
  return out;
}

function score(returns: { ret: number; turnover?: number }[]) {
  if (!returns.length) return null;
  let equity = 1, peak = 1, drawdown = 0;
  for (const r of returns) { equity *= 1 + r.ret; peak = Math.max(peak, equity); drawdown = Math.max(drawdown, 1 - equity / peak); }
  const mean = returns.reduce((a, b) => a + b.ret, 0) / returns.length;
  const sd = Math.sqrt(returns.reduce((a, b) => a + (b.ret - mean) ** 2, 0) / returns.length);
  const turnover = returns.reduce((a, b) => a + (b.turnover ?? 0), 0) / returns.length;
  return { gun: returns.length, getiri: (equity - 1) * 100, sharpe: sd > 0 ? mean / sd * Math.sqrt(365) : 0, dusus: drawdown * 100, devir: turnover * 100 };
}

const lines: string[] = [];
const say = (text: string) => { lines.push(text); console.log(text); };

// Canonical parameters chosen before seeing results: 30-day lookback, 5 long / 5 short, daily rebalance.
const primary = run(30, 5);
const split = Math.floor(primary.length * 2 / 3);
const all = score(primary)!, dev = score(primary.slice(0, split))!, hold = score(primary.slice(split))!;
say('== ANA KOSU: 30 gun momentum, 5 long / 5 short, gunluk denge ==');
say(`Tum donem   : ${all.gun} gun, getiri %${all.getiri.toFixed(1)}, Sharpe ${all.sharpe.toFixed(2)}, azami dusus %${all.dusus.toFixed(1)}`);
say(`Gelistirme  : ${dev.gun} gun, getiri %${dev.getiri.toFixed(1)}, Sharpe ${dev.sharpe.toFixed(2)}, azami dusus %${dev.dusus.toFixed(1)}`);
say(`Ayrilmis    : ${hold.gun} gun, getiri %${hold.getiri.toFixed(1)}, Sharpe ${hold.sharpe.toFixed(2)}, azami dusus %${hold.dusus.toFixed(1)}`);
say(`Gunluk ortalama devir: %${all.devir.toFixed(1)} (her gun portfoyun bu kadari alinip satiliyor)`);

// Turnover this high makes the result a bet on the cost assumption, so cost is swept explicitly.
// If nearly all profit sits in the long leg, survivor bias in a universe picked by today's
// liquidity is the prime suspect, because dead coins that would have been bought are absent.
say('');
say('== BACAK AYRIMI (hayatta kalma yanliligi testi, tum donem getiri %) ==');
say('lookback  K  | long+short | yalniz long | yalniz short');
for (const [lookback, k] of [[7, 5], [14, 5], [14, 3]] as const) {
  const both = score(run(lookback, k))!.getiri, lng = score(run(lookback, k, costRate, 'long'))!.getiri, sht = score(run(lookback, k, costRate, 'short'))!.getiri;
  say(`${String(lookback).padStart(8)}  ${k}  | ${both.toFixed(0).padStart(10)} | ${lng.toFixed(0).padStart(11)} | ${sht.toFixed(0).padStart(12)}`);
}
say('');
say('== MALIYET DUYARLILIGI (tum donem getiri %, kritik test) ==');
say('lookback  K  |  0 bp  |  5 bp  | 10 bp  | 20 bp  | 40 bp');
for (const [lookback, k] of [[7, 5], [14, 5], [14, 3], [30, 5]] as const) {
  const cells = [0, 5, 10, 20, 40].map(bps => score(run(lookback, k, bps / 10_000))!.getiri.toFixed(0).padStart(6));
  say(`${String(lookback).padStart(8)}  ${k}  | ${cells.join(' | ')}`);
}

// Robustness grid. This is NOT a selection step: it shows whether the result is a knife edge.
// The winning parameters above were found by looking at the grid, which is selection. A walk-forward
// never does that: parameters for each month come only from the months before it, so the reported
// return is what an operator could actually have earned without knowing the future.
say('');
say('== FUNDING ETKISI (tum donem getiri %) ==');
say('lookback  K  | funding haric | funding dahil | fark');
for (const [lookback, k] of [[7, 5], [14, 5], [14, 3], [30, 5]] as const) {
  const without = score(run(lookback, k, costRate, 'both', false))!.getiri, withF = score(run(lookback, k))!.getiri;
  say(`${String(lookback).padStart(8)}  ${k}  | ${without.toFixed(0).padStart(13)} | ${withF.toFixed(0).padStart(13)} | ${(withF - without).toFixed(0).padStart(4)}`);
}
say('');
say('== OPEN INTEREST TEYIDI (OI verisi ~180 gun, kisa pencere) ==');
say('lookback  K  | OI teyidi yok | OI teyidi var | fark');
for (const [lookback, k] of [[7, 5], [14, 5], [14, 3], [30, 5]] as const) {
  const base = score(run(lookback, k).slice(-170))!.getiri, oi = score(run(lookback, k, costRate, 'both', true, true).slice(-170))!.getiri;
  say(`${String(lookback).padStart(8)}  ${k}  | ${base.toFixed(0).padStart(13)} | ${oi.toFixed(0).padStart(13)} | ${(oi - base).toFixed(0).padStart(4)}`);
}
say('');
say('== WALK-FORWARD (parametre secimi yalnizca gecmisten, gelecege bakis yok) ==');
{
  const candidates: [number, number][] = [];
  for (const lookback of [7, 14, 30, 60, 90]) for (const k of [3, 5, 8]) candidates.push([lookback, k]);
  const series = new Map(candidates.map(c => [c.join('/'), run(c[0], c[1])]));
  const length = Math.min(...[...series.values()].map(r => r.length));
  const train = 180, step = 30;
  const live: { ret: number }[] = [];
  const picks: string[] = [];
  for (let start = train; start + step <= length; start += step) {
    let best = '', bestScore = -Infinity;
    for (const [name, returns] of series) {
      let equity = 1;
      for (const r of returns.slice(start - train, start)) equity *= 1 + r.ret;
      if (equity > bestScore) { bestScore = equity; best = name; }
    }
    picks.push(best);
    live.push(...series.get(best)!.slice(start, start + step));
  }
  const wf = score(live);
  if (wf) {
    say(`Gercek dis-ornek: ${wf.gun} gun, getiri %${wf.getiri.toFixed(1)}, Sharpe ${wf.sharpe.toFixed(2)}, azami dusus %${wf.dusus.toFixed(1)}`);
    say(`Secilen parametreler sirayla: ${picks.join(', ')}`);
  } else say('Walk-forward icin yeterli gun yok.');
}

say('\n== SAGLAMLIK IZGARASI (secim degil, duyarlilik) ==');
say('lookback  K  | tum donem getiri % | Sharpe | ayrilmis getiri %');
for (const lookback of [7, 14, 30, 60, 90]) for (const k of [3, 5, 8]) {
  const returns = run(lookback, k);
  const s = score(returns)!, h = score(returns.slice(Math.floor(returns.length * 2 / 3)))!;
  say(`${String(lookback).padStart(8)}  ${k}  | ${s.getiri.toFixed(1).padStart(18)} | ${s.sharpe.toFixed(2).padStart(6)} | ${h.getiri.toFixed(1).padStart(17)}`);
}
say('\nNot: funding dahil degil; evren bugunku likit kontrahlar oldugu icin hayatta kalma yanliligi var.');
say('Ayrilmis donem sonucu pozitif degilse bu strateji de kanitlanmis edge tasimiyor demektir.');

await mkdir('artifacts/cross-sectional', { recursive: true });
await writeFile('artifacts/cross-sectional/ozet.txt', lines.join('\n'), 'utf8');
