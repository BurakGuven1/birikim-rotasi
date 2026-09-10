import { duration, type BotSettings, type Candle, type Funding, type Instrument, type Position, type Signal, type Exit } from './types';
import { allocatedTargets, floorStep } from './risk';
import { confirmedSwings, MPA_RULES } from './mpa';

export function openPosition(id: string, instrument: Instrument, signal: Signal, contracts: number, time: number, settings: BotSettings): Position {
  const quantity = contracts * instrument.ctVal;
  const fee = quantity * signal.entry * settings.feeBps / 10_000;
  const targets = allocatedTargets(instrument, signal, contracts);
  return { id, instrument, direction: signal.direction, entry: signal.entry, stop: signal.stop, initialStop: signal.stop,
    quantity, remaining: quantity, openedAt: time, processedThrough: time, realizedPnl: -fee, fees: fee, funding: 0,
    targets: targets.map(t => ({ ...t, filled: false })),
    manageAfterTp1: signal.manageAfterTp1, runnerFraction: signal.runnerFraction ? 1 - targets.reduce((sum, t) => sum + t.fraction, 0) : undefined, setupId: signal.setupId, model: signal.model, leverage: settings.leverage,
    entryInterval: signal.entryInterval, maxHoldHours: signal.maxHoldHours, exitOnReversal: signal.exitOnReversal,
    breakEvenAtR: signal.breakEvenAtR, trailing: signal.trailing, exits: [] };
}

function exit(p: Position, quantity: number, price: number, time: number, reason: Exit['reason'], settings: BotSettings) {
  const sign = p.direction === 'long' ? 1 : -1;
  const fill = price * (1 - sign * settings.slippageBps / 10_000);
  const fee = quantity * fill * settings.feeBps / 10_000;
  const pnl = quantity * (fill - p.entry) * sign - fee;
  p.remaining = Math.max(0, Number((p.remaining - quantity).toFixed(12)));
  p.realizedPnl += pnl;
  p.fees += fee;
  p.exits.push({ time, price: fill, quantity, pnl, fee, reason });
  if (p.remaining < 1e-10) { p.remaining = 0; p.closedAt = time; }
}

export function closePosition(position: Position, price: number, time: number, settings: BotSettings, reason: 'end' | 'emergency' = 'end'): Position {
  const p = structuredClone(position);
  if (p.remaining > 0) exit(p, p.remaining, price, time, reason, settings);
  return p;
}

/** Conservative OHLC ordering: funding on starting size, stop, targets, next-bar stop adjustment. */
export function advancePosition(position: Position, bar: Candle, settings: BotSettings, funding: Funding[], closedHours: Candle[] = []): Position {
  const p = structuredClone(position);
  if (p.remaining === 0 || bar.time < p.processedThrough || bar.time < p.openedAt) return p;
  const end = bar.time + duration['15m'];
  const sign = p.direction === 'long' ? 1 : -1;
  if (p.pendingExit || (p.maxHoldHours && bar.time - p.openedAt >= p.maxHoldHours * 3_600_000)) {
    // A carried position still owns funding settled exactly at this open.
    for (const event of funding) {
      if (event.time === bar.time && event.time > p.openedAt && Number.isFinite(event.rate) && Number.isFinite(event.markPrice) && event.markPrice > 0) {
        const paid = p.remaining * event.markPrice * event.rate * sign;
        p.funding += paid; p.realizedPnl -= paid;
      }
    }
    exit(p, p.remaining, bar.open, bar.time, p.pendingExit ?? 'timeout', settings);
    p.processedThrough = end;
    delete p.pendingExit;
    return p;
  }
  for (const event of funding) {
    if (event.time >= bar.time && event.time < end && event.time > p.openedAt && Number.isFinite(event.rate) && Number.isFinite(event.markPrice) && event.markPrice > 0) {
      const paid = p.remaining * event.markPrice * event.rate * sign;
      p.funding += paid; p.realizedPnl -= paid;
    }
  }
  p.processedThrough = end;
  const stopHit = sign === 1 ? bar.low <= p.stop : bar.high >= p.stop;
  if (stopHit) {
    exit(p, p.remaining, sign === 1 ? Math.min(bar.open, p.stop) : Math.max(bar.open, p.stop), end, 'stop', settings);
    return p;
  }
  for (const target of p.targets.toSorted((a, b) => (a.price - b.price) * sign)) {
    if (!target.filled && (sign === 1 ? bar.high >= target.price : bar.low <= target.price)) {
      const qty = Math.min(p.remaining, p.quantity * target.fraction);
      exit(p, qty, target.price, end, 'target', settings);
      target.filled = true;
    }
  }
  if (!p.remaining) return p;
  if (p.exitOnReversal) {
    const span = duration[p.entryInterval ?? '1H'];
    const structure = closedHours.filter(b => b.time + span <= end);
    const latest = structure.at(-1);
    if (latest && latest.time + span === end && latest.time >= p.openedAt) {
      const swing = confirmedSwings(structure.slice(0, -1)).filter(s => s.kind === (sign === 1 ? 'low' : 'high') && structure[s.index].time >= p.openedAt).at(-1);
      if (swing && (latest.close - swing.price) * sign < 0) p.pendingExit = 'reversal';
    }
  }
  if (p.manageAfterTp1 && end - p.openedAt >= MPA_RULES.maxHoldHours * 3_600_000) return closePosition(p, bar.close, end, settings);
  const favorable = sign === 1 ? bar.high : bar.low;
  const initialR = Math.abs(p.entry - p.initialStop);
  const reachedR = (favorable - p.entry) * sign / initialR;
  let nextStop = p.stop;
  const improve = (candidate: number) => { nextStop = sign === 1 ? Math.max(nextStop, candidate) : Math.min(nextStop, candidate); };
  if (p.manageAfterTp1 && p.targets[0]?.filled) {
    // TP1 must actually fill first. This stop becomes effective on the next candle.
    improve(p.entry);
    const hours = closedHours.filter(b => b.time + 3_600_000 <= end);
    const swing = confirmedSwings(hours).filter(s => s.kind === (sign === 1 ? 'low' : 'high') && hours[s.index].time >= p.openedAt).at(-1);
    if (swing && (bar.close - swing.price) * sign > 0) improve(swing.price);
  }
  if (p.breakEvenAtR && reachedR >= p.breakEvenAtR) {
    const costRate = (settings.feeBps + settings.slippageBps) / 10_000;
    const cost = p.entry * costRate * 2 + Math.max(0, p.funding) / p.remaining;
    improve(p.entry + sign * cost);
  }
  if (p.trailing && reachedR >= p.trailing.activateAtR) improve(favorable - sign * initialR * p.trailing.distanceR);
  // A newly triggered stop cannot execute retroactively within this candle.
  const rounded = sign === 1 ? floorStep(nextStop, p.instrument.tickSz) : -floorStep(-nextStop, p.instrument.tickSz);
  p.stop = sign === 1 ? Math.max(p.stop, rounded) : Math.min(p.stop, rounded);
  return p;
}
