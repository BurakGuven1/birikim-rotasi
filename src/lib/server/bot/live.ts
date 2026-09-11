import { OkxClient } from '../okx/client';
import { DemoBroker, clientIdForSignal, createOkxDemoExchange, type DemoIntent } from '../okx/demo-broker';
import { createOkxSafetyPort } from '../okx/safety';
import { buildExitOrder } from '../okx/execution';
import { applyStagedExit, createOkxStagedPort } from '../okx/staged-exit';
import type { BotSettings, Position } from '../../bot/types';
import type { BotStore } from './store';

/**
 * Mirrors the decisions the paper engine already made onto the real exchange.
 *
 * The paper cycle stays the single decision maker: it sizes, opens and closes. This module only
 * turns those decisions into orders and then reconciles what the exchange actually did. Keeping
 * the decision and the execution separate means a broker failure can never invent a trade, and a
 * position that exists on the exchange always has a paper record explaining why it is there.
 */
export interface LiveOutcome { submitted: number; reconciled: number; synced: number; warnings: string[]; critical: string[] }

/** Contracts to send. Until one full live cycle has been proven, this is the exchange minimum. */
export function liveContracts(position: Position, settings: BotSettings): number {
  const planned = position.quantity / position.instrument.ctVal;
  if (settings.liveVerified) return planned;
  // The first real trades exist to prove the order chain, not to make money.
  return Math.min(planned, position.instrument.minSz);
}

/**
 * Writes the account's leverage for this contract before anything is sent to it.
 *
 * The sizer derives contracts from a margin budget that assumes `settings.leverage`. OKX applies
 * whatever leverage the account already carries for the instrument, which is not necessarily that
 * number, so an order placed without this step is not the position that was sized: too low and the
 * margin required is a multiple of what was budgeted, too high and the stop sits far inside the
 * liquidation distance the risk check reasoned about. An unconfirmed acknowledgment is a failure.
 */
export async function applyLeverage(client: OkxClient, id: string, leverage: number): Promise<void> {
  const rows = await client.post<{ lever?: unknown }>('/api/v5/account/set-leverage', { instId: id, lever: String(leverage), mgnMode: 'isolated', posSide: 'net' });
  if (Number(rows[0]?.lever) !== leverage) throw new Error('okx_leverage_not_applied');
}

export function createLiveBroker(store: BotStore, owner: string) {
  const client = new OkxClient({ mode: 'live' });
  return new DemoBroker(store.demoIntents(owner), createOkxDemoExchange(client, createOkxSafetyPort(client)));
}

