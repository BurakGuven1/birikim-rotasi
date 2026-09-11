import { describe, expect, it } from 'vitest';
import { DemoBroker, clientIdForSignal, createOkxDemoExchange, type DemoIntent, type IntentRepository, type ExchangePort, type OrderSnapshot } from './demo-broker';
import { OkxClient, OkxError } from './client';

class MemoryIntents implements IntentRepository {
  rows = new Map<string, DemoIntent>();
  async find(id: string) { return this.rows.has(id) ? structuredClone(this.rows.get(id)!) : null; }
  async save(intent: DemoIntent, expectedVersion: number | null) {
    const current = this.rows.get(intent.signalId);
    if (expectedVersion === null ? Boolean(current) : current?.version !== expectedVersion) return false;
    this.rows.set(intent.signalId, structuredClone(intent));
    return true;
  }
}
const input = { signalId: 'strategy-v1:BTC:long:1800000', id: 'BTC-USDT-SWAP', direction: 'long' as const, contracts: 5, stop: 90, takeProfit: 120 };
const gate = { mode: 'demo', strategyReady: true, paperValidated: true };
function fixture() {
  const repo = new MemoryIntents();
  const calls: string[] = [];
  let snapshot: OrderSnapshot = { state: 'live', filledContracts: 0, remainingContracts: 5 };
  const exchange: ExchangePort = {
    mode: 'demo',
    place: async (intent) => { expect(await repo.find(intent.signalId)).toMatchObject({ state: 'prepared', clientOrderId: intent.clientOrderId }); calls.push('place'); },
    query: async () => { calls.push('query'); return snapshot; },
    cancelParent: async () => { calls.push('cancel'); snapshot = { ...snapshot, state: 'canceled', remainingContracts: 0 }; },
    protectFilled: async (_intent, quantity) => { calls.push(`protect:${quantity}`); },
    verifyProtection: async (_intent, quantity) => { calls.push(`verify:${quantity}`); return true; },
    emergencyClose: async (_intent, quantity, options) => { expect(options.reduceOnly).toBe(true); calls.push(`close:${quantity}`); },
    verifyFlat: async () => { calls.push('flat'); return true; },
  };
  return { repo, exchange, calls, setSnapshot: (value: OrderSnapshot) => { snapshot = value; }, broker: new DemoBroker(repo, exchange) };
}
describe('demo lifecycle', () => {
  it('derives a deterministic alphanumeric client id within the OKX limit', () => {
    expect(clientIdForSignal('signal1')).toBe(clientIdForSignal('signal1'));
    expect(clientIdForSignal('signal1')).not.toBe(clientIdForSignal('signal2'));
    expect(clientIdForSignal('signal1')).toMatch(/^[a-zA-Z0-9]{1,32}$/);
  });
  it('persists before send and restart reconciles without duplicate place', async () => {
    const f = fixture();
    expect(await f.broker.submit(input, gate)).toMatchObject({ state: 'submitted' });
    expect(await new DemoBroker(f.repo, f.exchange).submit(input, gate)).toMatchObject({ state: 'submitted' });
    expect(f.calls).toEqual(['place', 'query']);
  });
  it('ambiguous send stays unknown and restart only queries even when not found', async () => {
    const f = fixture();
    f.exchange.place = async () => { f.calls.push('place'); throw new Error('network contains secret'); };
    f.exchange.query = async () => { f.calls.push('query'); return null; };
    expect(await f.broker.submit(input, gate)).toMatchObject({ state: 'unknown', reason: 'submission_unconfirmed' });
    expect(await new DemoBroker(f.repo, f.exchange).submit(input, gate)).toMatchObject({ state: 'unknown' });
    expect(f.calls).toEqual(['place', 'query']);
    expect(JSON.stringify([...f.repo.rows.values()])).not.toContain('secret');
  });
  it('reconciles operation timeout 50004 without placing again even when custom port omits uncertainty flag', async () => {
    const f = fixture();
    f.exchange.place = async () => { f.calls.push('place'); throw new OkxError('50004'); };
    expect(await f.broker.submit(input, gate)).toMatchObject({ state: 'unknown' });
    expect(await f.broker.submit(input, gate)).toMatchObject({ state: 'submitted' });
    expect(f.calls).toEqual(['place', 'query']);
  });
  it('only one concurrent submission wins atomic intent insertion', async () => {
    const f = fixture();
    await Promise.allSettled([f.broker.submit(input, gate), new DemoBroker(f.repo, f.exchange).submit(input, gate)]);
    expect(f.calls.filter((c) => c === 'place')).toHaveLength(1);
  });
  it('cancels partial parent, re-queries fills and confirms covering stop', async () => {
    const f = fixture();
    await f.broker.submit(input, gate);
    f.setSnapshot({ state: 'partially_filled', filledContracts: 2, remainingContracts: 3 });
    f.exchange.cancelParent = async () => { f.calls.push('cancel'); f.setSnapshot({ state: 'canceled', filledContracts: 3, remainingContracts: 0 }); };
    expect(await f.broker.reconcile(input.signalId)).toMatchObject({ state: 'protected', filledContracts: 3 });
    expect(f.calls).toEqual(['place','query','cancel','query','protect:3','verify:3']);
  });
  it('protection failure triggers reduce-only close and verifies flat', async () => {
    const f = fixture();
    await f.broker.submit(input, gate);
    f.setSnapshot({ state: 'partially_filled', filledContracts: 2, remainingContracts: 3 });
    f.exchange.protectFilled = async () => { throw new Error('failed stop'); };
    expect(await f.broker.reconcile(input.signalId)).toMatchObject({ state: 'closed', filledContracts: 2 });
    expect(f.calls).toContain('close:2');
    expect(f.calls.at(-1)).toBe('flat');
  });
  it('unconfirmed emergency flatten leaves critical state', async () => {
    const f = fixture();
    await f.broker.submit(input, gate);
    f.setSnapshot({ state: 'filled', filledContracts: 5, remainingContracts: 0 });
    f.exchange.verifyProtection = async () => false;
    f.exchange.verifyFlat = async () => false;
    expect(await f.broker.reconcile(input.signalId)).toMatchObject({ state: 'critical', reason: 'flat_unconfirmed' });
  });
  it('a protected trade closes only after actual position flatness is confirmed', async () => {
    const f = fixture();
    await f.broker.submit(input, gate);
    f.setSnapshot({ state: 'filled', filledContracts: 5, remainingContracts: 0 });
    await f.broker.reconcile(input.signalId);
    f.calls.length = 0;
    expect(await f.broker.reconcile(input.signalId)).toMatchObject({ state: 'closed', filledContracts: 5 });
    expect(f.calls).toEqual(['flat']);
  });
  it('restart after emergency intent checks flat before re-establishing any stop', async () => {
    const f = fixture();
    await f.broker.submit(input, gate);
    const stored = (await f.repo.find(input.signalId))!;
    await f.repo.save({ ...stored, state: 'partial', reason: 'emergency_close_pending', filledContracts: 2, version: stored.version + 1 }, stored.version);
    f.calls.length = 0;
    expect(await new DemoBroker(f.repo, f.exchange).reconcile(input.signalId)).toMatchObject({ state: 'closed', filledContracts: 2 });
    expect(f.calls).toEqual(['flat']);
  });
  it('binds only demo clients and builds reduce-only exits with the immutable action id', async () => {
    const payloads: unknown[] = [];
    const safety = { protectFilled: async () => undefined, verifyProtection: async () => true, verifyFlat: async () => true, sendIdempotentExit: async (payload: unknown) => { payloads.push(payload); } };
    expect(() => createOkxDemoExchange(new OkxClient({ mode: 'public', env: {} }), safety)).toThrow('demo_gate_blocked');
    const port = createOkxDemoExchange(new OkxClient({ mode: 'demo', env: {} }), safety);
    const intent: DemoIntent = { ...input, clientOrderId: clientIdForSignal(input.signalId), state: 'partial', filledContracts: 2, version: 1 };
    await port.emergencyClose(intent, 2, { reduceOnly: true, clientOrderId: 'botEmergency123' });
    expect(payloads).toEqual([{ instId: 'BTC-USDT-SWAP', clOrdId: 'botEmergency123', tdMode: 'isolated', posSide: 'net', side: 'sell', ordType: 'market', sz: '2', reduceOnly: true }]);
  });
  it('unconfirmed parent cancellation never claims protected or flat', async () => {
    const f = fixture();
    await f.broker.submit(input, gate);
    f.setSnapshot({ state: 'partially_filled', filledContracts: 2, remainingContracts: 3 });
    f.exchange.cancelParent = async () => undefined;
    expect(await f.broker.reconcile(input.signalId)).toMatchObject({ state: 'critical', reason: 'parent_not_terminal' });
    expect(f.calls).toContain('protect:2');
    expect(f.calls).toContain('verify:2');
    f.setSnapshot({ state: 'partially_filled', filledContracts: 3, remainingContracts: 2 });
    expect(await f.broker.reconcile(input.signalId)).toMatchObject({ state: 'critical', filledContracts: 3 });
    expect(f.calls).toContain('protect:3');
    expect(f.calls.filter((c) => c.startsWith('close:'))).toEqual([]);
  });
  it('rejects immutable intent changes on restart', async () => {
    const f = fixture();
    await f.broker.submit(input, gate);
    await expect(f.broker.submit({ ...input, contracts: 10 }, gate)).rejects.toThrow('intent_mismatch');
    expect(f.calls).toEqual(['place']);
  });
  it.each([{ ...gate, mode: 'live' }, { ...gate, strategyReady: false }, { ...gate, paperValidated: false }])('blocks submission when release gates fail: %j', async (guards) => {
    const f = fixture();
    await expect(f.broker.submit(input, guards)).rejects.toThrow('demo_gate_blocked');
    expect(f.calls).toEqual([]);
    expect(f.repo.rows.size).toBe(0);
  });
});
