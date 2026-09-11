import { confirmedSwings, priorAtr } from './mpa';
import { duration, type Candle, type Context, type Interval, type Signal, type Strategy } from './types';

// A versioned research interpretation, with fixed windows rather than fitted thresholds.
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function direction(bars: Candle[]) {
  const recent = bars.slice(-20);
  const atr = priorAtr(bars);
  const change = mean(recent.slice(-5).map(b => b.close)) - mean(recent.slice(0, 5).map(b => b.close));
  return Math.abs(change) > atr ? Math.sign(change) : 0;
}

export function inspectMpaV2(context: Context, interval: Interval): { signal: Signal | null; reason: string } {
  const wait = (reason: string) => ({ signal: null, reason });
  if (!context.ready) return wait(context.reasons.join(' · '));
  const bars = context.frames[interval].filter(b => b.time + duration[interval] <= context.now).slice(-100);
  const last = bars.at(-1);
  if (bars.length < 100 || !last || last.time + duration[interval] !== context.now) return wait(`${interval} kapanışı bekleniyor.`);
  const atr = priorAtr(bars, bars.length - 1);
  if (!(atr > 0)) return wait('Volatilite ölçümü yetersiz.');
  const higher = interval === '15m' ? '1H' : interval === '1H' ? '4H' : '1D';
  const higherBars = higher === '1D'
    ? (context.frames.bias?.daily ?? []).filter(b => b.time + 86_400_000 <= context.now).slice(-40)
    : context.frames[higher].filter(b => b.time + duration[higher] <= context.now).slice(-40);
  const bias = higherBars.length >= 40 ? direction(higherBars) : 0;
  const tick = context.instrument?.tickSz ?? 1e-8;
  const round = (value: number, up: boolean) => Number(((up ? Math.ceil(value / tick) : Math.floor(value / tick)) * tick).toFixed(12));
  const make = (sign: number, extreme: number, target: number, model: string, anchor: number) => {
    // A .15 ATR buffer sits inside a single bar's normal range; .5 ATR puts the stop outside routine noise.
    const stop = round(extreme - sign * atr * .5, sign < 0);
    const price = round(target, sign < 0);
    if ((last.close - stop) * sign <= tick || (price - last.close) * sign <= tick) return null;
    return { direction: sign > 0 ? 'long' : 'short', entry: last.close, stop,
      targets: [{ price, fraction: 1 }], runnerFraction: 0, entryInterval: interval,
      breakEvenAtR: 1.5, trailing: { activateAtR: 2, distanceR: 1 }, maxHoldHours: duration[interval] / 3_600_000 * 48,
      exitOnReversal: true, setupId: `${interval}:${model}:${anchor}:${sign}`, model, expiresAt: context.now + duration['15m'],
      confirmations: { '15m': `${interval} kapanışında ${model}; sonraki 15m açılışında emir.`, '1H': `Yerel yapı; ${higher} yönü ${bias}.`, '4H': 'Yalnız kapanmış üst zaman dilimi bağlamı; hedef giriş zaman diliminin yapısı.' },
    } satisfies Signal;
  };
  // Range deviation + directional reclaim is a standalone reversal pattern.
  const range = bars.slice(-25, -1);
  const low = Math.min(...range.map(b => b.low)), high = Math.max(...range.map(b => b.high));
  const midpoint = (low + high) / 2;
  for (const sign of [1, -1]) {
    const swept = sign > 0 ? last.low < low && last.close > low && last.close < midpoint : last.high > high && last.close < high && last.close > midpoint;
    const recovery = (last.close - last.open) * sign > 0 && (sign > 0 ? last.close - last.low : last.high - last.close) >= (last.high - last.low) * .6;
    // Against strong higher structure demand a two-candle reversal, not a touch.
    const counterConfirmed = bias !== -sign || (last.close - (sign > 0 ? bars.at(-2)!.high : bars.at(-2)!.low)) * sign > 0;
    if (swept && recovery && counterConfirmed && high - low >= 2 * atr) {
      const signal = make(sign, sign > 0 ? last.low : last.high, sign > 0 ? high : low, 'range-sweep-reclaim', last.time);
      if (signal) return { signal, reason: 'Range likiditesi süpürüldü ve kapanışla geri kazanıldı.' };
    }
  }
  // Displacement through a prior local boundary, followed by its first confirmed retest.
  for (let index = bars.length - 2; index >= bars.length - 9; index--) {
    const breakout = bars[index], prior = bars.slice(index - 20, index);
    const sign = Math.sign(breakout.close - breakout.open);
    if (!sign || bias === -sign) continue;
    const level = sign > 0 ? Math.max(...prior.map(b => b.high)) : Math.min(...prior.map(b => b.low));
    const averageVolume = mean(prior.map(b => b.volume));
    if ((breakout.close - level) * sign <= 0 || Math.abs(breakout.close - breakout.open) < priorAtr(bars, index) * .8 || breakout.volume < averageVolume * 1.2) continue;
    const since = bars.slice(index + 1);
    if (since.slice(0, -1).some(b => (b.close - level) * sign < -atr * .25)) continue;
    const touch = last.low <= level + atr * .15 && last.high >= level - atr * .15;
    if (!touch || (last.close - level) * sign <= 0 || (last.close - last.open) * sign <= 0) continue;
    const candidates = confirmedSwings(bars.slice(0, index)).filter(s => s.kind === (sign > 0 ? 'high' : 'low') && (s.price - last.close) * sign > 0).map(s => s.price);
    const impulse = sign > 0 ? Math.max(...bars.slice(index, -1).map(b => b.high)) : Math.min(...bars.slice(index, -1).map(b => b.low));
    if ((impulse - last.close) * sign > 0) candidates.push(impulse);
    const target = candidates.sort((a, b) => (a - b) * sign)[0];
    if (target === undefined) continue;
    const extreme = sign > 0 ? Math.min(...since.map(b => b.low)) : Math.max(...since.map(b => b.high));
    const signal = make(sign, extreme, target, 'structure-break-retest', breakout.time);
    if (signal) return { signal, reason: 'Hacimli yapı kırılımı kapanışla retest edildi.' };
  }
  return wait(`${interval}: bağımsız range süpürmesi veya yapı kırılımı/retest bekleniyor.`);
}

export function createMpaStrategy(interval: Interval): Strategy {
  return { id: `MPA ${interval}`, version: '2.0.0', entryInterval: interval, requireBias: false,
    warmup: { '15m': interval === '15m' ? 100 : 40, '1H': interval === '1H' ? 100 : 40, '4H': interval === '4H' ? 100 : 40 },
    evaluate: context => inspectMpaV2(context, interval).signal };
}
