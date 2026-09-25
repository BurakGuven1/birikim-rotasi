import type { AssetId, TrendRule } from "../config.ts";
import { annualVol, annualize, calendarYears, cagrFromReturns, irrMonthly, maxDrawdown, sharpe } from "./metrics.ts";

export interface CoreData {
  /** Ortak ay ekseni (YYYY-MM), artan */
  months: string[];
  /** Ay sonu kapanışları (USD, toplam getiri) */
  prices: Record<AssetId, Map<string, number>>;
  /** Hazine bonosu yıllık faizi, % (ay sonu) */
  tbill: Map<string, number>;
  /** ABD TÜFE endeksi */
  cpi: Map<string, number>;
  costBps: Record<AssetId, number>;
}

export interface Contributions {
  monthly: number;
  annual: number;
  annualMonth: number;
  /** true: katkılar TÜFE ile büyütülür (reel olarak sabit) */
  inflationIndexed: boolean;
}

export interface CoreOptions {
  name: string;
  weights: Partial<Record<AssetId, number>>;
  rule: TrendRule;
  /** 0..1: trend kapalıyken bile tutulan stratejik ağırlık payı (0 = tamamen nakde geç) */
  trendFloor?: number;
  smaMonths?: number;
  momentumMonths?: number;
  volTarget?: number;
  maxGross?: number;
  borrowSpread?: number;
  /**
   * Takvim (mevsimsellik) katmanı: bir sonraki ayın geçmiş "yeşil kapanış" oranına göre
   * varlık o ay satılır (≤ sellAt) ya da ağırlığı artırılır (≥ buyAt).
   * walkforward: yalnız o tarihe kadar bilinen yıllar · insample: tüm veri (ileriye bakar, yalnız kıyas için)
   */
  seasonal?: { lookback: number; sellAt: number; buyAt: number; overweight: number; mode: "walkforward" | "insample" };
  /** Uydu kolu: aylık getirileri ve sabit portföy payı */
  sleeve?: { returns: Map<string, number>; weight: number };
  contributions: Contributions;
  start: string;
  end: string;
}

export interface CoreResult {
  name: string;
  start: string;
  end: string;
  months: string[];
  value: number[];
  contributed: number[];
  /** Bitiş tarihinin doları cinsinden reel değer */
  realValue: number[];
  realContributed: number[];
  twr: number[];
  realTwr: number[];
  exposure: number[];
  lastWeights: Record<string, number>;
  metrics: CoreMetrics;
}

export interface CoreMetrics {
  finalValue: number;
  totalContributed: number;
  realFinalValue: number;
  realTotalContributed: number;
  /** Para ağırlıklı (katkı zamanlamasını hesaba katan) yıllık getiri */
  irr: number;
  realIrr: number;
  /** Zaman ağırlıklı yıllık getiri (strateji kalitesi) */
  cagr: number;
  realCagr: number;
  vol: number;
  maxDrawdown: number;
  realMaxDrawdown: number;
  sharpe: number;
  worstYear: number;
  bestYear: number;
  avgExposure: number;
  years: number;
}

const DEFAULT_SMA = 10;
const DEFAULT_MOM = 12;

/** Bir varlığın ay sonu trend skoru (0..1). i: ay indeksi. */
export function trendScore(
  closes: (number | undefined)[],
  i: number,
  rule: TrendRule,
  tbillPct: (number | undefined)[],
  smaMonths = DEFAULT_SMA,
  momMonths = DEFAULT_MOM,
): number {
  if (rule === "none") return 1;
  const c = closes[i];
  if (c === undefined) return 0;
  let smaOn = 0;
  let momOn = 0;
  const win = closes.slice(i - smaMonths + 1, i + 1);
  if (i - smaMonths + 1 >= 0 && win.every((v) => v !== undefined)) {
    const avg = (win as number[]).reduce((a, b) => a + b, 0) / smaMonths;
    smaOn = c > avg ? 1 : 0;
  }
  const past = closes[i - momMonths];
  if (past !== undefined) {
    // nakit getirisi: son 12 ayın ortalama bono faizi
    const rfs = tbillPct.slice(Math.max(0, i - momMonths + 1), i + 1).filter((v): v is number => v !== undefined);
    const rf = rfs.length ? rfs.reduce((a, b) => a + b, 0) / rfs.length / 100 : 0;
    momOn = c / past - 1 > rf * (momMonths / 12) ? 1 : 0;
  }
  if (rule === "sma10") return smaOn;
  if (rule === "tsmom12") return momOn;
  return 0.5 * smaOn + 0.5 * momOn;
}

/**
 * Takvim ayı `calMonth` (1..12) için yeşil kapanış oranı.
 * walkforward: `uptoIdx` dahil o ana kadar kapanmış ayların son `lookback` gözlemi.
 */
