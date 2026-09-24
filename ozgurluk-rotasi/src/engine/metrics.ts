import { stdev } from "./indicators.ts";

/** Aylık nakit akışlarının iç verim oranı (aylık). flows[i]: i. ay sonundaki akış (yatırım negatif, son değer pozitif). */
export function irrMonthly(flows: number[]): number {
  const npv = (r: number) => flows.reduce((acc, f, i) => acc + f / (1 + r) ** i, 0);
  let lo = -0.99;
  let hi = 1.0;
  if (npv(lo) * npv(hi) > 0) return NaN;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export const annualize = (monthly: number): number => (1 + monthly) ** 12 - 1;

export function cagrFromReturns(monthlyReturns: number[]): number {
  if (monthlyReturns.length === 0) return NaN;
  const growth = monthlyReturns.reduce((acc, r) => acc * (1 + r), 1);
  return growth ** (12 / monthlyReturns.length) - 1;
}

export function maxDrawdown(returns: number[]): number {
  let peak = 1;
  let v = 1;
  let mdd = 0;
  for (const r of returns) {
    v *= 1 + r;
    peak = Math.max(peak, v);
    mdd = Math.min(mdd, v / peak - 1);
  }
  return mdd;
}

export function annualVol(monthlyReturns: number[]): number {
  return stdev(monthlyReturns) * Math.sqrt(12);
}

export function sharpe(monthlyReturns: number[], monthlyRf: number[]): number {
  const ex = monthlyReturns.map((r, i) => r - (monthlyRf[i] ?? 0));
  const m = ex.reduce((a, b) => a + b, 0) / ex.length;
  const s = stdev(ex);
  return (m / s) * Math.sqrt(12);
}

/** Takvim yılı bazında getiri (aylık getiri dizisi + ay etiketleri) */
export function calendarYears(months: string[], returns: number[]): { year: string; ret: number }[] {
  const byYear = new Map<string, number>();
  months.forEach((m, i) => {
    const y = m.slice(0, 4);
    byYear.set(y, (byYear.get(y) ?? 1) * (1 + returns[i]));
  });
  return [...byYear.entries()].map(([year, g]) => ({ year, ret: g - 1 }));
}
