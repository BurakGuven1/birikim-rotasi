import { priorAtr } from './mpa';
import { duration, type Candle, type Context, type Interval, type Signal, type Strategy } from './types';

/**
 * Efloud Beast v5 — a faithful port of the user's Pine strategy, minus every drawing and dashboard.
 *
 * The model scores fourteen conditions per side and only trades when the score clears a threshold,
 * the higher-timeframe bias agrees, the market is not chopping, and price sits at a location worth
 * trading. Position size follows the score, and the exit is staged: 40% at 1.2R, 40% at the range
 * objective, and a
 * 20% runner held until structure genuinely turns. The second target aims at the boundary of the
 * range the model measured rather than a fixed multiple, bounded between 1.6R and 4R.
 *
 * Everything reads closed bars only. Where Pine looks at `close[1]` this uses the previous closed
 * bar, so a signal that appears here would have appeared on the chart at the same candle close.
 */
export const EFLOUD = {
  emaFast: 21, emaMid: 50, emaSlow: 200, adxLen: 14, adxMin: 12, rsiLen: 14, atrLen: 14,
  volLen: 20, relVolMin: .85, impulseAtr: .35,
  atrPctMin: .18, emaCompressionMax: .22, efficiencyLen: 30, efficiencyMin: .18,
  levelProxAtr: .75, rangeLen: 140, ote1: .618, ote2: .79,
  pivotLen: 3, breakoutLen: 18, sweepWindow: 10,
  slAtr: 1.55, swingBufferAtr: .22, rr1: 1.2,
  // Adaptive TP2 aims at the active range boundary instead of a fixed multiple, bounded so a
  // breakout that has already eaten its range cannot produce a target inside the noise, and a
  // wide range cannot produce one price will never reach.
  rr2Min: 1.6, rr2Max: 4,
  runnerTrailAtr: 2.2, minScore: 8, strongScoreOffset: 6,
  maxHoldBars: 96, cooldownBars: 3,
} as const;

const ema = (values: number[], length: number): number => {
  const k = 2 / (length + 1);
  let out = values[0];
  for (let i = 1; i < values.length; i++) out = values[i] * k + out * (1 - k);
  return out;
};
const sma = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const trueRange = (bars: Candle[], i: number) => i === 0 ? bars[i].high - bars[i].low
  : Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));

/** Wilder's ADX, the same smoothing ta.dmi uses. */
export function adx(bars: Candle[], length = EFLOUD.adxLen): number {
  if (bars.length < length * 2 + 1) return NaN;
  let smoothTr = 0, smoothPlus = 0, smoothMinus = 0, dxSum = 0, dxCount = 0;
  for (let i = 1; i < bars.length; i++) {
    const up = bars[i].high - bars[i - 1].high, down = bars[i - 1].low - bars[i].low;
    const plus = up > down && up > 0 ? up : 0, minus = down > up && down > 0 ? down : 0;
    const tr = trueRange(bars, i);
    if (i <= length) { smoothTr += tr; smoothPlus += plus; smoothMinus += minus; continue; }
    smoothTr = smoothTr - smoothTr / length + tr;
    smoothPlus = smoothPlus - smoothPlus / length + plus;
    smoothMinus = smoothMinus - smoothMinus / length + minus;
    if (!(smoothTr > 0)) continue;
    const di = Math.abs(smoothPlus - smoothMinus) / (smoothPlus + smoothMinus || 1) * 100;
    dxSum += di; dxCount++;
    if (dxCount > length) { dxSum -= dxSum / dxCount; }
  }
  return dxCount ? dxSum / Math.min(dxCount, length) : NaN;
}

export function rsi(bars: Candle[], length = EFLOUD.rsiLen): number {
  if (bars.length < length + 1) return NaN;
  let gain = 0, loss = 0;
  for (let i = bars.length - length; i < bars.length; i++) {
    const change = bars[i].close - bars[i - 1].close;
    if (change > 0) gain += change; else loss -= change;
  }
  if (loss === 0) return 100;
  const rs = (gain / length) / (loss / length);
  return 100 - 100 / (1 + rs);
}

