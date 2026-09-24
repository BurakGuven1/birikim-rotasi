/** Tüm indikatörler giriş uzunluğunda dizi döndürür; yeterli veri yoksa NaN. */

export function sma(values: number[], n: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(values: number[], n: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  const k = 2 / (n + 1);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    if (i === n - 1) prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
    else if (i >= n) prev = values[i] * k + prev * (1 - k);
    if (i >= n - 1) out[i] = prev;
  }
  return out;
}

/** Wilder RSI */
export function rsi(values: number[], n: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);
    if (i <= n) {
      gain += g / n;
      loss += l / n;
      if (i < n) continue;
    } else {
      gain = (gain * (n - 1) + g) / n;
      loss = (loss * (n - 1) + l) / n;
    }
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export interface HLC { high: number; low: number; close: number }

/** Wilder ATR */
export function atr(bars: HLC[], n: number): number[] {
  const out = new Array<number>(bars.length).fill(NaN);
  let prev = NaN;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const pc = bars[i - 1].close;
    const tr = Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
    if (i < n) {
      prev = Number.isNaN(prev) ? tr : prev + tr;
      continue;
    }
    prev = i === n ? (prev + tr) / n : (prev * (n - 1) + tr) / n;
    out[i] = prev;
  }
  return out;
}

/** Bir önceki n barın en yüksek/en düşüğü (mevcut bar HARİÇ — ileriye bakma yok). */
export function donchian(bars: HLC[], n: number): { upper: number[]; lower: number[] } {
  const upper = new Array<number>(bars.length).fill(NaN);
  const lower = new Array<number>(bars.length).fill(NaN);
  for (let i = n; i < bars.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - n; j < i; j++) {
      hi = Math.max(hi, bars[j].high);
      lo = Math.min(lo, bars[j].low);
    }
    upper[i] = hi;
    lower[i] = lo;
  }
  return { upper, lower };
}

export function stdev(values: number[]): number {
  const n = values.length;
  if (n < 2) return NaN;
  const m = values.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
}
