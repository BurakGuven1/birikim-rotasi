import type { Candle, Context, Signal, Strategy } from './types';

export const MPA_RULES = Object.freeze({ bodyAtr: 1.3, volumeMultiple: 1.5, retestHours: 16, stopAtr: .15, tpFraction: .85, runnerFraction: .15, maxHoldHours: 168 });
export interface Swing { index: number; price: number; kind: 'high' | 'low'; confirmedAt: number }
const average = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;

export function priorAtr(bars: Candle[], index = bars.length, period = 14): number {
  if (index < period + 1) return NaN;
  return average(bars.slice(index - period, index).map((b, offset) => {
    const prior = bars[index - period + offset - 1].close;
    return Math.max(b.high - b.low, Math.abs(b.high - prior), Math.abs(b.low - prior));
  }));
}

/** A local extreme becomes usable only after 3 right candles AND the preceding wick is breached. */
export function confirmedSwings(bars: Candle[]): Swing[] {
  const swings: Swing[] = [];
  for (let i = 3; i < bars.length - 3; i++) {
    for (const kind of ['high', 'low'] as const) {
      const value = bars[i][kind];
      if (!bars.slice(i - 3, i).every(b => kind === 'high' ? b.high < value : b.low > value)) continue;
      let breached = false;
      for (let j = i + 1; j <= Math.min(i + 14, bars.length - 1); j++) {
        if (kind === 'high' ? bars[j].high >= value : bars[j].low <= value) break;
        if (kind === 'high' ? bars[j].low < bars[i - 1].low : bars[j].high > bars[i - 1].high) breached = true;
        if (breached && j >= i + 3) { swings.push({ index: i, price: value, kind, confirmedAt: j }); break; }
      }
    }
  }
  return swings.sort((a, b) => a.index - b.index);
}

export function displacement(bars: Candle[], index: number, bodyAtr: number = MPA_RULES.bodyAtr, volumeMultiple: number = MPA_RULES.volumeMultiple): boolean {
  if (index < 21) return false;
  const bar = bars[index], atr = priorAtr(bars, index), volume = average(bars.slice(index - 20, index).map(b => b.volume));
  return atr > 0 && volume > 0 && Math.abs(bar.close - bar.open) >= bodyAtr * atr && bar.volume >= volume * volumeMultiple;
}

function ema(bars: Candle[], period: number): number {
  if (bars.length < period) return NaN;
  let value = average(bars.slice(0, period).map(b => b.close));
  for (const bar of bars.slice(period)) value += 2 / (period + 1) * (bar.close - value);
  return value;
}
function bias(bars: Candle[]): number {
  if (bars.length < 50) return 0;
  const fast = ema(bars, 20), slow = ema(bars, 50), close = bars.at(-1)!.close;
  return close > fast && fast > slow ? 1 : close < fast && fast < slow ? -1 : 0;
}
function targets(bars: Candle[], sign: number, entry: number): number[] {
  const levels = confirmedSwings(bars).filter(s => s.kind === (sign === 1 ? 'high' : 'low') && (s.price - entry) * sign > 0 &&
    bars.slice(s.confirmedAt + 1).every(b => (b.close - s.price) * sign <= 0)).map(s => s.price);
  // Opposing, not yet revisited, three-candle imbalance boundary.
  for (let i = 2; i < bars.length - 1; i++) {
    const boundary = sign === 1 ? bars[i].high : bars[i].low;
    const gap = sign === 1 ? bars[i].high < bars[i - 2].low : bars[i].low > bars[i - 2].high;
    if (gap && (boundary - entry) * sign > 0 && bars.slice(i + 1).every(b => sign === 1 ? b.high < boundary : b.low > boundary)) levels.push(boundary);
  }
  return levels;
}

