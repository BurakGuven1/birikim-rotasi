import { createHash } from 'node:crypto';
import { OkxError, type OkxClient } from './client';
import { buildEntryOrder, buildExitOrder, queryOrder } from './execution';

export type IntentState = 'prepared' | 'submitted' | 'unknown' | 'partial' | 'protected' | 'closed' | 'critical' | 'rejected';
export interface DemoOrderInput { signalId: string; id: string; direction: 'long' | 'short'; contracts: number; stop: number; takeProfit: number }
export interface DemoIntent extends DemoOrderInput { clientOrderId: string; state: IntentState; filledContracts: number; version: number; reason?: string }
/** Durable adapter must atomically insert-if-absent (null) or compare-and-set version.
 * Only one leased worker may reconcile a signal at a time. save must preserve immutable
 * order fields; this interface is not a substitute for a distributed worker lease.
 */
export interface IntentRepository { find(signalId: string): Promise<DemoIntent | null>; save(intent: DemoIntent, expectedVersion: number | null): Promise<boolean> }
export interface OrderSnapshot { state: 'live' | 'partially_filled' | 'filled' | 'canceled' | 'mmp_canceled' | 'rejected'; filledContracts: number; remainingContracts: number }
/** Port operations must be scoped to this bot's isolated/net instrument, reject external
 * positions, and serialize protection changes. protectFilled and emergencyClose must
 * reconcile their deterministic action identifiers on retry/restart, never blindly resend.
 * Protection orders must be reduce-only and capped to current owned exposure (which may
 * be below parent cumulative fills after TP). verifyProtection confirms an active exchange stop covering the current filled exposure,
 * not an attached-parent field. verifyFlat must query actual position exposure and verify
 * no bot entry can fill later. These safety operations are required before integration.
 */
export interface ExchangePort {
  readonly mode: 'demo' | 'live';
  place(intent: DemoIntent): Promise<void>;
  query(intent: DemoIntent): Promise<OrderSnapshot | null>;
  cancelParent(intent: DemoIntent): Promise<void>;
  protectFilled(intent: DemoIntent, contracts: number): Promise<void>;
  verifyProtection(intent: DemoIntent, contracts: number): Promise<boolean>;
  emergencyClose(intent: DemoIntent, contracts: number, options: { reduceOnly: true; clientOrderId: string }): Promise<void>;
  verifyFlat(intent: DemoIntent): Promise<boolean>;
}
export function clientIdForSignal(signalId: string): string {
  if (!signalId.trim()) throw new Error('demo_invalid_signal');
  return 'bot' + createHash('sha256').update(signalId).digest('hex').slice(0, 29);
}
const terminalParent = (state: OrderSnapshot['state']) => ['filled', 'canceled', 'mmp_canceled', 'rejected'].includes(state);

