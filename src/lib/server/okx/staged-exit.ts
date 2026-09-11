import { floorStep } from '../../bot/risk';
import type { Position } from '../../bot/types';
import { validateInstrumentId } from './market';
import { OkxError, type OkxClient } from './client';
import { clientIdForSignal, type DemoSafetyPort } from './demo-broker';
import { buildExitOrder } from './execution';

/**
 * Carries the model's staged exit onto the exchange.
 *
 * The paper cycle remains the only decision maker: it decides where the stop sits, which target
 * has filled and when the position is done. What this module adds is that those decisions are held
 * as resting exchange orders rather than replayed a minute later at market. That matters because
 * the tested result is built on partial exits that fill *at* their target price: booking them at
 * the next scan instead would hand back the difference on every trade.
 *
 * The layout on the exchange is one reduce-only stop covering the whole filled size, plus one
 * reduce-only take profit per unfilled target sized to that target's share. The stop stays
 * oversized on purpose — reduce-only can never close more than the position holds, so a stop that
 * covers the original fill keeps protecting the runner after the partials are gone, and its
 * trigger is amended in place as break-even and the trailing rule move it.
 *
 * Anything the exchange cannot express as a resting order — a reversal exit, a hold timeout, an
 * end-of-session close — arrives here as exposure the paper position no longer holds, and is
 * closed at market. That backstop also covers the case where a target algo never triggered.
 */
export interface StagedAlgo { algoId: string; algoClOrdId: string; kind: 'stop' | 'target'; triggerPrice: number; contracts: number }

export interface StagedPlan {
  /** Exchange algo ids to cancel, because the position no longer wants that order. */
  cancel: string[];
  place: { algoClOrdId: string; triggerPrice: number; contracts: number }[];
  amendStop: { algoClOrdId: string; triggerPrice: number } | null;
  /** Sent only after the cancels land and exposure is read again, so a filling target algo and
   *  this order can never both close the same contracts. */
  marketExit: { clientOrderId: string; contracts: number } | null;
  reasons: string[];
}

/** Deterministic, ≤32 chars, and sharing the parent's prefix so the safety port recognises it. */
export const stagedAlgoId = (clientOrderId: string, suffix: string) => `${clientOrderId.slice(0, 28)}${suffix}`.slice(0, 32);

export interface StagedInput {
  position: Position;
  /** Contracts the entry order actually filled; every share below is measured against this. */
  filledContracts: number;
  /** Contracts the exchange currently reports for this instrument. */
  exposure: number;
  existing: StagedAlgo[];
  clientOrderId: string;
}

/**
 * Pure. Compares what the paper position wants against what the exchange is holding and returns
 * the difference as orders. Nothing here talks to OKX, so every branch is testable offline.
 */
