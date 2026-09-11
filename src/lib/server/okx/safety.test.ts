import { describe, expect, it } from 'vitest';
import { OkxClient } from './client';
import { createOkxSafetyPort } from './safety';
import type { DemoIntent } from './demo-broker';

const response = (data: unknown[]) => new Response(JSON.stringify({ code: '0', data }), { status: 200 });
const intent: DemoIntent = { signalId: 's1', id: 'BTC-USDT-SWAP', direction: 'long', contracts: 4, stop: 90, takeProfit: 120,
  clientOrderId: 'bot0123456789012345678901234567', state: 'partial', filledContracts: 2, version: 1 };

function harness(handler: (url: string, init?: RequestInit) => unknown[]) {
  const calls: { url: string; body: unknown }[] = [];
  const client = new OkxClient({ mode: 'live', env: { OKX_API_KEY: 'k', OKX_API_SECRET: 's', OKX_API_PASSPHRASE: 'p' },
    fetch: async (url, init) => {
      // The signed client syncs its clock before any private call.
      if (String(url).includes('/public/time')) return response([{ ts: String(Date.now()) }]);
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      return response(handler(String(url), init));
    } });
  return { calls, port: createOkxSafetyPort(client) };
}
const ack = { sCode: '0', algoId: '12345', ordId: '12345' };
const stop = (over: Record<string, unknown> = {}) => ({ algoId: 'a1', algoClOrdId: 'bot012345678901234567890123456sl',
  instId: 'BTC-USDT-SWAP', side: 'sell', sz: '2', slTriggerPx: '90', state: 'live', ...over });

describe('okx safety port', () => {
  it('refuses to exist outside a trading mode', () => {
    expect(() => createOkxSafetyPort(new OkxClient({ mode: 'public' }))).toThrow('okx_safety_requires_trading_mode');
  });

  it('places a reduce-only stop in the closing direction sized to the fill', async () => {
    const f = harness(url => url.includes('orders-algo-pending') ? [] : [ack]);
    await f.port.protectFilled(intent, 2);
    const placed = f.calls.find(c => c.url.includes('/trade/order-algo'))!;
    expect(placed.body).toMatchObject({ instId: 'BTC-USDT-SWAP', side: 'sell', reduceOnly: true, sz: '2', slTriggerPx: '90' });
  });

  it('does not stack a second stop when one already covers the exposure', async () => {
    const f = harness(url => url.includes('orders-algo-pending') ? [stop({ sz: '4' })] : [ack]);
    await f.port.protectFilled(intent, 2);
    expect(f.calls.some(c => c.url.includes('/trade/order-algo'))).toBe(false);
  });

  it('cancels an undersized stop before placing the correct one', async () => {
    const f = harness(url => url.includes('orders-algo-pending') ? [stop({ sz: '1' })] : [ack]);
    await f.port.protectFilled(intent, 3);
    expect(f.calls.some(c => c.url.includes('cancel-algos'))).toBe(true);
    expect(f.calls.some(c => c.url.includes('/trade/order-algo'))).toBe(true);
  });

  it('confirms protection only from a live exchange stop that covers the exposure', async () => {
    expect(await harness(() => [stop({ sz: '4' })]).port.verifyProtection(intent, 2)).toBe(true);
    expect(await harness(() => [stop({ sz: '1' })]).port.verifyProtection(intent, 2)).toBe(false);
    expect(await harness(() => [stop({ state: 'canceled' })]).port.verifyProtection(intent, 2)).toBe(false);
    expect(await harness(() => [stop({ side: 'buy' })]).port.verifyProtection(intent, 2)).toBe(false);
    expect(await harness(() => [stop({ slTriggerPx: '0' })]).port.verifyProtection(intent, 2)).toBe(false);
    expect(await harness(() => []).port.verifyProtection(intent, 2)).toBe(false);
  });

  it('never reports flat while the exchange still shows exposure', async () => {
    const f = harness(url => url.includes('account/positions') ? [{ instId: 'BTC-USDT-SWAP', pos: '-3' }] : []);
    expect(await f.port.verifyFlat(intent)).toBe(false);
  });

  it('never reports flat while this bot entry could still fill', async () => {
    const f = harness(url => url.includes('account/positions') ? [{ instId: 'BTC-USDT-SWAP', pos: '0' }]
      : url.includes('orders-pending') ? [{ instId: 'BTC-USDT-SWAP', clOrdId: intent.clientOrderId, state: 'live' }] : []);
    expect(await f.port.verifyFlat(intent)).toBe(false);
  });

  it('reports flat only with no exposure and no working entry', async () => {
    const f = harness(url => url.includes('account/positions') ? [{ instId: 'BTC-USDT-SWAP', pos: '0' }] : []);
    expect(await f.port.verifyFlat(intent)).toBe(true);
  });

  it('treats a duplicate exit identifier as the exit already being on the exchange', async () => {
    const client = new OkxClient({ mode: 'live', env: { OKX_API_KEY: 'k', OKX_API_SECRET: 's', OKX_API_PASSPHRASE: 'p' },
      fetch: async (url) => String(url).includes('/public/time')
        ? new Response(JSON.stringify({ code: '0', data: [{ ts: String(Date.now()) }] }), { status: 200 })
        : new Response(JSON.stringify({ code: '51603', data: [] }), { status: 200 }) });
    await expect(createOkxSafetyPort(client).sendIdempotentExit({ instId: 'BTC-USDT-SWAP' } as never)).resolves.toBeUndefined();
  });
});