export function inspectMpa(context: Context): { signal: Signal | null; reason: string } {
  const wait = (reason: string) => ({ signal: null, reason });
  const { frames } = context;
  if (!frames.bias || frames.bias.daily.length < 50 || frames.bias.weekly.length < 50) return wait('Kapanmış günlük/haftalık yön verisi yetersiz.');
  if (!context.ready) return wait(context.reasons.join(' · '));
  const daily = bias(frames.bias.daily), weekly = bias(frames.bias.weekly);
  if (!daily || daily !== weekly) return wait('Günlük ve haftalık yön aynı değil.');
  const sign = daily;
  if (bias(frames['4H'].slice(-100)) !== sign) return wait('4 saatlik yön teyidi bekleniyor.');
  // Fixed windows make historical warmup and continuous paper evaluation identical.
  const hours = frames['1H'].slice(-200), entries = frames['15m'].slice(-100);
  if (hours.length < 80 || entries.length < 80) return wait('Yapı için yeterli kapanmış mum yok.');
  const swings = confirmedSwings(hours), last = entries.at(-1)!;
  const atr = priorAtr(entries), hourAtr = priorAtr(hours);
  if (!(atr > 0 && hourAtr > 0)) return wait('Volatilite ölçümü yetersiz.');
  const tick = context.instrument?.tickSz ?? 1e-8;
  const lower = (p: number) => Number((Math.floor(p / tick) * tick).toFixed(12));
  const upper = (p: number) => Number((Math.ceil(p / tick) * tick).toFixed(12));
  for (let i = hours.length - 2; i >= Math.max(22, hours.length - MPA_RULES.retestHours - 1); i--) {
    const breakout = hours[i];
    if ((breakout.close - breakout.open) * sign <= 0 || !displacement(hours, i)) continue;
    const level = swings.filter(s => s.confirmedAt < i && s.kind === (sign === 1 ? 'high' : 'low')).at(-1);
    if (!level || (breakout.close - level.price) * sign <= 0 || (hours[i - 1].close - level.price) * sign > 0) continue;
    const anchor = swings.filter(s => s.confirmedAt < i && s.kind === (sign === 1 ? 'low' : 'high')).at(-1);
    if (!anchor) continue;
    const impulseEnd = sign === 1 ? breakout.high : breakout.low;
    const impulseSize = (impulseEnd - anchor.price) * sign;
    if (impulseSize <= 0 || hours.slice(i + 1).some(b => (b.close - anchor.price) * sign <= 0)) continue;
    const recent = entries.filter(b => b.time >= breakout.time + 3_600_000).slice(-8);
    if (recent.length < 2) continue;
    const tolerance = hourAtr * .2;
    const retest = recent.some(b => b.low <= level.price + tolerance && b.high >= level.price - tolerance);
    const oteA = impulseEnd - sign * impulseSize * .618, oteB = impulseEnd - sign * impulseSize * .79;
    const ote = recent.some(b => b.low <= Math.max(oteA, oteB) && b.high >= Math.min(oteA, oteB));
    if (!retest && !ote) continue;
    const previous = entries.at(-2)!;
    const reclaim = (last.close - (sign === 1 ? previous.high : previous.low)) * sign > 0;
    const recoveryRange = Math.max(...recent.map(b => b.high)) - Math.min(...recent.map(b => b.low));
    const recovered = sign === 1 ? last.close - Math.min(...recent.map(b => b.low)) : Math.max(...recent.map(b => b.high)) - last.close;
    if (!reclaim || (last.close - last.open) * sign <= 0 || recovered < recoveryRange * .6 || !displacement(entries, entries.length - 1, .6, 1.2)) continue;
    if (retest && !ote && (last.close - level.price) * sign <= 0) continue;
    // The structural invalidation is the actual retest/sweep extreme, not an arbitrary percentage.
    const rawStop = sign === 1 ? Math.min(...recent.map(b => b.low)) - atr * MPA_RULES.stopAtr : Math.max(...recent.map(b => b.high)) + atr * MPA_RULES.stopAtr;
    const stop = sign === 1 ? lower(rawStop) : upper(rawStop);
    if ((last.close - stop) * sign <= tick) continue;
    const candidates = [...targets(entries, sign, last.close), ...targets(hours, sign, last.close)];
    if ((impulseEnd - last.close) * sign > 0) candidates.push(impulseEnd);
    const nearest = [...new Set(candidates)].sort((a, b) => (a - b) * sign)[0];
    if (nearest === undefined) continue;
    const tp1 = sign === 1 ? lower(nearest) : upper(nearest);
    if ((tp1 - last.close) * sign <= tick) continue;
    const sweep = hours.slice(Math.max(anchor.index + 1, i - 12), i).some(b => sign === 1 ? b.low < anchor.price && b.close > anchor.price : b.high > anchor.price && b.close < anchor.price);
    const model = sweep ? 'sweep-breaker-retest' : ote ? 'msb-ote-retest' : 'momentum-msb-retest';
    return { reason: 'Üç zaman dilimi ve HTF yönü teyitli.', signal: {
      direction: sign === 1 ? 'long' : 'short', entry: last.close, stop, targets: [{ price: tp1, fraction: .85 }], runnerFraction: .15,
      manageAfterTp1: true, setupId: `${breakout.time}:${sign}`, model, expiresAt: last.time + 1_800_000,
      confirmations: { '15m': 'Kapanışla retest/V dönüşü; önceki mum aşımı ve hacim teyidi.', '1H': `${model}: ${new Date(breakout.time).toISOString()} yapı kırılımı.`, '4H': `4H yön teyidi; günlük ve haftalık EMA20/50 ${sign === 1 ? 'yukarı' : 'aşağı'}.` },
    } };
  }
  return wait(`HTF ${sign === 1 ? 'long' : 'short'}; hacimli 1H kırılımı ve 15m retest/geri kazanım bekleniyor.`);
}

export const mpaStrategy: Strategy = { id: 'MPA teyitli yapı', version: '1.0.0', warmup: { '15m': 100, '1H': 200, '4H': 100 }, evaluate: context => inspectMpa(context).signal };