export function planStagedExit({ position, filledContracts, exposure, existing, clientOrderId }: StagedInput): StagedPlan {
  const plan: StagedPlan = { cancel: [], place: [], amendStop: null, marketExit: null, reasons: [] };
  const { lotSz, minSz, tickSz, ctVal } = position.instrument;
  if (![filledContracts, exposure, lotSz, minSz, tickSz, ctVal].every(v => Number.isFinite(v)) || filledContracts <= 0 || exposure < 0) {
    plan.reasons.push('Geçersiz borsa pozisyon verisi; kademeli çıkış eşitlenmedi.');
    return plan;
  }
  const closed = position.remaining === 0;

  // Targets the paper position still expects to fill, sized to the share of the fill they own.
  // A share that floors below the exchange minimum cannot rest as its own order; the market
  // backstop books it instead, which is what happens throughout the minimum-size proving phase.
  const wanted = closed ? [] : position.targets.flatMap((target, index) => {
    if (target.filled) return [];
    const contracts = floorStep(filledContracts * target.fraction, lotSz);
    if (!(contracts >= minSz) || !(target.price > 0)) return [];
    return [{ algoClOrdId: stagedAlgoId(clientOrderId, `t${index}`), triggerPrice: target.price, contracts }];
  });

  for (const algo of existing) {
    if (algo.kind !== 'target') continue;
    const match = wanted.find(t => t.algoClOrdId === algo.algoClOrdId);
    // A target the paper has already booked, or one resting at a price or size that no longer
    // matches the plan, is cancelled rather than left to fire against a position that moved on.
    if (!match || Math.abs(match.triggerPrice - algo.triggerPrice) > tickSz / 2 || Math.abs(match.contracts - algo.contracts) > lotSz / 2) plan.cancel.push(algo.algoId);
  }
  for (const target of wanted) {
    const resting = existing.find(a => a.kind === 'target' && a.algoClOrdId === target.algoClOrdId);
    if (!resting || plan.cancel.includes(resting.algoId)) plan.place.push(target);
  }

  const stop = existing.find(algo => algo.kind === 'stop');
  if (closed) {
    // Nothing may rest behind a finished position: a stale reduce-only order is a live instruction
    // pointed at whatever the next position turns out to be.
    for (const algo of existing) if (!plan.cancel.includes(algo.algoId)) plan.cancel.push(algo.algoId);
    plan.place.length = 0;
  } else if (stop && Math.abs(stop.triggerPrice - position.stop) > tickSz / 2) {
    plan.amendStop = { algoClOrdId: stop.algoClOrdId, triggerPrice: position.stop };
    plan.reasons.push(`Stop ${stop.triggerPrice} → ${position.stop} taşındı.`);
  } else if (!stop) {
    plan.reasons.push('Borsada bu pozisyona ait stop bulunamadı; koruma doğrulanmadı.');
  }

  // Whatever the paper position no longer holds is closed at market. Sized off the fill rather
  // than off the plan, so a partial entry fill scales the exit down by the same factor.
  const desired = closed ? 0 : floorStep(filledContracts * position.remaining / position.quantity, lotSz);
  const surplus = floorStep(Math.max(0, exposure - desired), lotSz);
  if (surplus >= minSz) {
    // Keyed by how many exits the paper position has booked, so a resend after an ambiguous
    // timeout is the same order to OKX and cannot double up.
    plan.marketExit = { clientOrderId: `${position.id}:sync:${position.exits.length}`, contracts: surplus };
    plan.reasons.push(`Borsada ${exposure} kontrat var, model ${desired} tutuyor; ${surplus} kontrat piyasadan kapatılıyor.`);
  }
  return plan;
}

export interface StagedPort {
  /** Reduce-only algos this bot owns for the instrument, split by what they trigger on. */
  pending(instrumentId: string, clientOrderId: string): Promise<StagedAlgo[]>;
  exposure(instrumentId: string): Promise<number>;
  cancel(instrumentId: string, algoIds: string[]): Promise<void>;
  placeTarget(position: Position, order: { algoClOrdId: string; triggerPrice: number; contracts: number }): Promise<void>;
  amendStop(instrumentId: string, order: { algoClOrdId: string; triggerPrice: number }): Promise<void>;
  marketExit(position: Position, order: { clientOrderId: string; contracts: number }): Promise<void>;
}

const closingSide = (direction: Position['direction']) => direction === 'long' ? 'sell' : 'buy';