/** Confirmed pivots: a high with `len` lower highs on both sides. Never uses an unclosed bar. */
export function pivots(bars: Candle[], len = EFLOUD.pivotLen) {
  const highs: { index: number; price: number }[] = [], lows: { index: number; price: number }[] = [];
  for (let i = len; i < bars.length - len; i++) {
    let isHigh = true, isLow = true;
    for (let k = 1; k <= len; k++) {
      if (bars[i].high <= bars[i - k].high || bars[i].high <= bars[i + k].high) isHigh = false;
      if (bars[i].low >= bars[i - k].low || bars[i].low >= bars[i + k].low) isLow = false;
    }
    if (isHigh) highs.push({ index: i, price: bars[i].high });
    if (isLow) lows.push({ index: i, price: bars[i].low });
  }
  return { highs, lows };
}

/** Higher-timeframe bars for a given entry interval, matching the script's 4H trend reference. */
function higherFrame(context: Context, interval: Interval): Candle[] {
  if (interval === '4H') return (context.frames.bias?.daily ?? []).filter(b => b.time + 86_400_000 <= context.now);
  return context.frames['4H'].filter(b => b.time + duration['4H'] <= context.now);
}

/** Previous completed period high/low/open from a coarser series. */
function previousPeriod(bars: Candle[]) {
  const previous = bars.at(-2), current = bars.at(-1);
  return { high: previous?.high, low: previous?.low, open: current?.open };
}

/** Calendar months rebuilt from daily bars, since no monthly frame is fetched. */
function monthlyFromDaily(daily: Candle[]): Candle[] {
  const months = new Map<string, Candle>();
  for (const bar of daily) {
    const date = new Date(bar.time);
    const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
    const found = months.get(key);
    if (!found) months.set(key, { ...bar });
    else { found.high = Math.max(found.high, bar.high); found.low = Math.min(found.low, bar.low); found.close = bar.close; found.volume += bar.volume; }
  }
  return [...months.values()];
}

export interface EfloudRead { signal: Signal | null; reason: string; longScore: number; shortScore: number }

