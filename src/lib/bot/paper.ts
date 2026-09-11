import { closedContext } from './market';
import { advancePosition, openPosition } from './position';
import { sizeTrade } from './risk';
import type { PaperState } from './dashboard-types';
import type { BotSettings, Frames, Funding, Instrument, Strategy } from './types';

export interface PaperInput { instrument: Instrument; frames: Frames; funding: Funding[]; strategy?: Strategy }

/** Paper orders replay closed 15m candles; this is explicitly not a live fill simulator. */
export function replayPaperCycle(previous: PaperState, inputs: PaperInput[], settings: BotSettings, strategy: Strategy, now: number, allowEntries: boolean) {
  const state = structuredClone(previous);
  const signals: { id: string; payload: unknown }[] = [];
  if (!inputs.length) return { state, signals };
  if (state.positions.some(p => !inputs.some(i => i.instrument.id === p.instrument.id))) throw new Error('Açık pozisyon için veri boşluğu.');
  const available = inputs.map(i => ({ ...i, bars: i.frames['15m'].filter(b => b.time + 900_000 <= now).toSorted((a, b) => a.time - b.time) }));
  if (available.some(i => !i.bars.length)) throw new Error('15m mum boşluğu.');
  const lastTime = Math.min(...available.map(i => i.bars.at(-1)!.time));
  const firstTime = state.lastCycle ?? lastTime;
  for (let time = firstTime; time <= lastTime; time += 900_000) {
    const selected = available.map(i => ({ ...i, bar: i.bars.find(b => b.time === time) }));
    if (selected.some(i => !i.bar)) throw new Error('15m mum boşluğu; paper durumu ilerletilmedi.');
    const equity = (close: boolean) => state.cash + state.positions.reduce((sum, p) => {
      const bar = selected.find(i => i.instrument.id === p.instrument.id)!.bar!;
      return sum + p.realizedPnl + p.remaining * ((close ? bar.close : bar.open) - p.entry) * (p.direction === 'long' ? 1 : -1);
    }, 0);
    const day = new Date(time).toISOString().slice(0, 10);
    if (day !== state.day) { state.day = day; state.dayStartEquity = equity(false); state.dailyHalted = false; }
    if (equity(false) <= state.dayStartEquity * (1 - settings.dailyLossPercent / 100)) state.dailyHalted = true;
    for (const input of selected) {
      const selectedStrategy = input.strategy ?? strategy;
      if (state.positions.some(p => p.instrument.id === input.instrument.id) || !allowEntries || state.dailyHalted) continue;
      const context = closedContext(input.frames, time, selectedStrategy.warmup, selectedStrategy.requireBias !== false);
      context.instrument = input.instrument;
      if (!context.ready) continue;
      const proposed = selectedStrategy.evaluate(context);
      if (!proposed || proposed.expiresAt <= time) continue;
      if (proposed.setupId && [...state.positions, ...state.trades].some(p => p.instrument.id === input.instrument.id && p.setupId === proposed.setupId)) continue;
      const signal = { ...proposed, entry: input.bar!.open * (1 + (proposed.direction === 'long' ? 1 : -1) * settings.slippageBps / 10_000) };
      const currentEquity = equity(false);
      const openMargin = state.positions.reduce((s, p) => s + p.remaining * p.entry / (p.leverage ?? settings.leverage), 0);
      const openRisk = state.positions.reduce((s, p) => s + p.remaining * (Math.max(0, (p.entry - p.stop) * (p.direction === 'long' ? 1 : -1)) + (p.entry + p.stop) * (settings.feeBps + settings.slippageBps) / 10_000 + p.entry * settings.fundingBufferBps / 10_000), 0);
      const sizing = sizeTrade(input.instrument, signal, { equity: currentEquity, available: currentEquity - openMargin, openMargin, openRisk, openPositions: state.positions.length, dayStartEquity: state.dayStartEquity }, settings);
      if (sizing.ok) {
        const id = `${selectedStrategy.id}@${selectedStrategy.version}:${input.instrument.id}:${signal.direction}:${time}`;
        state.positions.push(openPosition(id, input.instrument, signal, sizing.contracts, time, settings));
        signals.push({ id, payload: { signal, sizing, time, mode: 'paper' } });
      }
    }
    state.positions = state.positions.map(p => {
      const i = selected.find(i => i.instrument.id === p.instrument.id)!;
      const selectedStrategy = i.strategy ?? strategy;
      return advancePosition(p, i.bar!, settings, i.funding, closedContext(i.frames, time + 900_000, selectedStrategy.warmup, selectedStrategy.requireBias !== false).frames[p.entryInterval ?? '1H']);
    });
    for (const p of state.positions.filter(p => p.remaining === 0)) { state.cash += p.realizedPnl; state.trades.push(p); }
    state.positions = state.positions.filter(p => p.remaining > 0);
    state.equity = equity(true);
    if (state.equity <= state.dayStartEquity * (1 - settings.dailyLossPercent / 100)) state.dailyHalted = true;
    state.lastCycle = time + 900_000;
  }
  return { state, signals };
}