export function createOkxStagedPort(client: OkxClient, safety: Pick<DemoSafetyPort, 'sendIdempotentExit'>): StagedPort {
  if (client.mode !== 'demo' && client.mode !== 'live') throw new Error('okx_staged_requires_trading_mode');
  return {
    async pending(instrumentId, clientOrderId) {
      validateInstrumentId(instrumentId);
      const rows = await client.get<Record<string, unknown>>(`/api/v5/trade/orders-algo-pending?instId=${instrumentId}&ordType=conditional`);
      return rows.flatMap(row => {
        const algoId = row.algoId, algoClOrdId = row.algoClOrdId;
        if (typeof algoId !== 'string' || typeof algoClOrdId !== 'string' || !algoClOrdId.startsWith(clientOrderId.slice(0, 28))) return [];
        const stopTrigger = Number(row.slTriggerPx), targetTrigger = Number(row.tpTriggerPx), contracts = Number(row.sz);
        const kind = stopTrigger > 0 ? 'stop' as const : targetTrigger > 0 ? 'target' as const : null;
        if (!kind || !Number.isFinite(contracts) || contracts <= 0) return [];
        return [{ algoId, algoClOrdId, kind, triggerPrice: kind === 'stop' ? stopTrigger : targetTrigger, contracts }];
      });
    },
    async exposure(instrumentId) {
      validateInstrumentId(instrumentId);
      const rows = await client.get<{ instId?: unknown; pos?: unknown }>(`/api/v5/account/positions?instId=${instrumentId}`);
      let net = 0;
      for (const row of rows) {
        if (row.instId !== instrumentId) continue;
        const size = Number(row.pos);
        if (!Number.isFinite(size)) throw new Error('okx_position_unreadable');
        net += size;
      }
      return Math.abs(net);
    },
    async cancel(instrumentId, algoIds) {
      if (!algoIds.length) return;
      validateInstrumentId(instrumentId);
      try { await client.post('/api/v5/trade/cancel-algos', algoIds.map(algoId => ({ instId: instrumentId, algoId }))); }
      // An algo that filled or was already cancelled cannot be cancelled again, and that is the
      // outcome this call wanted; only an unexpected failure is worth propagating.
      catch (error) { if (!(error instanceof OkxError)) throw error; }
    },
    async placeTarget(position, order) {
      await client.post('/api/v5/trade/order-algo', {
        instId: position.instrument.id, tdMode: 'isolated', side: closingSide(position.direction), posSide: 'net',
        ordType: 'conditional', sz: String(order.contracts), reduceOnly: true, algoClOrdId: order.algoClOrdId,
        tpTriggerPx: String(order.triggerPrice), tpOrdPx: '-1', tpTriggerPxType: 'mark',
      });
    },
    async amendStop(instrumentId, order) {
      validateInstrumentId(instrumentId);
      await client.post('/api/v5/trade/amend-algos', [{ instId: instrumentId, algoClOrdId: order.algoClOrdId, newSlTriggerPx: String(order.triggerPrice) }]);
    },
    async marketExit(position, order) {
      // Hashed rather than truncated: the exit counter that makes the key unique sits at its end,
      // and a truncated key would collide across successive exits of the same position.
      await safety.sendIdempotentExit(buildExitOrder({ id: position.instrument.id, clientOrderId: clientIdForSignal(order.clientOrderId),
        direction: position.direction, contracts: order.contracts }));
    },
  };
}

/**
 * Executes a plan. Cancels first, then re-reads exposure before any market order, so a target algo
 * that filled while this ran cannot be closed twice.
 */
export async function applyStagedExit(port: StagedPort, position: Position, filledContracts: number, clientOrderId: string): Promise<string[]> {
  const warnings: string[] = [];
  const id = position.instrument.id;
  const first = planStagedExit({ position, filledContracts, exposure: await port.exposure(id), existing: await port.pending(id, clientOrderId), clientOrderId });
  warnings.push(...first.reasons);
  await port.cancel(id, first.cancel);
  for (const order of first.place) {
    try { await port.placeTarget(position, order); }
    catch (error) { warnings.push(`${id}: kademeli hedef ${order.triggerPrice} borsaya konulamadı (${error instanceof Error ? error.message : 'bilinmeyen'}).`); }
  }
  if (first.amendStop) {
    try { await port.amendStop(id, first.amendStop); }
    catch (error) { warnings.push(`${id}: stop ${first.amendStop.triggerPrice} seviyesine taşınamadı (${error instanceof Error ? error.message : 'bilinmeyen'}); borsadaki stop eski seviyede.`); }
  }
  if (!first.marketExit) return warnings;
  const second = planStagedExit({ position, filledContracts, exposure: await port.exposure(id), existing: await port.pending(id, clientOrderId), clientOrderId });
  if (!second.marketExit) return warnings;
  try { await port.marketExit(position, second.marketExit); }
  catch (error) { warnings.push(`${id}: ${second.marketExit.contracts} kontratlık kapanış gönderilemedi (${error instanceof Error ? error.message : 'bilinmeyen'}); borsadan elle kontrol edin.`); }
  return warnings;
}