export function inspectEfloud(context: Context, interval: Interval): EfloudRead {
  const idle = (reason: string, longScore = 0, shortScore = 0): EfloudRead => ({ signal: null, reason, longScore, shortScore });
  if (!context.ready) return idle(context.reasons.join(' · '));
  const bars = context.frames[interval].filter(b => b.time + duration[interval] <= context.now).slice(-Math.max(EFLOUD.emaSlow + 60, EFLOUD.rangeLen + 40));
  const last = bars.at(-1), previous = bars.at(-2);
  if (bars.length < EFLOUD.emaSlow + 20 || !last || !previous || last.time + duration[interval] !== context.now) return idle(`${interval} kapanışı bekleniyor.`);

  const closes = bars.map(b => b.close);
  const atr = priorAtr(bars, bars.length, EFLOUD.atrLen);
  if (!(atr > 0)) return idle('Volatilite ölçümü yetersiz.');
  const emaFast = ema(closes, EFLOUD.emaFast), emaMid = ema(closes, EFLOUD.emaMid), emaSlow = ema(closes, EFLOUD.emaSlow);
  const strength = adx(bars.slice(-120));
  const momentum = rsi(bars);

  // Volume regime. A contract without volume data must not be silently treated as confirming.
  const volumes = bars.slice(-EFLOUD.volLen).map(b => b.volume);
  const hasVolume = volumes.every(v => v > 0);
  const relativeVolume = hasVolume ? last.volume / sma(volumes) : 1;
  const volumeOk = !hasVolume || relativeVolume >= EFLOUD.relVolMin;
  const strongVolume = hasVolume && relativeVolume >= 1.25;

  // Chop filter: four independent readings, two of which are enough to stand aside.
  const atrPercent = atr / last.close * 100;
  const compression = Math.abs(emaFast - emaSlow) / last.close * 100;
  const efficiencyWindow = bars.slice(-(EFLOUD.efficiencyLen + 1));
  const efficiencyDenominator = sma(efficiencyWindow.map((_, i) => trueRange(efficiencyWindow, i)).slice(1)) * EFLOUD.efficiencyLen;
  const efficiency = efficiencyDenominator > 0 ? Math.abs(last.close - efficiencyWindow[0].close) / efficiencyDenominator : 0;
  const chopCount = Number(!(strength >= EFLOUD.adxMin)) + Number(atrPercent < EFLOUD.atrPctMin) +
    Number(compression < EFLOUD.emaCompressionMax) + Number(efficiency < EFLOUD.efficiencyMin);
  const chopping = chopCount >= 2;

  // Higher-timeframe bias.
  const higher = higherFrame(context, interval);
  if (higher.length < EFLOUD.emaSlow) return idle('Üst zaman dilimi geçmişi yetersiz.');
  const higherCloses = higher.map(b => b.close);
  const htfClose = higherCloses.at(-1)!;
  const htfFast = ema(higherCloses, EFLOUD.emaFast), htfMid = ema(higherCloses, EFLOUD.emaMid), htfSlow = ema(higherCloses, EFLOUD.emaSlow);
  const htfBull = htfClose > htfMid && htfFast >= htfMid, htfBear = htfClose < htfMid && htfFast <= htfMid;
  const localBull = emaFast > emaMid && last.close > emaMid, localBear = emaFast < emaMid && last.close < emaMid;
  const macroBull = last.close > emaSlow || htfClose > htfSlow, macroBear = last.close < emaSlow || htfClose < htfSlow;
  const trendOk = strength >= EFLOUD.adxMin;

  // Institutional levels and the proximity test.
  const daily = (context.frames.bias?.daily ?? []).filter(b => b.time + 86_400_000 <= context.now);
  const weekly = (context.frames.bias?.weekly ?? []).filter(b => b.time + 604_800_000 <= context.now);
  const day = previousPeriod(daily), week = previousPeriod(weekly), month = previousPeriod(monthlyFromDaily(daily));
  const step = Math.pow(10, Math.floor(Math.log10(last.close))) / 2;
  const round = Math.round(last.close / step) * step;
  const near = (level?: number) => level !== undefined && Number.isFinite(level) && Math.abs(last.close - level) <= atr * EFLOUD.levelProxAtr;
  const nearOpens = near(day.open) || near(week.open) || near(month.open) || near(round);
  const nearDemand = near(day.low) || near(week.low) || near(month.low) || nearOpens;
  const nearSupply = near(day.high) || near(week.high) || near(month.high) || nearOpens;

  // Active range and optimal trade entry zones.
  const range = bars.slice(-EFLOUD.rangeLen);
  const rangeHigh = Math.max(...range.map(b => b.high)), rangeLow = Math.min(...range.map(b => b.low));
  const rangeSize = Math.max(rangeHigh - rangeLow, context.instrument?.tickSz ?? 1e-8);
  const rangeMid = (rangeHigh + rangeLow) / 2;
  const inLongOte = last.close >= rangeHigh - rangeSize * EFLOUD.ote2 && last.close <= rangeHigh - rangeSize * EFLOUD.ote1;
  const inShortOte = last.close >= rangeLow + rangeSize * EFLOUD.ote1 && last.close <= rangeLow + rangeSize * EFLOUD.ote2;
  const discount = last.close < rangeMid, premium = last.close > rangeMid;

  // Structure, sweeps and breakouts.
  const { highs, lows } = pivots(bars);
  const lastSwingHigh = highs.at(-1), lastSwingLow = lows.at(-1);
  const priorSwingHigh = highs.at(-2), priorSwingLow = lows.at(-2);
  const highType = lastSwingHigh && priorSwingHigh ? (lastSwingHigh.price > priorSwingHigh.price ? 'HH' : 'LH') : '-';
  const lowType = lastSwingLow && priorSwingLow ? (lastSwingLow.price > priorSwingLow.price ? 'HL' : 'LL') : '-';

  const sweptWithin = (kind: 'sell' | 'buy') => {
    for (let back = 0; back < EFLOUD.sweepWindow && bars.length - 1 - back > 0; back++) {
      const bar = bars[bars.length - 1 - back];
      const level = kind === 'sell' ? lows.filter(p => p.index < bars.length - 1 - back).at(-1) : highs.filter(p => p.index < bars.length - 1 - back).at(-1);
      if (!level) continue;
      if (kind === 'sell' ? bar.low < level.price && bar.close > level.price : bar.high > level.price && bar.close < level.price) return true;
    }
    return false;
  };
  const sellSweep = sweptWithin('sell'), buySweep = sweptWithin('buy');

  const body = Math.abs(last.close - last.open);
  const barRange = Math.max(last.high - last.low, context.instrument?.tickSz ?? 1e-8);
  const bullCandle = last.close > last.open && body / barRange >= .35;
  const bearCandle = last.close < last.open && body / barRange >= .35;
  const bullImpulse = bullCandle && body >= atr * EFLOUD.impulseAtr;
  const bearImpulse = bearCandle && body >= atr * EFLOUD.impulseAtr;

  const breakWindow = bars.slice(-(EFLOUD.breakoutLen + 1), -1);
  const breakHigh = Math.max(...breakWindow.map(b => b.high)), breakLow = Math.min(...breakWindow.map(b => b.low));
  const bullBreakout = last.close > breakHigh && bullImpulse && volumeOk;
  const bearBreakout = last.close < breakLow && bearImpulse && volumeOk;
  const bullReclaim = last.low <= emaMid && last.close > emaFast && bullCandle;
  const bearReject = last.high >= emaMid && last.close < emaFast && bearCandle;
  const bullMsb = !!lastSwingHigh && last.close > lastSwingHigh.price && previous.close <= lastSwingHigh.price;
  const bearMsb = !!lastSwingLow && last.close < lastSwingLow.price && previous.close >= lastSwingLow.price;
  const bullMss = bullMsb && bullImpulse, bearMss = bearMsb && bearImpulse;

  const bullTrigger = bullBreakout || bullReclaim || (sellSweep && (bullMsb || bullImpulse));
  const bearTrigger = bearBreakout || bearReject || (buySweep && (bearMsb || bearImpulse));

  const longScore = (htfBull ? 2 : 0) + (localBull ? 2 : 0) + (macroBull ? 1 : 0) + (trendOk ? 1 : 0) + (chopping ? 0 : 1) +
    (nearDemand ? 2 : 0) + (inLongOte ? 2 : 0) + (discount ? 1 : 0) + (sellSweep ? 2 : 0) + (bullBreakout ? 2 : 0) +
    (bullReclaim ? 1 : 0) + (bullMss ? 2 : 0) + (momentum > 50 ? 1 : 0) + (strongVolume ? 1 : 0);
  const shortScore = (htfBear ? 2 : 0) + (localBear ? 2 : 0) + (macroBear ? 1 : 0) + (trendOk ? 1 : 0) + (chopping ? 0 : 1) +
    (nearSupply ? 2 : 0) + (inShortOte ? 2 : 0) + (premium ? 1 : 0) + (buySweep ? 2 : 0) + (bearBreakout ? 2 : 0) +
    (bearReject ? 1 : 0) + (bearMss ? 2 : 0) + (momentum < 50 ? 1 : 0) + (strongVolume ? 1 : 0);

  // Balanced mode: the bias gate, plus a chop override only for genuinely strong setups.
  const longGate = htfBull || (localBull && macroBull), shortGate = htfBear || (localBear && macroBear);
  const longChopOverride = longScore >= EFLOUD.minScore + 4 && (bullMss || bullBreakout) && strongVolume;
  const shortChopOverride = shortScore >= EFLOUD.minScore + 4 && (bearMss || bearBreakout) && strongVolume;
  const marketOkLong = !chopping || longChopOverride, marketOkShort = !chopping || shortChopOverride;

  let side: 1 | -1 | 0 = 0;
  const longReady = volumeOk && marketOkLong && bullTrigger && longGate && longScore >= EFLOUD.minScore;
  const shortReady = volumeOk && marketOkShort && bearTrigger && shortGate && shortScore >= EFLOUD.minScore;
  if (longReady && shortReady) side = longScore > shortScore ? 1 : shortScore > longScore ? -1 : 0;
  else if (longReady) side = 1;
  else if (shortReady) side = -1;
  if (!side) {
    const blocked = chopping && !longChopOverride && !shortChopOverride ? 'Rejim: yatay piyasa' :
      !volumeOk ? 'Hacim yetersiz' : !bullTrigger && !bearTrigger ? 'Tetik yok' :
      !longGate && !shortGate ? 'Yön kapısı kapalı' : 'Puan eşiğin altında';
    return idle(`${interval}: ${blocked} (long ${longScore}, short ${shortScore} / ${EFLOUD.minScore}).`, longScore, shortScore);
  }

  const tick = context.instrument?.tickSz ?? 1e-8;
  const align = (value: number, up: boolean) => Number(((up ? Math.ceil(value / tick) : Math.floor(value / tick)) * tick).toFixed(12));
  const swingStop = side > 0
    ? (lastSwingLow ? lastSwingLow.price - atr * EFLOUD.swingBufferAtr : last.close - atr * EFLOUD.slAtr)
    : (lastSwingHigh ? lastSwingHigh.price + atr * EFLOUD.swingBufferAtr : last.close + atr * EFLOUD.slAtr);
  const atrStop = last.close - side * atr * EFLOUD.slAtr;
  // The script takes the wider of the two stops, so noise cannot clip the trade early.
  const stop = align(side > 0 ? Math.min(atrStop, swingStop) : Math.max(atrStop, swingStop), side < 0);
  const risk = (last.close - stop) * side;
  if (!(risk > tick) || risk / last.close >= .08) return idle('Stop mesafesi geçersiz veya çok geniş.', longScore, shortScore);

  const score = side > 0 ? longScore : shortScore;
  // Score drives size exactly as the Pine risk multiplier does, through the engine's conviction band.
  const confidence = score >= EFLOUD.minScore + EFLOUD.strongScoreOffset ? 1 : score >= EFLOUD.minScore + 2 ? .5 : 0;
  const target1 = align(last.close + side * risk * EFLOUD.rr1, side < 0);
  // The second target is where the move is actually headed: the boundary of the range the model
  // measured, expressed in this trade's own risk unit and bounded at both ends.
  const objective = side > 0 ? rangeHigh : rangeLow;
  const rr2 = Math.min(EFLOUD.rr2Max, Math.max(EFLOUD.rr2Min, (objective - last.close) * side / risk));
  const target2 = align(last.close + side * risk * rr2, side < 0);
  if ((target1 - last.close) * side <= tick || (target2 - target1) * side <= tick) return idle('Hedef sıralaması geçersiz.', longScore, shortScore);

  return {
    longScore, shortScore,
    reason: `${side > 0 ? 'Long' : 'Short'} puan ${score}/${EFLOUD.minScore} · ${bullBreakout || bearBreakout ? 'kırılım' : sellSweep || buySweep ? 'likidite süpürmesi' : bullMss || bearMss ? 'yapı kırılımı' : 'EMA tepkisi'}`,
    signal: {
      direction: side > 0 ? 'long' : 'short', entry: last.close, stop,
      targets: [{ price: target1, fraction: .4 }, { price: target2, fraction: .4 }],
      runnerFraction: .2, entryInterval: interval, confidence,
      breakEvenAtR: EFLOUD.rr1,
      // The runner trails by the script's loose ATR distance, expressed in units of this trade's risk,
      // and starts trailing where this trade's own second target sits rather than at a fixed multiple.
      trailing: { activateAtR: rr2, distanceR: EFLOUD.runnerTrailAtr / EFLOUD.slAtr },
      maxHoldHours: duration[interval] / 3_600_000 * EFLOUD.maxHoldBars,
      exitOnReversal: true,
      setupId: `${interval}:efloud:${last.time}:${side}`, model: 'efloud-beast',
      expiresAt: context.now + duration['15m'],
      confirmations: {
        '15m': `${interval} kapanışında Efloud puanı ${score}; sonraki 15m açılışında emir.`,
        '1H': `HTF ${htfBull ? 'boğa' : htfBear ? 'ayı' : 'nötr'} · ADX ${strength.toFixed(1)} · rejim ${chopping ? 'yatay' : 'trend'}.`,
        '4H': `Konum ${inLongOte ? 'long OTE' : inShortOte ? 'short OTE' : discount ? 'iskonto' : premium ? 'prim' : 'denge'} · yapı ${highType}/${lowType}.`,
      },
    },
  };
}

export function createEfloudStrategy(interval: Interval): Strategy {
  return { id: `Efloud ${interval}`, version: 'ef-5.1.0', entryInterval: interval, requireBias: true,
    warmup: { '15m': interval === '15m' ? 260 : 40, '1H': interval === '1H' ? 260 : 40, '4H': 260 },
    evaluate: context => inspectEfloud(context, interval).signal };
}
