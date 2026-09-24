import type { Bar, Point } from "../data/types.ts";

export const monthKey = (date: string): string => date.slice(0, 7);

/** Her ayın son işlem günü kapanışı: Map<YYYY-MM, close> */
export function monthlyCloses(bars: Bar[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of bars) m.set(monthKey(b.date), b.close);
  return m;
}

export function monthlyPoints(points: Point[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of points) m.set(monthKey(p.date), p.value);
  return m;
}

/** start..end dahil ay listesi */
export function monthRange(start: string, end: string): string[] {
  const out: string[] = [];
  let [y, mo] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  while (y < ey || (y === ey && mo <= em)) {
    out.push(`${y}-${String(mo).padStart(2, "0")}`);
    mo++;
    if (mo > 12) { mo = 1; y++; }
  }
  return out;
}

/** Eksik ayları son bilinen değerle doldurur (TÜFE bir ay gecikmeli yayımlanır). */
export function forwardFill(map: Map<string, number>, months: string[]): Map<string, number> {
  const out = new Map<string, number>();
  const keys = [...map.keys()].sort();
  let k = 0;
  let last: number | undefined;
  for (const m of months) {
    while (k < keys.length && keys[k] <= m) { last = map.get(keys[k]); k++; }
    if (last !== undefined) out.set(m, last);
  }
  return out;
}
