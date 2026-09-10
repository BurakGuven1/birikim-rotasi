import { alignHigher, atr, ema, highest, linreg, lowest, percentRank, rsi, sma, stdev } from './eth-indicators';
import type { Candle, Exit, Instrument, Position } from './types';

/**
 * ETH Momentum Breakout v15 — a port of the user's Pine strategy, run on its own terms.
 *
 * This model does not go through the shared risk engine. It has no reward/risk gate, no cost-share
 * guard and no fixed-dollar stake: it stakes the whole account the way `percent_of_equity = 100`
 * does and manages the trade with its own stop, partial and trailing rules. That is deliberate —
 * porting a strategy and then filtering its entries through a different rule set measures neither
 * one. The execution safety that survives is the part that is not a strategy opinion: a stop that
 * really exists, orders that cannot double up, and a kill switch.
 *
 * Bar order follows Pine with `process_orders_on_close = false`: the script runs at a bar's close,
 * entries and market closes fill at the NEXT bar's open, and resting stop/limit orders fill inside
 * the bar. Where a stop and a limit could both fill in one bar the stop is taken first, which is
 * the conservative reading and the same convention the rest of this codebase uses.
 *
 * The chart timeframe is 15m. The two higher timeframes are the script's own `request.security`
 * inputs — Daily for the regime filter and 1H for the trend filter — not the chart interval, so
 * nothing here reads a 2H bar.
 */
export const ETH_MOMENTUM = {
  // Regime (daily)
  useEmaDistFilter: true, emaDistLen: 200, emaDistMax: 35,
  useVolRegime: true, volRegimeLen: 100, volRegimeMax: 2, volRegimeMin: .4,
  // Trend (1H)
  useTrend: true, trendEmaLen: 50, trendAtrLen: 14, trendAtrMul: .5, useSlope: true, slopeBars: 5,
  // Squeeze
  bbLen: 20, bbMult: 2, kcLen: 20, kcMult: 1.5, sqzMaxBars: 6, sqzMinBars: 3,
  // Breakout quality
  brkMargin: .3, minBodyPct: 40,
  // RSI, volume, momentum
  useRsiFilter: true, rsiLen: 14, rsiOBLevel: 75, rsiOSLevel: 25,
  volLen: 20, volMult: 1.8, momLen: 12, momThresh: 0,
  // Risk
  atrLen: 14, slMult: 2, usePartialTP: true, tp1Mult: 1.5, tp1Pct: 50, tp2Mult: 3.5,
  useTrail: true, trailMult: 2.5, trailTightMult: 1.5, useRunnerMode: true, runnerTrailBars: 8,
  useBE: true, beThresh: 1.2, beOffset: .2,
  // Management
  cooldownLen: 12, useSmartCool: true, minAtrPerc: .3, maxBarsInTrade: 100,
  useStagnation: true, stagnBars: 10, stagnThresh: .5,
  // Adaptive regime
  useAdaptive: true, adaptVolLen: 100, adaptTrendLen: 50,
  hotVolThresh: 60, hotTrendThresh: 1.5, coldVolThresh: 30, coldTrendThresh: .5,
  hotScale: 1.35, coldScale: .75, hotTP1Pct: 35, coldTP1Pct: 60,
} as const;

/** The script's own defaults for the filters this port does not implement, asserted rather than
 *  assumed: ADX, the fundamental tickers, the session window and the failed-breakout exit are all
 *  off in the configuration that was tested, and each is off for a reason stated in the source. */
export const ETH_MOMENTUM_DISABLED = { useAdxFilter: false, useFund: false, useSess: false, useFailBrk: false } as const;

export interface EthMomentumSettings {
  initialEquity: number;
  /** Notional is equity × leverage × share; Pine's percent_of_equity = 100 with no leverage is 1. */
  leverage: number;
  equityPercent: number;
  /** Per side, as a percentage of notional. The Pine strategy declares 0.1; OKX taker is 0.05. */
  commissionPercent: number;
  slippageTicks: number;
  direction: 'long' | 'short' | 'both';
}

