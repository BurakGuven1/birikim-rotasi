import { priorAtr } from './mpa';
import { duration, type Interval, type Context, type Signal, type Strategy } from './types';

/**
 * Donchian channel breakout with an ATR stop — the canonical published trend-following rule set.
 *
 * This is NOT a candidate for live trading. It exists to answer one question: can this backtest
 * harness detect positive expectancy at all? A well-known rule set with wide, cost-proof stops is
 * the control. If even the control cannot produce a positive expectancy on any instrument or
 * period, the defect is in the harness or the cost model rather than in the traded strategy.
 *
 * Every constant below is a published default (20-bar channel, 2 ATR stop, 4 ATR target). Nothing
 * here is fitted to our data, so its result stays interpretable.
 */
export const donchianLookback = 20;
export const donchianStopAtr = 2;
export const donchianTargetAtr = 4;

export function inspectDonchian(context: Context, interval: Interval): Signal | null {
  if (!context.ready) return null;
  const bars = context.frames[interval].filter(b => b.time + duration[interval] <= context.now).slice(-(donchianLookback + 60));
  const last = bars.at(-1);
  if (bars.length < donchianLookback + 30 || !last || last.time + duration[interval] !== context.now) return null;
  const atr = priorAtr(bars, bars.length - 1);
  if (!(atr > 0)) return null;
  const channel = bars.slice(-(donchianLookback + 1), -1);
  const high = Math.max(...channel.map(b => b.high)), low = Math.min(...channel.map(b => b.low));
  const sign = last.close > high ? 1 : last.close < low ? -1 : 0;
  if (!sign) return null;
  const tick = context.instrument?.tickSz ?? 1e-8;
  const round = (value: number, up: boolean) => Number(((up ? Math.ceil(value / tick) : Math.floor(value / tick)) * tick).toFixed(12));
  const stop = round(last.close - sign * atr * donchianStopAtr, sign < 0);
  const target = round(last.close + sign * atr * donchianTargetAtr, sign < 0);
  if ((last.close - stop) * sign <= tick || (target - last.close) * sign <= tick) return null;
  return {
    direction: sign > 0 ? 'long' : 'short', entry: last.close, stop,
    targets: [{ price: target, fraction: 1 }], runnerFraction: 0, entryInterval: interval,
    trailing: { activateAtR: 2, distanceR: 1 }, maxHoldHours: duration[interval] / 3_600_000 * 60,
    exitOnReversal: false, setupId: `${interval}:donchian:${last.time}:${sign}`, model: 'donchian-breakout',
    expiresAt: context.now + duration['15m'],
    confirmations: {
      '15m': `${interval} kapanışı ${donchianLookback} barlık kanalı kırdı; sonraki 15m açılışında emir.`,
      '1H': 'Referans kontrol modeli; üst zaman dilimi filtresi bilinçli olarak yok.',
      '4H': 'Yayımlanmış varsayılan parametreler; veriye uydurma yapılmadı.',
    },
  };
}

export function createDonchianStrategy(interval: Interval): Strategy {
  return { id: `Donchian ${interval}`, version: 'ref-1.0.0', entryInterval: interval, requireBias: false,
    warmup: { '15m': interval === '15m' ? 90 : 30, '1H': interval === '1H' ? 90 : 30, '4H': interval === '4H' ? 90 : 30 },
    evaluate: context => inspectDonchian(context, interval) };
}
