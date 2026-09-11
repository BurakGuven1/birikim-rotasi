import { runEthMomentum, type EthLiveState, type EthMomentumSettings } from './eth-momentum';
import type { Candle, Instrument } from './types';

/**
 * The ETH Momentum Breakout v15 model, asked what it would do right now.
 *
 * Nothing here re-implements a rule. The engine that produced the backtest is replayed over a
 * window of recent closed bars and its state at the final bar is read out, so the live bot and the
 * tested strategy cannot drift apart: if a filter changes, both change together or neither does.
 *
 * The window is deliberately long. The model carries state across bars — squeeze duration, the
 * cooldown since the last exit, whether the previous trade ran — and a short window would start
 * that state from scratch every cycle and take entries the tested strategy would have skipped.
 */
export const ETH_INSTRUMENT = 'ETH-USDT-SWAP';
const SPAN_15M = 900_000;

/** Bars needed before the engine's first decision, plus room for its own warmup. */
export const ETH_LIVE_WINDOW = 1_200;

export interface EthLiveInput {
  instrument: Instrument;
  bars15m: Candle[]; bars1H: Candle[]; barsDaily: Candle[];
  settings: EthMomentumSettings;
  /** Exchange time; only bars that had closed by then are considered. */
  now: number;
}

export interface EthLiveDecision {
  state: EthLiveState;
  /** Why entries were skipped across the whole window, most frequent first. */
  blocked: { reason: string; count: number }[];
  window: { from: number; to: number; bars: number; trades: number };
  warnings: string[];
}

/**
 * The longest run of consecutive 15m bars ending at the newest one.
 *
 * A hole in the middle of the history is not repaired by interpolating: the indicators would then
 * be computed over bars that never existed. The recent, unbroken tail is used instead and the
 * caller is told how much of it survived, so a short window blocks trading rather than trading on
 * a fabricated series.
 */
export function contiguousTail(bars: Candle[], span = SPAN_15M): Candle[] {
  const sorted = bars.filter(bar => Number.isFinite(bar.time) && bar.low > 0).toSorted((a, b) => a.time - b.time);
  let start = 0;
  for (let i = 1; i < sorted.length; i++) if (sorted[i].time - sorted[i - 1].time !== span) start = i;
  return sorted.slice(start);
}

export function decideEth(input: EthLiveInput): EthLiveDecision {
  const closed = (bars: Candle[], span: number) => bars.filter(bar => bar.time + span <= input.now);
  const bars15m = contiguousTail(closed(input.bars15m, SPAN_15M)).slice(-ETH_LIVE_WINDOW);
  const bars1H = closed(input.bars1H, 3_600_000);
  const barsDaily = closed(input.barsDaily, 86_400_000);
  if (bars15m.length < 400) throw new Error('ETH 15m geçmişi canlı karar için yetersiz veya kesintili.');

  const result = runEthMomentum({
    instrument: input.instrument, bars15m, bars1H, barsDaily,
    settings: input.settings, to: input.now, live: true,
  });
  const state = result.live;
  if (!state) throw new Error('ETH modeli bu pencerede karar üretemedi.');

  const warnings: string[] = [];
  const newest = bars15m.at(-1)!;
  // A decision made on a bar that is not the most recent close is a stale decision: it would size
  // and stop off a price the market has already left behind.
  const expected = Math.floor(input.now / SPAN_15M) * SPAN_15M - SPAN_15M;
  if (newest.time < expected) warnings.push(`Son kapanan 15m mum borsadan alınamadı; karar ${new Date(newest.time).toISOString()} mumuna ait.`);
  if (bars1H.length < 260) warnings.push('1H trend filtresi için mum sayısı sınırda.');
  if (barsDaily.length < 220) warnings.push('Günlük rejim filtresi 200 EMA istiyor; günlük mum sayısı sınırda.');

  return {
    state,
    blocked: Object.entries(result.blocked).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    window: { from: bars15m[0].time, to: newest.time + SPAN_15M, bars: bars15m.length, trades: state.windowTrades },
    warnings,
  };
}