export const defaultEthMomentumSettings: EthMomentumSettings = {
  initialEquity: 356.31, leverage: 5, equityPercent: 100, commissionPercent: .1, slippageTicks: 2, direction: 'long',
};

/**
 * The model's state at the last closed bar, read out instead of thrown away.
 *
 * The live runner does not re-implement any rule: it replays this same engine over a window of
 * recent bars and acts on whatever the engine decided at the final bar. That is the only way to
 * guarantee the bot trades the strategy that was tested rather than a second transcription of it.
 */
export interface EthLiveState {
  /** Open time of the last bar the engine processed, and the moment that bar closed. */
  barTime: number; barClose: number; close: number;
  side: 1 | -1 | 0;
  /** Present while a simulated position is open; carries the current stop and the staged plan. */
  position: {
    direction: 'long' | 'short'; entry: number; stop: number; initialStop: number;
    quantity: number; remaining: number; openedAt: number; barsInTrade: number;
    tp1: number; tp2: number; tp1Fraction: number; partialFilled: boolean; beActive: boolean;
  } | null;
  /** The order the engine decided at this bar's close; it fills at the NEXT bar's open. */
  pending: { kind: 'entry'; direction: 'long' | 'short'; stop: number; tp1: number; tp2: number; tp1Fraction: number }
    | { kind: 'close'; reason: Exit['reason'] } | null;
  /** Why no entry was taken on this bar, when the engine was flat and looking. */
  blocked: string | null;
  barsSinceExit: number;
  /** Trades the replay window itself produced, newest last; useful for showing recent behaviour. */
  windowTrades: number;
}

export interface EthMomentumResult {
  strategy: string; instrument: string; from: number; to: number;
  trades: Position[];
  equityCurve: { time: number; equity: number }[];
  settings: EthMomentumSettings;
  metrics: {
    trades: number; wins: number; losses: number; winRate: number | null; netPnl: number; returnPercent: number;
    profitFactor: number | null; expectancy: number | null; maxDrawdownPercent: number; fees: number;
    averageWin: number | null; averageLoss: number | null; longs: number; shorts: number;
  };
  /** Why entries did not happen, counted on bars where the model was flat and ready to look. */
  blocked: Record<string, number>;
  /** Only present when the caller asked for live mode. */
  live?: EthLiveState;
  warnings: string[];
}

interface Input {
  instrument: Instrument;
  bars15m: Candle[]; bars1H: Candle[]; barsDaily: Candle[];
  settings: EthMomentumSettings;
  from?: number; to?: number;
  /** Live mode: keep an open position open at the end of the window and report the engine state
   *  at the last closed bar, instead of force-closing to produce a clean backtest metric. */
  live?: boolean;
}

const SPAN_15M = 900_000, SPAN_1H = 3_600_000, SPAN_DAY = 86_400_000;

