import type { Bar } from "../data/types.ts";
import { EVENTS, EVENT_TYPE_LABEL, type EventType, type MarketEvent, type Scope } from "../data/events.ts";

export const MONTHS_TR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
export const MONTHS_TR_LONG = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

export interface MonthCell {
  /** YYYY-MM */
  month: string;
  ret: number;
  /** Ay henüz kapanmadı (devam eden ayın ay-başından-bugüne getirisi) */
  partial: boolean;
}

/** Ay sonu kapanışlarından aylık getiriler. Son ay `asOf` ayına eşitse "partial" işaretlenir. */
export function monthlyReturns(bars: Bar[], asOf: string = new Date().toISOString().slice(0, 10)): MonthCell[] {
  const last = new Map<string, number>();
  for (const b of bars) last.set(b.date.slice(0, 7), b.close);
  const months = [...last.keys()].sort();
  const cur = asOf.slice(0, 7);
  const out: MonthCell[] = [];
  for (let i = 1; i < months.length; i++) {
    const m = months[i];
    out.push({ month: m, ret: last.get(m)! / last.get(months[i - 1])! - 1, partial: m >= cur });
  }
  return out;
}

export interface MonthStat {
  /** 1..12 */
  month: number;
  n: number;
  up: number;
  avg: number;
  median: number;
  best: number;
  worst: number;
  /** Binom testi: bu kadar uç yükselme/düşme oranının, varlığın genel yükselme oranıyla şans eseri çıkma olasılığı (iki yönlü) */
  pValue: number;
}

function binom(n: number, k: number): number {
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return c;
}

/** İki yönlü tam binom testi */
export function binomialP(n: number, k: number, p: number): number {
  const pk = (i: number) => binom(n, i) * p ** i * (1 - p) ** (n - i);
  const obs = pk(k);
  let s = 0;
  for (let i = 0; i <= n; i++) if (pk(i) <= obs * (1 + 1e-9)) s += pk(i);
  return Math.min(1, s);
}

/** Her takvim ayı için son `lookback` KAPANMIŞ gözlemden istatistik. */
export function monthStats(cells: MonthCell[], lookback = 10): { stats: MonthStat[]; baseUpRate: number; typicalAbs: number } {
  const closed = cells.filter((c) => !c.partial);
  const recent = closed.slice(-lookback * 12);
  const baseUpRate = recent.filter((c) => c.ret > 0).length / Math.max(recent.length, 1);
  const absSorted = recent.map((c) => Math.abs(c.ret)).sort((a, b) => a - b);
  const typicalAbs = absSorted[Math.floor(absSorted.length / 2)] ?? 0.03;
  const stats: MonthStat[] = [];
  for (let m = 1; m <= 12; m++) {
    const xs = closed.filter((c) => Number(c.month.slice(5, 7)) === m).slice(-lookback).map((c) => c.ret);
    const sorted = [...xs].sort((a, b) => a - b);
    const up = xs.filter((x) => x > 0).length;
    stats.push({
      month: m,
      n: xs.length,
      up,
      avg: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN,
      median: xs.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : NaN,
      best: xs.length ? sorted[sorted.length - 1] : NaN,
      worst: xs.length ? sorted[0] : NaN,
      pValue: xs.length ? binomialP(xs.length, up, baseUpRate) : 1,
    });
  }
  return { stats, baseUpRate, typicalAbs };
}

export interface Insight {
  kind: "strong" | "weak" | "event" | "upcoming";
  /** 1..12 (mevsimsellik içgörüleri için) */
  month?: number;
  text: string;
  /** "güçlü" | "orta" | "zayıf" kanıt */
  evidence: "güçlü" | "orta" | "zayıf";
  score: number;
}

const evidenceOf = (p: number): Insight["evidence"] => (p < 0.05 ? "güçlü" : p < 0.2 ? "orta" : "zayıf");

export function seasonalInsights(assetName: string, stats: MonthStat[]): Insight[] {
  const out: Insight[] = [];
  for (const s of stats) {
    if (s.n < 6) continue;
    const ratio = s.up / s.n;
    const name = MONTHS_TR_LONG[s.month - 1];
    if (ratio >= 0.7)
      out.push({ kind: "strong", month: s.month, evidence: evidenceOf(s.pValue), score: ratio + (s.avg > 0 ? 0.01 : 0), text: `${assetName} ${name} ayını son ${s.n} yılda ${s.up} kez YEŞİL kapattı (ort. ${fmt(s.avg)}, medyan ${fmt(s.median)}).` });
    else if (ratio <= 0.3)
      out.push({ kind: "weak", month: s.month, evidence: evidenceOf(s.pValue), score: 1 - ratio, text: `${assetName} ${name} ayını son ${s.n} yılda ${s.n - s.up} kez KIRMIZI kapattı (ort. ${fmt(s.avg)}, en kötü ${fmt(s.worst)}).` });
  }
  return out.sort((a, b) => b.score - a.score);
}

function fmt(x: number): string {
  return `${x >= 0 ? "+" : "−"}%${Math.abs(x * 100).toFixed(1)}`;
}

// ---------------------------------------------------------------- olay çalışması

/** `date` gününde veya öncesindeki son kapanış indeksi */
function idxOnOrBefore(bars: Bar[], date: string): number {
  let lo = 0;
  let hi = bars.length - 1;
  if (bars.length === 0 || bars[0].date > date) return -1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (bars[mid].date <= date) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
}

