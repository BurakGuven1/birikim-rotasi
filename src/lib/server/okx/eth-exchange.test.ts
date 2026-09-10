import { describe, expect, it } from 'vitest';
import { OkxClient } from './client';
import { ethClientId, readEthExchange, syncEthProtection } from './eth-exchange';

const env = { OKX_API_KEY: 'key', OKX_API_SECRET: 'secret', OKX_API_PASSPHRASE: 'pass' };
const ID = 'ETH-USDT-SWAP';
const ok = (data: unknown[]) => new Response(JSON.stringify({ code: '0', msg: '', data }));

/** A fake OKX that answers each route from a table and records every write it is sent. */
function exchange(routes: Record<string, unknown[]>) {
  const sent: { path: string; body: unknown }[] = [];
  const client = new OkxClient({ mode: 'live', env, fetch: async (url, init) => {
    const path = new URL(String(url)).pathname + new URL(String(url)).search;
    if (path.startsWith('/api/v5/public/time')) return ok([{ ts: String(Date.now()) }]);
    if (init?.method === 'POST') { sent.push({ path, body: JSON.parse(String(init.body)) }); return ok([{ sCode: '0', ordId: '1', algoId: '1' }]); }
    const key = Object.keys(routes).find(route => path.startsWith(route));
    return ok(key ? routes[key] : []);
  } });
  return { client, sent };
}

describe('eth exchange boundary', () => {
  it('reads the real account and reports only orders this bot placed', async () => {
    const mine = ethClientId('sl', ID, 1900, 5);
    const { client } = exchange({
      '/api/v5/account/balance': [{ details: [{ ccy: 'USDT', availBal: '312.5' }] }],
      '/api/v5/account/positions': [{ instId: ID, pos: '5', avgPx: '2000', markPx: '2010', upl: '5', lever: '3', margin: '333', liqPx: '1500' }],
      '/api/v5/trade/orders-algo-pending': [
        { instId: ID, algoId: 'a1', algoClOrdId: mine, slTriggerPx: '1900', sz: '5', state: 'live' },
        { instId: ID, algoId: 'a2', algoClOrdId: 'manualStopByOwner', slTriggerPx: '1800', sz: '5', state: 'live' },
      ],
      '/api/v5/trade/fills': [{ instId: ID, ts: '1700000000000', side: 'buy', fillPx: '2000', fillSz: '5', fee: '-0.5', ordId: 'o1', fillPnl: '0' }],
    });
    const view = await readEthExchange(client, ID, true);
    expect(view.balanceUsdt).toBe(312.5);
    expect(view.position).toMatchObject({ contracts: 5, direction: 'long', liquidationPrice: 1500 });
    // The owner's hand-placed stop is visible on the exchange but is not the bot's to report or cancel.
    expect(view.algos.map(algo => algo.algoId)).toEqual(['a1']);
    expect(view.fills).toHaveLength(1);
    expect(view.foreign).toBe(false);
  });

  it('flags a position the bot never opened instead of adopting it', async () => {
    const { client } = exchange({
      '/api/v5/account/balance': [{ details: [{ ccy: 'USDT', availBal: '100' }] }],
      '/api/v5/account/positions': [{ instId: ID, pos: '-3', avgPx: '2000' }],
    });
    const view = await readEthExchange(client, ID, false);
    expect(view.position?.direction).toBe('short');
    expect(view.foreign).toBe(true);
  });

  it('cancels a stale stop before placing the new one, never leaving two resting at once', async () => {
    const stale = ethClientId('sl', ID, 1900, 5);
    const { client, sent } = exchange({
      '/api/v5/trade/orders-algo-pending': [{ instId: ID, algoId: 'old', algoClOrdId: stale, slTriggerPx: '1900', sz: '5', state: 'live' }],
    });
    await syncEthProtection(client, { id: ID, direction: 'long', contracts: 5, stop: 1950, target: null, runner: null });
    expect(sent.map(item => item.path)).toEqual(['/api/v5/trade/cancel-algos', '/api/v5/trade/order-algo']);
    expect(sent[1].body).toMatchObject({ slTriggerPx: '1950', sz: '5', reduceOnly: true, side: 'sell' });
  });

  it('leaves an already-correct plan untouched, so a cycle is idempotent', async () => {
    const current = ethClientId('sl', ID, 1950, 5);
    const { client, sent } = exchange({
      '/api/v5/trade/orders-algo-pending': [{ instId: ID, algoId: 'live1', algoClOrdId: current, slTriggerPx: '1950', sz: '5', state: 'live' }],
    });
    const notes = await syncEthProtection(client, { id: ID, direction: 'long', contracts: 5, stop: 1950, target: null, runner: null });
    expect(sent).toHaveLength(0);
    expect(notes).toHaveLength(0);
  });

  it('places the staged plan as separate partial and runner targets', async () => {
    const { client, sent } = exchange({ '/api/v5/trade/orders-algo-pending': [] });
    await syncEthProtection(client, { id: ID, direction: 'long', contracts: 10, stop: 1900, target: { price: 2100, contracts: 5 }, runner: { price: 2300, contracts: 5 } });
    const bodies = sent.map(item => item.body as Record<string, string>);
    expect(bodies).toHaveLength(3);
    expect(bodies.map(body => body.slTriggerPx ?? body.tpTriggerPx)).toEqual(['1900', '2100', '2300']);
    expect(bodies.every(body => body.reduceOnly === true as unknown as string)).toBe(true);
  });

  it('derives the same client id for the same order, so a retry cannot double up', () => {
    expect(ethClientId('entry', ID, 1, 'long', 5)).toBe(ethClientId('entry', ID, 1, 'long', 5));
    expect(ethClientId('entry', ID, 2, 'long', 5)).not.toBe(ethClientId('entry', ID, 1, 'long', 5));
    expect(ethClientId('entry', ID, 1, 'long', 5)).toMatch(/^eth[A-Za-z0-9]{1,29}$/);
  });
});