export function runEthMomentum(input: Input): EthMomentumResult {
  const { instrument, settings } = input;
  const bars = input.bars15m.filter(bar => Number.isFinite(bar.time) && bar.low > 0).toSorted((a, b) => a.time - b.time);
  if (bars.length < 400) throw new Error('ETH momentum için yeterli 15m mum yok.');
  if (bars.some((bar, i) => i > 0 && bar.time - bars[i - 1].time !== SPAN_15M)) throw new Error('15m verisi kesintili.');

  const close = bars.map(b => b.close), high = bars.map(b => b.high), low = bars.map(b => b.low), volume = bars.map(b => b.volume);
  const atr15 = atr(bars, ETH_MOMENTUM.atrLen);
  const bbBasis = sma(close, ETH_MOMENTUM.bbLen), bbDev = stdev(close, ETH_MOMENTUM.bbLen);
  const kcBasis = sma(close, ETH_MOMENTUM.kcLen), kcAtr = atr(bars, ETH_MOMENTUM.kcLen);
  const rsi15 = rsi(close, ETH_MOMENTUM.rsiLen);
  const volSma = sma(volume, ETH_MOMENTUM.volLen);
  const momSma = sma(close, ETH_MOMENTUM.momLen);
  const mom = linreg(close.map((value, i) => Number.isNaN(momSma[i]) ? NaN : value - momSma[i]), ETH_MOMENTUM.momLen, 0);
  const volRank = percentRank(atr15, ETH_MOMENTUM.adaptVolLen);
  const adaptEma = ema(close, ETH_MOMENTUM.adaptTrendLen);
  const runnerLow = lowest(low, ETH_MOMENTUM.runnerTrailBars), runnerHigh = highest(high, ETH_MOMENTUM.runnerTrailBars);

  // Higher timeframes, resolved to the last bar that had closed — never the one still forming.
  const hourly = input.bars1H.toSorted((a, b) => a.time - b.time), daily = input.barsDaily.toSorted((a, b) => a.time - b.time);
  const hourIndex = alignHigher(bars, SPAN_15M, hourly, SPAN_1H), dayIndex = alignHigher(bars, SPAN_15M, daily, SPAN_DAY);
  const hourlyEma = ema(hourly.map(b => b.close), ETH_MOMENTUM.trendEmaLen);
  const hourlyAtr = atr(hourly, ETH_MOMENTUM.trendAtrLen);
  const dailyEma = ema(daily.map(b => b.close), ETH_MOMENTUM.emaDistLen);
  const dailyAtr = atr(daily, 14);
  const dailyAtrAvg = sma(dailyAtr, ETH_MOMENTUM.volRegimeLen);

  const trades: Position[] = [], equityCurve: EthMomentumResult['equityCurve'] = [], blocked: Record<string, number> = {};
  const tick = instrument.tickSz > 0 ? instrument.tickSz : .01;
  const slip = tick * settings.slippageTicks;
  const allowLong = settings.direction !== 'short', allowShort = settings.direction !== 'long';

  let equity = settings.initialEquity, peak = equity, drawdown = 0;
  // Squeeze state.
  let sqzDuration = 0, previousSqzDuration = 0, barsSinceSqz = 999, lastSqzValid = false;
  // Cooldown state.
  let barsSinceExit = 999, lastWasRunner = false;
  // Position state.
  let side: 1 | -1 | 0 = 0, avgPrice = 0, quantity = 0, remaining = 0, stop = NaN, tp1 = NaN, tp2 = NaN;
  let beActive = false, partialFilled = false, entryAtr = NaN, entryQty = NaN, barsInTrade = 0, maxFavExcursion = 0;
  let dynTp1 = 0, dynTp2 = 0, dynSl = 0, dynTrail = 0, dynTrailTight = 0, dynTp1Pct = 0;
  let open: Position | null = null;
  let pending: { kind: 'entry'; side: 1 | -1 } | { kind: 'close'; reason: Exit['reason'] } | null = null;

  let lastBlocked: string | null = null, lastIndex = -1;
  const note = (reason: string) => { blocked[reason] = (blocked[reason] ?? 0) + 1; lastBlocked = reason; };
  const fee = (notional: number) => Math.abs(notional) * settings.commissionPercent / 100;

  function book(price: number, units: number, time: number, reason: Exit['reason']) {
    const cost = fee(units * price);
    const pnl = units * (price - avgPrice) * side - cost;
    equity += pnl;
    remaining = Number((remaining - units).toFixed(12));
    open!.realizedPnl += pnl; open!.fees += cost; open!.remaining = remaining;
    open!.exits.push({ time, price, quantity: units, pnl, fee: cost, reason });
    if (remaining <= 1e-12) {
      remaining = 0; open!.remaining = 0; open!.closedAt = time;
      trades.push(open!);
      open = null; side = 0; stop = NaN; tp1 = NaN; tp2 = NaN;
      beActive = false; barsInTrade = 0; maxFavExcursion = 0; entryAtr = NaN; entryQty = NaN;
      lastWasRunner = partialFilled; partialFilled = false; barsSinceExit = 0;
    }
  }

  const first = Math.max(ETH_MOMENTUM.emaDistLen, ETH_MOMENTUM.adaptVolLen + ETH_MOMENTUM.atrLen, 260);
  for (let i = first; i < bars.length; i++) {
    const bar = bars[i], barClose = bar.time + SPAN_15M;
    if (bar.time < (input.from ?? 0) || barClose > (input.to ?? Infinity)) continue;
    lastBlocked = null; lastIndex = i;

    // ---- 1. Orders decided at the previous close fill at this bar's open. ----
    if (pending && pending.kind === 'entry' && !side) {
      const direction = pending.side;
      const fill = bar.open + direction * slip;
      const notional = equity * settings.leverage * settings.equityPercent / 100;
      quantity = notional / fill;
      const cost = fee(notional);
      equity -= cost;
      side = direction; avgPrice = fill; remaining = quantity; entryQty = quantity;
      barsInTrade = 0; maxFavExcursion = 0; beActive = false; partialFilled = false;
      open = {
        id: `eth-momentum:${instrument.id}:${bar.time}`, instrument, direction: direction === 1 ? 'long' : 'short',
        entry: fill, stop, initialStop: stop, quantity, remaining: quantity, openedAt: bar.time, processedThrough: barClose,
        realizedPnl: -cost, fees: cost, funding: 0, targets: [{ price: tp1, fraction: dynTp1Pct / 100, filled: false }],
        runnerFraction: 1 - dynTp1Pct / 100, exits: [], model: 'eth-momentum', entryInterval: '15m', leverage: settings.leverage,
      };
    } else if (pending && pending.kind === 'close' && side && open) {
      book(bar.open - side * slip, remaining, bar.time, pending.reason);
    }
    pending = null;

    // ---- 2. Resting stop and limit orders work inside this bar. Stop first. ----
    if (side && open) {
      const stopHit = side === 1 ? bar.low <= stop : bar.high >= stop;
      if (stopHit) {
        book(side === 1 ? Math.min(bar.open, stop) - slip : Math.max(bar.open, stop) + slip, remaining, barClose, 'stop');
      } else {
        if (ETH_MOMENTUM.usePartialTP && !partialFilled && (side === 1 ? bar.high >= tp1 : bar.low <= tp1)) {
          const units = Math.min(remaining, quantity * dynTp1Pct / 100);
          book(tp1, units, barClose, 'target');
          if (open) open.targets[0].filled = true;
        }
        const runnerOpen = partialFilled && ETH_MOMENTUM.useRunnerMode;
        if (side && open && !runnerOpen && Number.isFinite(tp2) && (side === 1 ? bar.high >= tp2 : bar.low <= tp2)) {
          book(tp2, remaining, barClose, 'target');
        }
      }
    }

    // ---- 3. Squeeze state advances on every bar, in or out of a position. ----
    const upper = bbBasis[i] + ETH_MOMENTUM.bbMult * bbDev[i], lower = bbBasis[i] - ETH_MOMENTUM.bbMult * bbDev[i];
    const kcUpper = kcBasis[i] + kcAtr[i] * ETH_MOMENTUM.kcMult, kcLower = kcBasis[i] - kcAtr[i] * ETH_MOMENTUM.kcMult;
    const sqzOn = lower > kcLower && upper < kcUpper;
    previousSqzDuration = sqzDuration;
    sqzDuration = sqzOn ? sqzDuration + 1 : 0;
    if (sqzOn) barsSinceSqz = 0;
    else {
      if (barsSinceSqz === 0) lastSqzValid = previousSqzDuration >= ETH_MOMENTUM.sqzMinBars;
      barsSinceSqz++;
    }
    const recentSqz = barsSinceSqz > 0 && barsSinceSqz <= ETH_MOMENTUM.sqzMaxBars && lastSqzValid;

    // ---- 4. The bar closes: manage an open trade, or look for a new one. ----
    if (side && open) {
      barsInTrade++;
      maxFavExcursion = Math.max(maxFavExcursion, (bar.close - avgPrice) * side);
      if (!partialFilled && remaining < entryQty * .75) partialFilled = true;
      const refAtr = Number.isFinite(entryAtr) ? entryAtr : atr15[i];

      if (ETH_MOMENTUM.useBE && !beActive && (bar.close - avgPrice) * side >= refAtr * ETH_MOMENTUM.beThresh) {
        beActive = true;
        const breakEven = avgPrice + side * refAtr * ETH_MOMENTUM.beOffset;
        stop = side === 1 ? Math.max(stop, breakEven) : Math.min(stop, breakEven);
      }
      if (ETH_MOMENTUM.useTrail) {
        const distance = atr15[i] * (partialFilled ? dynTrailTight : dynTrail);
        const atrTrail = bar.close - side * distance;
        const structural = side === 1 ? runnerLow[i] : runnerHigh[i];
        const candidate = partialFilled && ETH_MOMENTUM.useRunnerMode
          ? (side === 1 ? Math.max(atrTrail, structural) : Math.min(atrTrail, structural))
          : atrTrail;
        stop = side === 1 ? Math.max(stop, candidate) : Math.min(stop, candidate);
      }
      open.stop = stop;
      open.processedThrough = barClose;

      const timeout = ETH_MOMENTUM.maxBarsInTrade > 0 && barsInTrade >= ETH_MOMENTUM.maxBarsInTrade && !partialFilled;
      const stagnation = ETH_MOMENTUM.useStagnation && barsInTrade >= ETH_MOMENTUM.stagnBars && maxFavExcursion < refAtr * ETH_MOMENTUM.stagnThresh;
      if (timeout) pending = { kind: 'close', reason: 'timeout' };
      else if (stagnation) pending = { kind: 'close', reason: 'stagnation' };
    } else {
      barsSinceExit++;
      const cooldown = ETH_MOMENTUM.useSmartCool && lastWasRunner ? Math.round(ETH_MOMENTUM.cooldownLen * .5) : ETH_MOMENTUM.cooldownLen;

      // Daily regime.
      const day = dayIndex[i];
      const longTermEma = day >= 0 ? dailyEma[day] : NaN;
      const emaDist = longTermEma > 0 ? Math.abs(bar.close - longTermEma) / longTermEma * 100 : 0;
      const volRatio = day >= 0 && dailyAtrAvg[day] > 0 ? dailyAtr[day] / dailyAtrAvg[day] : NaN;
      const emaDistOk = !ETH_MOMENTUM.useEmaDistFilter || emaDist <= ETH_MOMENTUM.emaDistMax;
      const volRegOk = !ETH_MOMENTUM.useVolRegime || (Number.isFinite(volRatio) && volRatio >= ETH_MOMENTUM.volRegimeMin && volRatio <= ETH_MOMENTUM.volRegimeMax);
      const regimeOk = emaDistOk && volRegOk;

      // 1H trend with slope confirmation.
      const hour = hourIndex[i];
      const htfEma = hour >= 0 ? hourlyEma[hour] : NaN;
      const htfAtr = hour >= 0 ? hourlyAtr[hour] : NaN;
      const htfLag = hour - ETH_MOMENTUM.slopeBars >= 0 ? hourlyEma[hour - ETH_MOMENTUM.slopeBars] : NaN;
      const rising = !ETH_MOMENTUM.useSlope || htfEma > htfLag, falling = !ETH_MOMENTUM.useSlope || htfEma < htfLag;
      const bullTrend = !ETH_MOMENTUM.useTrend || (bar.close > htfEma + htfAtr * ETH_MOMENTUM.trendAtrMul && rising);
      const bearTrend = !ETH_MOMENTUM.useTrend || (bar.close < htfEma - htfAtr * ETH_MOMENTUM.trendAtrMul && falling);

      const body = Math.abs(bar.close - bar.open), range = bar.high - bar.low;
      const strongBody = range > 0 && body / range * 100 >= ETH_MOMENTUM.minBodyPct;
      const longBreakout = bar.close > upper + atr15[i] * ETH_MOMENTUM.brkMargin;
      const shortBreakout = bar.close < lower - atr15[i] * ETH_MOMENTUM.brkMargin;
      const momUp = mom[i] > ETH_MOMENTUM.momThresh && mom[i] > mom[i - 1];
      const momDown = mom[i] < -ETH_MOMENTUM.momThresh && mom[i] < mom[i - 1];
      const volSpike = volume[i] > volSma[i] * ETH_MOMENTUM.volMult;
      const volOk = atr15[i] / bar.close * 100 >= ETH_MOMENTUM.minAtrPerc;
      const rsiLongOk = !ETH_MOMENTUM.useRsiFilter || rsi15[i] < ETH_MOMENTUM.rsiOBLevel;
      const rsiShortOk = !ETH_MOMENTUM.useRsiFilter || rsi15[i] > ETH_MOMENTUM.rsiOSLevel;
      const cooldownOk = barsSinceExit >= cooldown;

      const longCond = allowLong && regimeOk && recentSqz && momUp && volSpike && longBreakout && strongBody && bullTrend && rsiLongOk && volOk && cooldownOk;
      const shortCond = allowShort && regimeOk && recentSqz && momDown && volSpike && shortBreakout && strongBody && bearTrend && rsiShortOk && volOk && cooldownOk;

      if (!longCond && !shortCond) {
        // Named per side and in the order the script reads them. Testing the sides together hid
        // the real answer behind a catch-all whenever one side's filter passed and the other's
        // did not — which is most bars, since the two are near mirror images.
        const failure = (breakout: boolean, momentum: boolean, trend: boolean, rsiOk: boolean) =>
          !regimeOk ? (emaDistOk ? 'Günlük volatilite rejimi dışında' : 'Günlük EMA200 uzaklığı fazla')
          : !recentSqz ? 'Geçerli sıkışma kırılımı yok'
          : !cooldownOk ? 'Bekleme süresi dolmadı'
          : !volOk ? 'ATR yüzdesi çok düşük'
          : !volSpike ? 'Hacim patlaması yok'
          : !breakout ? 'BB kırılımı yok'
          : !strongBody ? 'Mum gövdesi zayıf'
          : !momentum ? 'Momentum teyidi yok'
          : !trend ? '1H trend teyidi yok'
          : !rsiOk ? 'RSI aşırı bölgede'
          : 'Bilinmeyen';
        if (allowLong) note(failure(longBreakout, momUp, bullTrend, rsiLongOk));
        if (allowShort) note(failure(shortBreakout, momDown, bearTrend, rsiShortOk));
      } else {
        const direction: 1 | -1 = longCond ? 1 : -1;
        const trendScore = atr15[i] > 0 ? (bar.close - adaptEma[i]) * direction / atr15[i] : 0;
        const hot = volRank[i] > ETH_MOMENTUM.hotVolThresh && trendScore > ETH_MOMENTUM.hotTrendThresh;
        const cold = volRank[i] < ETH_MOMENTUM.coldVolThresh || trendScore < ETH_MOMENTUM.coldTrendThresh;
        const regime = ETH_MOMENTUM.useAdaptive ? (hot ? 1 : cold ? -1 : 0) : 0;
        const scale = regime === 1 ? ETH_MOMENTUM.hotScale : regime === -1 ? ETH_MOMENTUM.coldScale : 1;
        dynTp1 = ETH_MOMENTUM.tp1Mult * scale; dynTp2 = ETH_MOMENTUM.tp2Mult * scale; dynSl = ETH_MOMENTUM.slMult * scale;
        dynTrail = ETH_MOMENTUM.trailMult * scale; dynTrailTight = ETH_MOMENTUM.trailTightMult * scale;
        dynTp1Pct = regime === 1 ? ETH_MOMENTUM.hotTP1Pct : regime === -1 ? ETH_MOMENTUM.coldTP1Pct : ETH_MOMENTUM.tp1Pct;
        // Levels come off the signal bar's close, exactly as the script sets them, not off the fill.
        entryAtr = atr15[i];
        stop = bar.close - direction * atr15[i] * dynSl;
        tp1 = bar.close + direction * atr15[i] * dynTp1;
        tp2 = bar.close + direction * atr15[i] * dynTp2;
        pending = { kind: 'entry', side: direction };
      }
    }

    const marked = equity + (side && open ? remaining * (bar.close - avgPrice) * side : 0);
    peak = Math.max(peak, marked);
    drawdown = Math.max(drawdown, peak > 0 ? (peak - marked) / peak * 100 : 0);
    equityCurve.push({ time: barClose, equity: marked });
  }

  const warnings = [
    'Bu sonuç tek enstrüman replay sonucudur; ileri paper doğrulaması olmadan canlıya geçiş kanıtı değildir.',
    'OHLC modeli: aynı mumda stop önce kabul edilir. Giriş ve piyasa kapanışları sonraki mumun açılışından, kâr emirleri hedef fiyatından dolar.',
    'Funding maliyeti bu modelde hesaplanmaz; kaldıraçlı pozisyonda gerçek sonucu düşürür.',
  ];
  const liveBar = lastIndex >= 0 ? bars[lastIndex] : null;
  const live: EthLiveState | undefined = input.live && liveBar ? {
    barTime: liveBar.time, barClose: liveBar.time + SPAN_15M, close: liveBar.close, side,
    position: side && open ? {
      direction: open.direction, entry: avgPrice, stop, initialStop: open.initialStop,
      quantity, remaining, openedAt: open.openedAt, barsInTrade,
      tp1, tp2, tp1Fraction: dynTp1Pct / 100, partialFilled, beActive,
    } : null,
    pending: pending === null ? null
      : pending.kind === 'entry' ? { kind: 'entry', direction: pending.side === 1 ? 'long' : 'short', stop, tp1, tp2, tp1Fraction: dynTp1Pct / 100 }
      : { kind: 'close', reason: pending.reason },
    blocked: lastBlocked, barsSinceExit, windowTrades: trades.length,
  } : undefined;
  if (side && open && !input.live) {
    book(bars.at(-1)!.close, remaining, bars.at(-1)!.time + SPAN_15M, 'end');
    warnings.push('Dönem sonunda açık pozisyon son kapanıştan maliyetle kapatıldı.');
  }
  const winners = trades.filter(t => t.realizedPnl > 1e-9), losers = trades.filter(t => t.realizedPnl < -1e-9);
  const gains = winners.reduce((sum, t) => sum + t.realizedPnl, 0), losses = -losers.reduce((sum, t) => sum + t.realizedPnl, 0);
  const net = equity - settings.initialEquity;
  return {
    strategy: 'ETH Momentum Breakout 15m@ethmb-15.0.0', instrument: instrument.id,
    from: bars[first]?.time ?? bars[0].time, to: bars.at(-1)!.time + SPAN_15M,
    trades, equityCurve, settings, blocked, warnings, live,
    metrics: {
      trades: trades.length, wins: winners.length, losses: losers.length,
      winRate: trades.length ? winners.length / trades.length * 100 : null,
      netPnl: net, returnPercent: net / settings.initialEquity * 100,
      profitFactor: losses > 0 ? gains / losses : null,
      expectancy: trades.length ? net / trades.length : null,
      maxDrawdownPercent: drawdown, fees: trades.reduce((sum, t) => sum + t.fees, 0),
      averageWin: winners.length ? gains / winners.length : null,
      averageLoss: losers.length ? losses / losers.length : null,
      longs: trades.filter(t => t.direction === 'long').length,
      shorts: trades.filter(t => t.direction === 'short').length,
    },
  };
}