export function seasonalUpRatio(
  months: string[],
  closes: (number | undefined)[],
  calMonth: number,
  uptoIdx: number,
  lookback: number,
): { up: number; n: number } {
  const xs: number[] = [];
  for (let t = uptoIdx; t >= 1 && xs.length < lookback; t--) {
    if (Number(months[t].slice(5, 7)) !== calMonth) continue;
    const a = closes[t - 1];
    const b = closes[t];
    if (a !== undefined && b !== undefined) xs.push(b / a - 1);
  }
  return { up: xs.filter((x) => x > 0).length, n: xs.length };
}

/** Varlık yeterli geçmişe sahipse (momentum penceresi kadar) kullanılabilir. */
function available(closes: (number | undefined)[], i: number, lookback: number): boolean {
  return closes[i] !== undefined && closes[i - lookback] !== undefined;
}

function covariance(series: number[][]): number[][] {
  const k = series.length;
  const n = series[0]?.length ?? 0;
  const means = series.map((s) => s.reduce((a, b) => a + b, 0) / n);
  const cov: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let a = 0; a < k; a++)
    for (let b = a; b < k; b++) {
      let s = 0;
      for (let t = 0; t < n; t++) s += (series[a][t] - means[a]) * (series[b][t] - means[b]);
      cov[a][b] = cov[b][a] = s / (n - 1);
    }
  return cov;
}

