import type { Candle } from './types';

/**
 * Pine Script v5 built-ins, reproduced exactly enough to port a strategy without changing what it
 * decides. Each returns a full-length array aligned to the input, NaN where the series is not yet
 * defined, so an index into a result always means the same bar as the same index into the candles.
 *
 * The seeding matters more than the formula: Pine seeds `ta.ema` and `ta.rma` with a simple average
 * of the first `length` values rather than with the first value alone, and a port that starts from
 * the first value drifts for hundreds of bars afterwards.
 */
const filled = (length: number) => new Array<number>(length).fill(NaN);

/**
 * A running sum alone cannot average a series that begins undefined — one NaN entering the
 * accumulator poisons every later value. Since these functions are routinely composed over one
 * another (`sma(atr(...), 100)` is the daily volatility regime), the window is tracked instead:
 * undefined while it still contains a gap, and defined again the moment the gap slides out.
 */
export function sma(source: number[], length: number): number[] {
  const out = filled(source.length);
  let sum = 0, gaps = 0;
  for (let i = 0; i < source.length; i++) {
    if (Number.isFinite(source[i])) sum += source[i]; else gaps++;
    if (i >= length) {
      if (Number.isFinite(source[i - length])) sum -= source[i - length]; else gaps--;
    }
    if (i >= length - 1 && gaps === 0) out[i] = sum / length;
  }
  return out;
}

export function ema(source: number[], length: number): number[] {
  const out = filled(source.length);
  const alpha = 2 / (length + 1);
  const seed = sma(source, length);
  let started = false;
  for (let i = 0; i < source.length; i++) {
    if (!started) {
      if (Number.isNaN(seed[i])) continue;
      out[i] = seed[i]; started = true; continue;
    }
    out[i] = Number.isFinite(source[i]) ? source[i] * alpha + out[i - 1] * (1 - alpha) : out[i - 1];
  }
  return out;
}

/** Wilder's smoothing, seeded the way Pine seeds it. */
export function rma(source: number[], length: number): number[] {
  const out = filled(source.length);
  const seed = sma(source, length);
  let started = false;
  for (let i = 0; i < source.length; i++) {
    if (!started) {
      if (Number.isNaN(seed[i])) continue;
      out[i] = seed[i]; started = true; continue;
    }
    out[i] = Number.isFinite(source[i]) ? (out[i - 1] * (length - 1) + source[i]) / length : out[i - 1];
  }
  return out;
}

/** Population standard deviation: Pine's ta.stdev is biased by default. */
export function stdev(source: number[], length: number): number[] {
  const out = filled(source.length);
  const means = sma(source, length);
  for (let i = length - 1; i < source.length; i++) {
    if (Number.isNaN(means[i])) continue;
    let total = 0;
    for (let k = 0; k < length; k++) total += (source[i - k] - means[i]) ** 2;
    out[i] = Math.sqrt(total / length);
  }
  return out;
}

export function trueRange(bars: Candle[]): number[] {
  return bars.map((bar, i) => i === 0 ? bar.high - bar.low
    : Math.max(bar.high - bar.low, Math.abs(bar.high - bars[i - 1].close), Math.abs(bar.low - bars[i - 1].close)));
}

export const atr = (bars: Candle[], length: number): number[] => rma(trueRange(bars), length);

export function rsi(source: number[], length: number): number[] {
  const out = filled(source.length);
  const gains = source.map((value, i) => i === 0 ? 0 : Math.max(0, value - source[i - 1]));
  const losses = source.map((value, i) => i === 0 ? 0 : Math.max(0, source[i - 1] - value));
  // Pine drops bar 0 from the averages, so the smoothing starts one bar later than the raw series.
  const up = rma(gains.slice(1), length), down = rma(losses.slice(1), length);
  for (let i = 0; i < up.length; i++) {
    if (Number.isNaN(up[i]) || Number.isNaN(down[i])) continue;
    out[i + 1] = down[i] === 0 ? 100 : up[i] === 0 ? 0 : 100 - 100 / (1 + up[i] / down[i]);
  }
  return out;
}

/**
 * ta.linreg(source, length, offset): fits a least-squares line over the window and returns the
 * fitted value `offset` bars back from its end.
 */
export function linreg(source: number[], length: number, offset = 0): number[] {
  const out = filled(source.length);
  const sumX = (length - 1) * length / 2;
  const sumXX = (length - 1) * length * (2 * length - 1) / 6;
  const denominator = length * sumXX - sumX * sumX;
  if (denominator === 0) return out;
  for (let i = length - 1; i < source.length; i++) {
    let sumY = 0, sumXY = 0;
    for (let k = 0; k < length; k++) {
      const value = source[i - (length - 1) + k];
      if (Number.isNaN(value)) { sumY = NaN; break; }
      sumY += value; sumXY += k * value;
    }
    if (Number.isNaN(sumY)) continue;
    const slope = (length * sumXY - sumX * sumY) / denominator;
    out[i] = (sumY - slope * sumX) / length + slope * (length - 1 - offset);
  }
  return out;
}

/** ta.percentrank: share of the previous `length` values at or below the current one, 0-100. */
export function percentRank(source: number[], length: number): number[] {
  const out = filled(source.length);
  for (let i = length; i < source.length; i++) {
    if (Number.isNaN(source[i])) continue;
    let atOrBelow = 0, counted = 0;
    for (let k = 1; k <= length; k++) {
      const value = source[i - k];
      if (Number.isNaN(value)) continue;
      counted++;
      if (value <= source[i]) atOrBelow++;
    }
    if (counted) out[i] = atOrBelow / counted * 100;
  }
  return out;
}

export function highest(source: number[], length: number): number[] {
  const out = filled(source.length);
  for (let i = length - 1; i < source.length; i++) out[i] = Math.max(...source.slice(i - length + 1, i + 1));
  return out;
}

export function lowest(source: number[], length: number): number[] {
  const out = filled(source.length);
  for (let i = length - 1; i < source.length; i++) out[i] = Math.min(...source.slice(i - length + 1, i + 1));
  return out;
}

/**
 * For every entry bar, the index of the last higher-timeframe bar that had already closed when the
 * entry bar closed. This is what `request.security` without lookahead resolves to: the value the
 * chart could actually have shown at that moment, never the bar still forming.
 */
export function alignHigher(entry: Candle[], entrySpan: number, higher: Candle[], higherSpan: number): number[] {
  const out = new Array<number>(entry.length).fill(-1);
  let cursor = -1;
  for (let i = 0; i < entry.length; i++) {
    const closedAt = entry[i].time + entrySpan;
    while (cursor + 1 < higher.length && higher[cursor + 1].time + higherSpan <= closedAt) cursor++;
    out[i] = cursor;
  }
  return out;
}
