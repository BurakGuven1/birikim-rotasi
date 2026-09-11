import { priorAtr } from './mpa';
import { duration, type Candle, type Context, type Interval, type Signal, type Strategy } from './types';

/**
 * SuperTrend (Kıvanç Özdemir's widely published variant): an ATR band that ratchets in the
 * direction of trend and flips when price closes through the opposite band. A flip to the up
 * trend is the buy, a flip to the down trend is the sell; here they become long and short entries.
 *
 * The published defaults are ATR period 10 and multiplier 3 on the hl2 source, and they are used
 * unchanged so the result stays interpretable rather than fitted to our data.
 */
export const supertrendPeriod = 10;
export const supertrendMultiplier = 3;

export interface SupertrendPoint { time: number; trend: 1 | -1; band: number; flipped: boolean }

/**
 * Causal by construction: bar i uses only bars up to i, and each band ratchets from the previous
 * bar's band exactly as the published script does with nz(up[1], up).
 */
export function supertrend(bars: Candle[], period = supertrendPeriod, multiplier = supertrendMultiplier): SupertrendPoint[] {
  const out: SupertrendPoint[] = [];
  let up = NaN, down = NaN, trend: 1 | -1 = 1;
  for (let i = 0; i < bars.length; i++) {
    const atr = priorAtr(bars, i + 1, period);
    if (!Number.isFinite(atr) || atr <= 0) continue;
    const source = (bars[i].high + bars[i].low) / 2;
    const rawUp = source - multiplier * atr, rawDown = source + multiplier * atr;
    const previousUp = Number.isFinite(up) ? up : rawUp, previousDown = Number.isFinite(down) ? down : rawDown;
    const previousClose = i > 0 ? bars[i - 1].close : bars[i].close;
    up = previousClose > previousUp ? Math.max(rawUp, previousUp) : rawUp;
    down = previousClose < previousDown ? Math.min(rawDown, previousDown) : rawDown;
    const previousTrend = trend;
    trend = trend === -1 && bars[i].close > previousDown ? 1 : trend === 1 && bars[i].close < previousUp ? -1 : trend;
    out.push({ time: bars[i].time, trend, band: trend === 1 ? up : down, flipped: out.length > 0 && trend !== previousTrend });
  }
  return out;
}

export function inspectSupertrend(context: Context, interval: Interval, rewardRisk = 2): Signal | null {
  if (!context.ready) return null;
  const bars = context.frames[interval].filter(b => b.time + duration[interval] <= context.now).slice(-260);
  const last = bars.at(-1);
  if (bars.length < 60 || !last || last.time + duration[interval] !== context.now) return null;
  const line = supertrend(bars);
  const point = line.at(-1);
  if (!point || !point.flipped || point.time !== last.time) return null;
  const sign = point.trend;
  const tick = context.instrument?.tickSz ?? 1e-8;
  const round = (value: number, up: boolean) => Number(((up ? Math.ceil(value / tick) : Math.floor(value / tick)) * tick).toFixed(12));
  // The stop is the SuperTrend band itself: the level whose breach would flip the trend back.
  const stop = round(point.band, sign < 0);
  // The band is the risk unit, so the target is expressed as a multiple of that same distance
  // rather than a second, unrelated ATR figure that could sit inside the stop.
  const target = round(last.close + (last.close - stop) * rewardRisk, sign < 0);
  if ((last.close - stop) * sign <= tick || (target - last.close) * sign <= tick) return null;
  return {
    direction: sign > 0 ? 'long' : 'short', entry: last.close, stop,
    targets: [{ price: target, fraction: 1 }], runnerFraction: 0, entryInterval: interval,
    trailing: { activateAtR: 2, distanceR: 1 }, maxHoldHours: duration[interval] / 3_600_000 * 96,
    // The trend flipping back is the strategy's own exit, so a reversal closes the position.
    exitOnReversal: true, setupId: `${interval}:supertrend:${last.time}:${sign}`, model: 'supertrend-flip',
    expiresAt: context.now + duration['15m'],
    confirmations: {
      '15m': `${interval} kapanışında SuperTrend yön değiştirdi; sonraki 15m açılışında emir.`,
      '1H': `ATR ${supertrendPeriod}, çarpan ${supertrendMultiplier} — yayımlanmış varsayılanlar.`,
      '4H': 'Stop, trendi geri çevirecek bandın kendisidir.',
    },
  };
}

export function createSupertrendStrategy(interval: Interval): Strategy {
  return { id: `SuperTrend ${interval}`, version: 'st-1.0.0', entryInterval: interval, requireBias: false,
    warmup: { '15m': interval === '15m' ? 80 : 30, '1H': interval === '1H' ? 80 : 30, '4H': interval === '4H' ? 80 : 30 },
    evaluate: context => inspectSupertrend(context, interval) };
}