export function runCore(data: CoreData, opt: CoreOptions): CoreResult {
  const allMonths = data.months;
  const i0 = allMonths.indexOf(opt.start);
  const i1 = allMonths.indexOf(opt.end);
  if (i0 < 0 || i1 < 0 || i1 <= i0) throw new Error(`Geçersiz aralık ${opt.start}..${opt.end}`);
  const ids = (Object.keys(opt.weights) as AssetId[]).filter((id) => (opt.weights[id] ?? 0) > 0);
  const closes: Record<string, (number | undefined)[]> = {};
  for (const id of ids) closes[id] = allMonths.map((m) => data.prices[id].get(m));
  const tb = allMonths.map((m) => data.tbill.get(m));
  const lookback = Math.max(opt.momentumMonths ?? DEFAULT_MOM, opt.smaMonths ?? DEFAULT_SMA);
  const sleeveW = opt.sleeve?.weight ?? 0;
  const cpi0 = data.cpi.get(allMonths[i0]) ?? NaN;
  const cpiEnd = data.cpi.get(allMonths[i1]) ?? NaN;

  const holdings: Record<string, number> = {};
  let cash = 0;
  const months: string[] = [];
  const value: number[] = [];
  const contributed: number[] = [];
  const realValue: number[] = [];
  const realContributed: number[] = [];
  const rets: number[] = [];
  const realRets: number[] = [];
  const rfRets: number[] = [];
  const exposure: number[] = [];
  const nominalFlows: number[] = [];
  const realFlows: number[] = [];
  let totalContrib = 0;
  let totalRealContrib = 0;
  let lastWeights: Record<string, number> = {};
  let prevV = 0;

  for (let i = i0; i <= i1; i++) {
    const m = allMonths[i];
    const cpi = data.cpi.get(m) ?? NaN;
    // 1) Bir önceki aydan bu aya getirileri uygula
    if (i > i0) {
      const pm = allMonths[i - 1];
      for (const k of Object.keys(holdings)) {
        let r: number;
        if (k === "SLEEVE") r = opt.sleeve?.returns.get(m) ?? 0;
        else {
          const p0 = data.prices[k as AssetId].get(pm);
          const p1 = data.prices[k as AssetId].get(m);
          r = p0 && p1 ? p1 / p0 - 1 : 0;
        }
        holdings[k] *= 1 + r;
      }
      const rf = (data.tbill.get(pm) ?? 0) / 100 / 12;
      cash *= 1 + (cash >= 0 ? rf : rf + (opt.borrowSpread ?? 0.02) / 12);
      const v = Object.values(holdings).reduce((a, b) => a + b, 0) + cash;
      const r = v / prevV - 1;
      rets.push(r);
      rfRets.push(rf);
      const cpiPrev = data.cpi.get(pm) ?? NaN;
      realRets.push((1 + r) * (cpiPrev / cpi) - 1);
    }

    // 2) Katkı
    const monthNum = Number(m.slice(5, 7));
    const idx = opt.contributions.inflationIndexed ? cpi / cpi0 : 1;
    let c = opt.contributions.monthly * idx;
    if (monthNum === opt.contributions.annualMonth) c += opt.contributions.annual * idx;
    if (i === i1) c = 0; // son ay yalnız değerleme
    cash += c;
    totalContrib += c;
    totalRealContrib += (c * cpiEnd) / cpi;

    const V = Object.values(holdings).reduce((a, b) => a + b, 0) + cash;

    // 3) Hedef ağırlıklar
    const avail = ids.filter((id) => available(closes[id], i, lookback));
    const baseSum = avail.reduce((a, id) => a + (opt.weights[id] ?? 0), 0);
    const w: Record<string, number> = {};
    for (const id of avail) {
      const strategic = ((opt.weights[id] ?? 0) / baseSum) * (1 - sleeveW);
      const score = trendScore(closes[id], i, opt.rule, tb, opt.smaMonths, opt.momentumMonths);
      const floor = opt.trendFloor ?? 0;
      w[id] = strategic * (floor + (1 - floor) * score);
    }
    if (opt.seasonal && i + 1 < allMonths.length) {
      const sz = opt.seasonal;
      const nextCal = Number(allMonths[i + 1].slice(5, 7));
      const upto = sz.mode === "insample" ? allMonths.length - 1 : i;
      for (const id of avail) {
        const { up, n } = seasonalUpRatio(allMonths, closes[id], nextCal, upto, sz.lookback);
        if (n < 6) continue;
        const r = up / n;
        if (r <= sz.sellAt) w[id] = 0;
        else if (r >= sz.buyAt) w[id] *= sz.overweight;
      }
      const tot = Object.values(w).reduce((a, b) => a + b, 0);
      if (tot > 1 - sleeveW) for (const id of Object.keys(w)) w[id] *= (1 - sleeveW) / tot;
    }
    if (opt.volTarget && avail.length) {
      const active = avail.filter((id) => w[id] > 0);
      if (active.length) {
        const win = Math.min(36, i);
        const rs = active.map((id) => {
          const out: number[] = [];
          for (let t = i - win + 1; t <= i; t++) {
            const a = closes[id][t - 1];
            const b = closes[id][t];
            if (a !== undefined && b !== undefined) out.push(b / a - 1);
          }
          return out;
        });
        const n = Math.min(...rs.map((s) => s.length));
        if (n >= 12) {
          const cov = covariance(rs.map((s) => s.slice(-n)));
          const wv = active.map((id) => w[id]);
          let varP = 0;
          for (let a = 0; a < wv.length; a++) for (let b = 0; b < wv.length; b++) varP += wv[a] * wv[b] * cov[a][b];
          const volP = Math.sqrt(varP * 12);
          // Tek tip ölçek: her varlık en fazla stratejik ağırlığının maxGross katına çıkabilir
          // (yalnız bir varlık açıkken ona yoğunlaşmış kaldıraç oluşmaz).
          const scale = Math.min(opt.volTarget / volP, opt.maxGross ?? 1.5);
          for (const id of active) w[id] *= scale;
        }
      }
    }
    if (opt.sleeve && sleeveW > 0) w.SLEEVE = sleeveW;
    lastWeights = { ...w };

    // 4) Yeniden dengele (işlem maliyetiyle)
    let cost = 0;
    const keys = new Set([...Object.keys(holdings), ...Object.keys(w)]);
    for (const k of keys) {
      const target = (w[k] ?? 0) * V;
      const cur = holdings[k] ?? 0;
      const bps = k === "SLEEVE" ? 0 : data.costBps[k as AssetId] ?? 10;
      cost += (Math.abs(target - cur) * bps) / 10_000;
      holdings[k] = target;
    }
    const invested = Object.values(holdings).reduce((a, b) => a + b, 0);
    cash = V - invested - cost;
    prevV = V;

    months.push(m);
    const vAfter = invested + cash;
    value.push(vAfter);
    contributed.push(totalContrib);
    realValue.push((vAfter * cpiEnd) / cpi);
    realContributed.push(totalRealContrib);
    exposure.push(invested / Math.max(vAfter, 1e-9));
    nominalFlows.push(-c);
    realFlows.push(-c / cpi);
  }

  const finalV = value[value.length - 1];
  nominalFlows[nominalFlows.length - 1] += finalV;
  realFlows[realFlows.length - 1] += finalV / cpiEnd;
  const years = calendarYears(months.slice(1), rets);
  const twr = [1];
  const realTwr = [1];
  rets.forEach((r, k) => twr.push(twr[k] * (1 + r)));
  realRets.forEach((r, k) => realTwr.push(realTwr[k] * (1 + r)));

  return {
    name: opt.name,
    start: opt.start,
    end: opt.end,
    months,
    value,
    contributed,
    realValue,
    realContributed,
    twr,
    realTwr,
    exposure,
    lastWeights,
    metrics: {
      finalValue: finalV,
      totalContributed: totalContrib,
      realFinalValue: realValue[realValue.length - 1],
      realTotalContributed: totalRealContrib,
      irr: annualize(irrMonthly(nominalFlows)),
      realIrr: annualize(irrMonthly(realFlows)),
      cagr: cagrFromReturns(rets),
      realCagr: cagrFromReturns(realRets),
      vol: annualVol(rets),
      maxDrawdown: maxDrawdown(rets),
      realMaxDrawdown: maxDrawdown(realRets),
      sharpe: sharpe(rets, rfRets),
      worstYear: Math.min(...years.map((y) => y.ret)),
      bestYear: Math.max(...years.map((y) => y.ret)),
      avgExposure: exposure.reduce((a, b) => a + b, 0) / exposure.length,
      years: rets.length / 12,
    },
  };
}