export async function mirrorLive(store: BotStore, owner: string, settings: BotSettings, opened: Position[], strategyReady: boolean, known: Position[] = []): Promise<LiveOutcome> {
  const outcome: LiveOutcome = { submitted: 0, reconciled: 0, synced: 0, warnings: [], critical: [] };
  if (settings.executionMode !== 'live') return outcome;
  const broker = createLiveBroker(store, owner);
  const client = new OkxClient({ mode: 'live' });
  const gates = { mode: 'live', strategyReady, paperValidated: true };
  const levered = new Set<string>();

  for (const position of opened) {
    const contracts = liveContracts(position, settings);
    if (!(contracts > 0)) { outcome.warnings.push(`${position.instrument.id}: canlı emir için geçerli kontrat yok.`); continue; }
    const target = position.targets[0]?.price;
    if (!Number.isFinite(target) || !Number.isFinite(position.stop)) { outcome.warnings.push(`${position.instrument.id}: koruma seviyeleri eksik; emir gönderilmedi.`); continue; }
    if (!levered.has(position.instrument.id)) {
      try { await applyLeverage(client, position.instrument.id, settings.leverage); levered.add(position.instrument.id); }
      catch (error) { outcome.warnings.push(`${position.instrument.id}: kaldıraç ${settings.leverage}× olarak yazılamadı (${error instanceof Error ? error.message : 'bilinmeyen'}); emir gönderilmedi.`); continue; }
    }
    try {
      // The entry carries the stop and nothing else. The profit side is placed per target once the
      // fill is confirmed, by the staged-exit sync below, so the exchange holds the same 40/40/20
      // plan the position was sized for rather than one full-size exit at the first target.
      const intent = await broker.submit({ signalId: position.id, id: position.instrument.id, direction: position.direction,
        contracts, stop: position.stop, takeProfit: target! }, gates);
      outcome.submitted++;
      if (intent.state === 'critical') outcome.critical.push(`${position.instrument.id}: ${intent.reason ?? 'kritik durum'}`);
    } catch (error) { outcome.warnings.push(`${position.instrument.id}: canlı emir gönderilemedi (${error instanceof Error ? error.message : 'bilinmeyen'}).`); }
  }

  // Every intent that is not finished is walked forward, so a fill that happened while the worker
  // was down still gets its protective stop and a closed position is recorded as closed.
  const intents = store.openIntents();
  for (const intent of intents) {
    try {
      const next = await broker.reconcile(intent.signalId);
      outcome.reconciled++;
      if (next.state === 'critical') outcome.critical.push(`${next.id}: ${next.reason ?? 'kritik durum'}`);
    } catch (error) { outcome.warnings.push(`${intent.id}: mutabakat tamamlanamadı (${error instanceof Error ? error.message : 'bilinmeyen'}).`); }
  }

  // The staged exit is carried onto the exchange only once the entry is confirmed filled and
  // protected. Before that the position size is not yet known, and placing profit-taking orders
  // against an unconfirmed fill is how a reduce-only order becomes an accidental new position.
  const staged = createOkxStagedPort(client, createOkxSafetyPort(client));
  const positions = new Map(known.map(position => [position.id, position]));
  for (const intent of store.openIntents()) {
    const position = positions.get(intent.signalId);
    // A finished position is synced too: that is the pass which cancels its resting orders and
    // closes anything the exchange is still carrying for it.
    if (!position || intent.state !== 'protected' || intent.filledContracts <= 0) continue;
    try {
      const warnings = await applyStagedExit(staged, position, intent.filledContracts, intent.clientOrderId);
      outcome.synced++;
      outcome.warnings.push(...warnings.map(warning => `${intent.id}: ${warning}`));
    } catch (error) { outcome.critical.push(`${intent.id}: kademeli çıkış borsayla eşitlenemedi (${error instanceof Error ? error.message : 'bilinmeyen'}); stop yerinde ama hedefler doğrulanmadı.`); }
  }
  return outcome;
}

/**
 * Closes every live position this bot owns. It talks to the exchange directly rather than through
 * the intent state machine, because a kill switch has to work precisely when that machine is stuck
 * in 'critical'. Exits are reduce-only and keyed by a deterministic id, so a retry cannot double up.
 */
export async function emergencyCloseLive(store: BotStore, settings: BotSettings): Promise<LiveOutcome> {
  const outcome: LiveOutcome = { submitted: 0, reconciled: 0, synced: 0, warnings: [], critical: [] };
  if (settings.executionMode !== 'live') return outcome;
  const client = new OkxClient({ mode: 'live' });
  const safety = createOkxSafetyPort(client);
  const staged = createOkxStagedPort(client, safety);
  for (const intent of store.openIntents()) {
    if (intent.filledContracts <= 0) continue;
    try {
      await safety.sendIdempotentExit(buildExitOrder({ id: intent.id, direction: intent.direction, contracts: intent.filledContracts,
        clientOrderId: clientIdForSignal(intent.signalId + ':emergency-close') }));
      outcome.submitted++;
      if (!await safety.verifyFlat(intent)) outcome.critical.push(`${intent.id}: kapanış doğrulanamadı; borsadan elle kontrol edin.`);
      // Flat is not finished: a staged take profit left resting is a reduce-only instruction that
      // would fire against whatever position this instrument holds next.
      const resting = await staged.pending(intent.id, intent.clientOrderId);
      await staged.cancel(intent.id, resting.map(algo => algo.algoId));
    } catch (error) { outcome.critical.push(`${intent.id}: acil kapatma başarısız (${error instanceof Error ? error.message : 'bilinmeyen'}); borsadan elle kapatın.`); }
  }
  return outcome;
}

export type { DemoIntent };
