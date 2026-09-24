import { futureValue } from "./montecarlo.ts";

/** Hedef servete ulaşmak için gereken sabit reel yıllık getiri (ikiye bölme). */
export function requiredReturn(target: number, years: number, monthly: number, annual: number): number {
  let lo = -0.5;
  let hi = 2;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (futureValue(mid, years, monthly, annual) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Belirli getiriyle hedefe kaç yılda ulaşılır (ay hassasiyetinde). */
export function yearsToTarget(target: number, realAnnual: number, monthly: number, annual: number, maxYears = 60): number {
  const rm = (1 + realAnnual) ** (1 / 12) - 1;
  let v = 0;
  for (let m = 0; m < maxYears * 12; m++) {
    v = (v + monthly + (m % 12 === 0 ? annual : 0)) * (1 + rm);
    if (v >= target) return (m + 1) / 12;
  }
  return Infinity;
}