export class DemoBroker {
  constructor(private readonly repository: IntentRepository, private readonly exchange: ExchangePort) {
    if (exchange.mode !== 'demo' && exchange.mode !== 'live') throw new Error('demo_gate_blocked');
  }
  async #write(intent: DemoIntent, changes: Partial<Pick<DemoIntent, 'state' | 'reason' | 'filledContracts'>>) {
    const next = { ...intent, ...changes, version: intent.version + 1 };
    if (!await this.repository.save(next, intent.version)) throw new Error('demo_intent_conflict');
    return next;
  }
  async submit(input: DemoOrderInput, gates: { mode: string; strategyReady: boolean; paperValidated: boolean }): Promise<DemoIntent> {
    // The gate stays closed unless the caller's mode, the wired exchange and the readiness flags all
    // agree. Widening it to 'live' does not weaken it: live still needs both readiness flags.
    const tradable = gates.mode === 'demo' || gates.mode === 'live';
    if (!tradable || gates.mode !== this.exchange.mode || !gates.strategyReady || !gates.paperValidated) throw new Error('demo_gate_blocked');
    const clientOrderId = clientIdForSignal(input.signalId);
    buildEntryOrder({ ...input, clientOrderId });
    const existing = await this.repository.find(input.signalId);
    if (existing) {
      for (const key of ['signalId','id','direction','contracts','stop','takeProfit'] as const) if (existing[key] !== input[key]) throw new Error('demo_intent_mismatch');
      if (existing.clientOrderId !== clientOrderId) throw new Error('demo_intent_mismatch');
      return this.reconcile(input.signalId);
    }
    const intent: DemoIntent = { ...input, clientOrderId, state: 'prepared', filledContracts: 0, version: 0 };
    if (!await this.repository.save(intent, null)) throw new Error('demo_intent_conflict');
    try { await this.exchange.place(intent); }
    catch (error) {
      const definiteRejection = error instanceof OkxError && !error.outcomeUnknown && error.code !== '50004' && /^\d{5}$/.test(error.code);
      return this.#write(intent, { state: definiteRejection ? 'rejected' : 'unknown', reason: definiteRejection ? 'exchange_rejected' : 'submission_unconfirmed' });
    }
    return this.#write(intent, { state: 'submitted', reason: undefined });
  }
  async reconcile(signalId: string): Promise<DemoIntent> {
    let intent = await this.repository.find(signalId);
    if (!intent) throw new Error('demo_intent_missing');
    if (intent.clientOrderId !== clientIdForSignal(signalId)) throw new Error('demo_intent_mismatch');
    if (intent.state === 'closed' || intent.state === 'rejected') return intent;
    if (intent.state === 'critical' && !['parent_not_terminal','parent_not_terminal_protection_unconfirmed'].includes(intent.reason ?? '')) return intent;
    if (intent.state === 'protected' || intent.reason === 'emergency_close_pending') {
      try {
        if (await this.exchange.verifyFlat(intent)) return this.#write(intent, { state: 'closed', reason: 'position_flat_confirmed' });
      } catch { return this.#write(intent, { state: 'critical', reason: 'flat_unconfirmed' }); }
      // A crash could have occurred after the emergency POST. Never resend that exit here.
      if (intent.reason === 'emergency_close_pending') return this.#write(intent, { state: 'critical', reason: 'flat_unconfirmed' });
    }
    let snapshot: OrderSnapshot | null;
    try { snapshot = await this.exchange.query(intent); }
    catch { return this.#write(intent, { state: intent.filledContracts > 0 ? 'critical' : 'unknown', reason: 'query_unconfirmed' }); }
    if (!snapshot) return this.#write(intent, { state: intent.filledContracts > 0 ? 'critical' : 'unknown', reason: 'order_not_found_unconfirmed' });
    if (!this.#valid(snapshot, intent)) return this.#write(intent, { state: 'critical', reason: 'invalid_fill_snapshot' });
    if (snapshot.filledContracts === 0) return this.#write(intent, { state: terminalParent(snapshot.state) ? 'rejected' : 'submitted', reason: terminalParent(snapshot.state) ? 'parent_closed_without_fill' : undefined });
    intent = await this.#write(intent, { state: 'partial', filledContracts: snapshot.filledContracts, reason: undefined });
    if (!terminalParent(snapshot.state)) {
      try { await this.exchange.cancelParent(intent); } catch { /* An uncertain cancel must still be queried. */ }
      try { snapshot = await this.exchange.query(intent); } catch { snapshot = null; }
      if (!snapshot || !this.#valid(snapshot, intent) || !terminalParent(snapshot.state)) {
        if (snapshot && this.#valid(snapshot, intent)) intent = await this.#write(intent, { filledContracts: snapshot.filledContracts });
        // Keep mitigating known exposure even while an uncertain parent may fill further.
        // Never claim fully protected or flatten while remaining entry exposure is unknown.
        let protectedObservedFill = false;
        try {
          await this.exchange.protectFilled(intent, intent.filledContracts);
          protectedObservedFill = await this.exchange.verifyProtection(intent, intent.filledContracts);
        } catch { /* Visible critical status retains uncertainty; a later step retries cancellation. */ }
        return this.#write(intent, { state: 'critical', reason: protectedObservedFill ? 'parent_not_terminal' : 'parent_not_terminal_protection_unconfirmed' });
      }
      intent = await this.#write(intent, { filledContracts: snapshot.filledContracts });
    }
    try {
      await this.exchange.protectFilled(intent, intent.filledContracts);
      if (await this.exchange.verifyProtection(intent, intent.filledContracts)) return this.#write(intent, { state: 'protected', reason: undefined });
    } catch { /* Protection is never inferred from a successful parent acknowledgment. */ }
    intent = await this.#write(intent, { state: 'partial', reason: 'emergency_close_pending' });
    try { await this.exchange.emergencyClose(intent, intent.filledContracts, { reduceOnly: true, clientOrderId: clientIdForSignal(intent.signalId + ':emergency-close') }); } catch { /* A timeout might still have closed the position. */ }
    try {
      if (await this.exchange.verifyFlat(intent)) return this.#write(intent, { state: 'closed', reason: 'emergency_flat_confirmed' });
    } catch { /* Persist critical when exchange flatness cannot be proved. */ }
    return this.#write(intent, { state: 'critical', reason: 'flat_unconfirmed' });
  }
  #valid(snapshot: OrderSnapshot, intent: DemoIntent) {
    return ['live','partially_filled','filled','canceled','mmp_canceled','rejected'].includes(snapshot.state) && Number.isFinite(snapshot.filledContracts) && snapshot.filledContracts >= intent.filledContracts && snapshot.filledContracts <= intent.contracts && Number.isFinite(snapshot.remainingContracts) && snapshot.remainingContracts >= 0 && snapshot.remainingContracts <= intent.contracts - snapshot.filledContracts;
  }
}

export type DemoSafetyPort = Pick<ExchangePort, 'protectFilled' | 'verifyProtection' | 'verifyFlat'> & {
  /** Must reconcile exit client id before any send; owns ambiguous-exit recovery. */
  sendIdempotentExit: (payload: ReturnType<typeof buildExitOrder>) => Promise<void>;
};
/** Thin OKX binding; does not invent protection/flatness verification or auto-enable worker. */
export function createOkxDemoExchange(client: OkxClient, safety: DemoSafetyPort): ExchangePort {
  if (client.mode !== 'demo' && client.mode !== 'live') throw new Error('demo_gate_blocked');
  return {
    mode: client.mode,
    place: async (intent) => { await client.post('/api/v5/trade/order', buildEntryOrder(intent)); },
    query: async (intent) => {
      try {
        const order = await queryOrder(client, intent.id, intent.clientOrderId);
        return { state: order.state as OrderSnapshot['state'], filledContracts: order.filledContracts, remainingContracts: order.remainingContracts };
      } catch (error) { if (error instanceof OkxError && error.code === '51603') return null; throw error; }
    },
    cancelParent: async (intent) => { await client.post('/api/v5/trade/cancel-order', { instId: intent.id, clOrdId: intent.clientOrderId }); },
    protectFilled: (intent, quantity) => safety.protectFilled(intent, quantity),
    verifyProtection: (intent, quantity) => safety.verifyProtection(intent, quantity),
    verifyFlat: (intent) => safety.verifyFlat(intent),
    emergencyClose: (intent, contracts, options) => safety.sendIdempotentExit(buildExitOrder({ ...intent, contracts, clientOrderId: options.clientOrderId })),
  };
}