export interface EventWindowResult {
  event: MarketEvent;
  /** Olaydan önceki `preDays` günlük getiri (olay gününe kadar) */
  pre?: number;
  /** Olaydan önceki 91 gün */
  pre3m?: number;
  /** Olaydan sonraki 1 ay ve 3 ay */
  post1m?: number;
  post3m?: number;
}

export interface EventTypeSummary {
  type: EventType;
  label: string;
  n: number;
  preAvg: number;
  preUp: number;
  pre3mAvg: number;
  pre3mUp: number;
  post1mAvg: number;
  post1mUp: number;
  n3m: number;
  post3mAvg: number;
  post3mUp: number;
  /** Aynı uzunluktaki rastgele pencerelerin ortalama getirisi (karşılaştırma tabanı) */
  baselinePre: number;
  baselinePost3m: number;
  rows: EventWindowResult[];
}

export const PRE_DAYS = 182;

function windowRet(bars: Bar[], from: string, to: string): number | undefined {
  const a = idxOnOrBefore(bars, from);
  const b = idxOnOrBefore(bars, to);
  if (a < 0 || b < 0 || b <= a) return undefined;
  if (Date.parse(bars[bars.length - 1].date) < Date.parse(to) - 5 * 86_400_000) return undefined;
  return bars[b].close / bars[a].close - 1;
}

/** Tüm tarih boyunca `days` günlük pencerelerin ortalama getirisi (ayda bir örnek) */
export function baselineReturn(bars: Bar[], days: number, sinceDate: string): number {
  const xs: number[] = [];
  for (let d = sinceDate; Date.parse(d) + days * 86_400_000 < Date.parse(bars[bars.length - 1].date); d = shiftDays(d, 30)) {
    const r = windowRet(bars, d, shiftDays(d, days));
    if (r !== undefined) xs.push(r);
  }
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

export function eventStudy(bars: Bar[], scopes: Scope[], types: EventType[] = ["us_presidential", "us_midterm", "tr_general", "tr_local", "btc_halving"]): EventTypeSummary[] {
  const out: EventTypeSummary[] = [];
  if (!bars.length) return out;
  for (const type of types) {
    const evs = EVENTS.filter((e) => e.type === type && !e.upcoming && e.scope.some((s) => scopes.includes(s)));
    const rows: EventWindowResult[] = evs
      .map((e) => ({
        event: e,
        pre: windowRet(bars, shiftDays(e.date, -PRE_DAYS), e.date),
        pre3m: windowRet(bars, shiftDays(e.date, -91), e.date),
        post1m: windowRet(bars, e.date, shiftDays(e.date, 30)),
        post3m: windowRet(bars, e.date, shiftDays(e.date, 91)),
      }))
      .filter((r) => r.pre !== undefined);
    if (!rows.length) continue;
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
    const pre = rows.map((r) => r.pre!);
    const p1 = rows.map((r) => r.post1m).filter((x): x is number => x !== undefined);
    const p3 = rows.map((r) => r.post3m).filter((x): x is number => x !== undefined);
    const since = rows[0].event.date.slice(0, 4) + "-01-01";
    out.push({
      type,
      label: EVENT_TYPE_LABEL[type],
      n: rows.length,
      preAvg: avg(pre),
      preUp: pre.filter((x) => x > 0).length,
      pre3mAvg: avg(rows.map((r) => r.pre3m!)),
      pre3mUp: rows.filter((r) => r.pre3m! > 0).length,
      post1mAvg: avg(p1),
      post1mUp: p1.filter((x) => x > 0).length,
      n3m: p3.length,
      post3mAvg: avg(p3),
      post3mUp: p3.filter((x) => x > 0).length,
      baselinePre: baselineReturn(bars, PRE_DAYS, since),
      baselinePost3m: baselineReturn(bars, 91, since),
      rows,
    });
  }
  return out;
}

export function eventInsights(assetName: string, sums: EventTypeSummary[]): Insight[] {
  const out: Insight[] = [];
  for (const s of sums) {
    if (s.n < 2) continue;
    const preDiff = s.preAvg - s.baselinePre;
    const parts = [`${assetName}, son ${s.n} ${s.label} öncesi: 6 ayda ${s.preUp}/${s.n} yükseliş (ort. ${fmt(s.preAvg)}; herhangi bir 6 ayın ort. ${fmt(s.baselinePre)}), son 3 ayda ${s.pre3mUp}/${s.n} (ort. ${fmt(s.pre3mAvg)})`];
    if (s.n3m) parts.push(`sonraki 3 ayda ${s.post3mUp}/${s.n3m} yükseliş (ort. ${fmt(s.post3mAvg)}; herhangi bir 3 ayın ort. ${fmt(s.baselinePost3m)})`);
    out.push({ kind: "event", evidence: s.n >= 4 && Math.abs(preDiff) > 0.05 ? "orta" : "zayıf", score: Math.abs(preDiff), text: parts.join("; ") + "." });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Bir takvim ayına düşen olay notları */
export function notesByMonth(scopes: Scope[]): Record<string, MarketEvent[]> {
  const out: Record<string, MarketEvent[]> = {};
  for (const e of EVENTS) {
    if (!e.scope.some((s) => scopes.includes(s))) continue;
    (out[e.date.slice(0, 7)] ??= []).push(e);
  }
  return out;
}
