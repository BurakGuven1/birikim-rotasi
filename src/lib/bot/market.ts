import { duration, intervals, type Frames, type Context, type Interval } from './types';
import type { Candle } from './types';

const normalizedSnapshots = new WeakMap<Candle[], Candle[]>();
/** Providers supply immutable snapshots; normalize once and binary-search the closed prefix. */
function closedWindow(input: Candle[], now: number, span: number, count: number) {
  let bars = normalizedSnapshots.get(input);
  if (!bars) {
    bars = input.filter(b => Number.isFinite(b.time) && [b.open, b.high, b.low, b.close].every(v => Number.isFinite(v) && v > 0) && b.low <= Math.min(b.open,b.close) && b.high >= Math.max(b.open,b.close) && Number.isFinite(b.volume) && b.volume >= 0)
      .toSorted((a,b) => a.time-b.time).filter((b,i,all) => !i || b.time !== all[i-1].time);
    normalizedSnapshots.set(input, bars);
  }
  let low = 0, high = bars.length;
  while (low < high) { const middle = (low + high) >>> 1; if (bars[middle].time + span <= now) low = middle + 1; else high = middle; }
  return bars.slice(Math.max(0,low-count),low);
}

export function closedContext(data: Frames, now: number, warmup: Record<Interval, number>, requireBias = true): Context {
  const frames = {} as Frames;
  const reasons: string[] = [];
  for (const interval of intervals) {
    const bars = closedWindow(data[interval], now, duration[interval], Math.max(warmup[interval], 200));
    frames[interval] = bars;
    if (warmup[interval] === 0) continue;
    if (bars.length < warmup[interval]) reasons.push(`${interval}: yeterli kapanmış mum yok`);
    const tail = bars.slice(-Math.max(warmup[interval], 2));
    if (tail.some((b, i) => i > 0 && b.time - tail[i - 1].time !== duration[interval])) reasons.push(`${interval}: mum boşluğu`);
    if (!bars.length || now - (bars.at(-1)!.time + duration[interval]) >= duration[interval]) reasons.push(`${interval}: veri eski`);
  }
  if (data.bias) {
    // A 4H entry reads its trend bias off the daily series, and that bias is a 200-period EMA, so
    // an 80-bar window left every 4H strategy permanently short of history and silently signalless.
    frames.bias = { daily: closedWindow(data.bias.daily,now,86_400_000,300), weekly: closedWindow(data.bias.weekly,now,604_800_000,60) };
    for (const [key, span] of [['daily',86_400_000],['weekly',604_800_000]] as const) {
      const bars = frames.bias[key];
      if (requireBias && (bars.length < 50 || !bars.length || now - (bars.at(-1)!.time + span) >= span || bars.some((b,i) => i>0 && b.time-bars[i-1].time !== span))) reasons.push(`${key}: HTF verisi eksik veya eski`);
    }
  }
  return { now, frames, ready: reasons.length === 0, reasons };
}
