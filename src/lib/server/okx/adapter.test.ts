import { describe, expect, it, vi, afterEach } from 'vitest';
import { getCredentialStatus, getBaseUrl, getCredentials } from './config';
import { OkxClient, signRequest } from './client';
import { getUniverse, getCandles, getHistoricalCandles } from './market';
import { buildEntryOrder, buildExitOrder, normalizeOrder, queryOrder } from './execution';

const env = { OKX_DEMO_API_KEY: 'demo-key', OKX_DEMO_API_SECRET: 'demo-secret', OKX_DEMO_API_PASSPHRASE: 'demo-pass' };
const response = (data: unknown[], code = '0') => new Response(JSON.stringify({ code, msg: 'private text', data }));
afterEach(() => vi.useRealTimers());
describe('OKX boundary', () => {
  it.each([{ code: '50004', data: [] }, { code: '0', data: [{ sCode: '50004' }] }])('treats OKX operation timeout as unknown: %j', async (payload) => {
    const client = new OkxClient({ mode: 'demo', env, fetch: async (url) => String(url).endsWith('/time') ? response([{ ts: String(Date.now()) }]) : new Response(JSON.stringify(payload)) });
    await expect(client.demoPost('/api/v5/trade/order', {})).rejects.toMatchObject({ outcomeUnknown: true });
  });
  it('accepts passphrase aliases and trims credentials while reporting canonical missing names', () => {
    const aliases = { OKX_API_KEY: ' live-key ', OKX_SECRET_KEY: ' live-secret ', OKX_PASSPHRASE: ' live-pass ', OKX_DEMO_API_KEY: ' demo-key ', OKX_DEMO_SECRET_KEY: ' demo-secret ', OKX_DEMO_PASSPHRASE: ' demo-pass ' };
    expect(getCredentialStatus(aliases)).toEqual({ live: { configured: true, missing: [] }, demo: { configured: true, missing: [] } });
    expect(getCredentials('live-readonly', aliases)).toEqual({ key: 'live-key', secret: 'live-secret', passphrase: 'live-pass' });
    expect(getCredentials('demo', aliases)).toEqual({ key: 'demo-key', secret: 'demo-secret', passphrase: 'demo-pass' });
    expect(getCredentialStatus({ OKX_PASSPHRASE: ' ', OKX_DEMO_PASSPHRASE: ' ' }).live.missing).toContain('OKX_API_PASSPHRASE');
    expect(getCredentialStatus({ OKX_PASSPHRASE: ' ', OKX_DEMO_PASSPHRASE: ' ' }).demo.missing).toContain('OKX_DEMO_API_PASSPHRASE');
  });
  it.each([{ code: '0', data: [] }, { code: '0', data: [{}] }, { code: '0', data: [null] }, { code: '0', data: [{ sCode: '0' }] }, { code: '0', data: [{ sCode: 0, ordId: '123' }] }, { code: 0, data: [] }, { code: null, data: [] }, { data: [] }])('treats malformed submitted acknowledgments as unknown: %j', async (payload) => {
    let sends = 0;
    const client = new OkxClient({ mode: 'demo', env, fetch: async (url) => {
      if (String(url).endsWith('/time')) return response([{ ts: String(Date.now()) }]);
      sends++;
      return new Response(JSON.stringify(payload));
    } });
    await expect(client.demoPost('/api/v5/trade/order', {})).rejects.toMatchObject({ outcomeUnknown: true });
    expect(sends).toBe(1);
  });
  it('validates leverage acknowledgments without requiring undocumented sCode', async () => {
    const client = new OkxClient({ mode: 'demo', env, fetch: async (url) => String(url).endsWith('/time') ? response([{ ts: String(Date.now()) }]) : response([{ instId: 'BTC-USDT-SWAP', lever: '5', mgnMode: 'isolated', posSide: 'net' }]) });
    await expect(client.demoPost('/api/v5/account/set-leverage', {})).resolves.toHaveLength(1);
  });
  it('rejects missing algo id and invalid leverage acknowledgments as unknown', async () => {
    const client = new OkxClient({ mode: 'demo', env, fetch: async (url) => String(url).endsWith('/time') ? response([{ ts: String(Date.now()) }]) : response([{ sCode: '0', ordId: '123' }]) });
    await expect(client.demoPost('/api/v5/trade/order-algo', {})).rejects.toMatchObject({ outcomeUnknown: true });
    await expect(client.demoPost('/api/v5/account/set-leverage', {})).rejects.toMatchObject({ outcomeUnknown: true });
  });
  it('requires passphrase and never borrows live credentials for demo', () => {
    expect(getCredentialStatus({ OKX_API_KEY: 'key', OKX_SECRET_KEY: 'secret' })).toEqual({ live: { configured: false, missing: ['OKX_API_PASSPHRASE'] }, demo: { configured: false, missing: ['OKX_DEMO_API_KEY', 'OKX_DEMO_API_SECRET', 'OKX_DEMO_API_PASSPHRASE'] } });
    expect(getCredentialStatus(env).demo.configured).toBe(true);
  });
  it('only permits documented hosts', () => {
    expect(getBaseUrl({ OKX_REGION: 'eea' })).toBe('https://eea.okx.com');
    expect(() => getBaseUrl({ OKX_BASE_URL: 'https://evil.example' })).toThrow();
    expect(() => getBaseUrl({ OKX_REGION: 'evil' })).toThrow();
  });
  it('signs exact query bytes with known HMAC fixture', () => {
    expect(signRequest('fixture-secret', '2020-12-08T09:08:57.715Z', 'GET', '/api/v5/account/balance?ccy=USDT')).toBe('8Py6s5r9SQDv96cVzCu8tBSwT7Mkc85NEi2UUN5PmOk=');
  });
  it('synchronizes private timestamps and adds separate demo authentication', async () => {
    const calls: RequestInit[] = [];
    const client = new OkxClient({ mode: 'demo', env, fetch: async (_url, init) => { calls.push(init!); return calls.length === 1 ? response([{ ts: String(Date.now() + 60000) }]) : response([{ ordId: '123', sCode: '0' }]); } });
    await client.demoPost('/api/v5/trade/order', { instId: 'BTC-USDT-SWAP' });
    const headers = calls[1].headers as Record<string, string>;
    expect(headers['x-simulated-trading']).toBe('1');
    expect(headers['OK-ACCESS-KEY']).toBe('demo-key');
    expect(Date.parse(headers['OK-ACCESS-TIMESTAMP']) - Date.now()).toBeGreaterThan(58000);
    expect(calls[1].redirect).toBe('error');
  });
  it('blocks arbitrary endpoints and all live mutations before network', async () => {
    const fetcher = vi.fn();
    const client = new OkxClient({ mode: 'live-readonly', env: {}, fetch: fetcher });
    await expect(client.demoPost('/api/v5/trade/order', {})).rejects.toThrow();
    await expect(client.get('https://evil.example')).rejects.toThrow();
    await expect(client.get('/api/v5/asset/withdrawal')).rejects.toThrow();
    await expect(new OkxClient({ mode: 'demo', env, fetch: fetcher }).demoPost('/api/v5/account/set-position-mode', {})).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects item errors without leaking exchange message', async () => {
    const client = new OkxClient({ mode: 'demo', env, fetch: async (url) => String(url).endsWith('/time') ? response([{ ts: String(Date.now()) }]) : response([{ sCode: '51000', sMsg: 'demo-secret' }]) });
    await expect(client.demoPost('/api/v5/trade/order', {})).rejects.toThrow('51000');
    await expect(client.demoPost('/api/v5/trade/order', {})).rejects.not.toThrow('demo-secret');
  });
  it('bounds read retries and sanitizes transport errors', async () => {
    let count = 0;
    const client = new OkxClient({ mode: 'public', fetch: async () => { count++; throw new Error('secret'); } });
    await expect(client.get('/api/v5/market/tickers?instType=SWAP')).rejects.not.toThrow('secret');
    expect(count).toBe(3);
  });
  it('times out mutations exactly once leaving outcome unknown', async () => {
    vi.useFakeTimers();
    let sends = 0;
    const client = new OkxClient({ mode: 'demo', env, fetch: async (url, init) => {
      if (String(url).endsWith('/time')) return response([{ ts: String(Date.now()) }]);
      sends++;
      return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('private transport'))));
    } });
    const result = expect(client.demoPost('/api/v5/trade/order', {})).rejects.toThrow('outcome_unknown');
    await vi.advanceTimersByTimeAsync(11000);
    await result;
    expect(sends).toBe(1);
  });
});
describe('market parsing', () => {
  it.each(['3', '4', '5', '6', '', undefined])('excludes noncrypto or unknown instrument category %s', async (instCategory) => {
    const instrument = { instId: 'XAU-USDT-SWAP', instType: 'SWAP', instCategory, ctType: 'linear', state: 'live', settleCcy: 'USDT', ctValCcy: 'XAU', ctVal: '0.01', ctMult: '1', lotSz: '0.01', minSz: '0.01', tickSz: '0.1', lever: '100' };
    const client = new OkxClient({ mode: 'public', fetch: async (url) => String(url).includes('instruments') ? response([instrument]) : response([]) });
    expect(await getUniverse(client)).toEqual([]);
  });
  it('paginates backwards with a bounded page count and range filtering', async () => {
    const paths: string[] = [];
    const bar = (ts: number) => [String(ts), '10', '12', '9', '11', '100', '1', '11', '1'];
    const client = new OkxClient({ mode: 'public', fetch: async (url) => { paths.push(String(url)); return response(paths.length === 1 ? [bar(2700000),bar(1800000)] : [bar(1800000),bar(900000)]); } });
    const result = await getHistoricalCandles(client, 'BTC-USDT-SWAP', '15m', { from: 900000, to: 2700000, maxPages: 2 });
    expect(result.map((c) => c.time)).toEqual([900000,1800000,2700000]);
    expect(paths[1]).toContain('after=1800000');
    await expect(getHistoricalCandles(client, 'BTC-USDT-SWAP', '15m', { maxPages: 601 })).rejects.toThrow();
  });
  it('filters instruments and converts base volume to approximate USDT without contract multiplier twice', async () => {
    const instrument = { instId: 'BTC-USDT-SWAP', instType: 'SWAP', instCategory: '1', ctType: 'linear', state: 'live', settleCcy: 'USDT', ctValCcy: 'BTC', ctVal: '0.01', ctMult: '1', lotSz: '0.01', minSz: '0.01', tickSz: '0.1', lever: '100' };
    const client = new OkxClient({ mode: 'public', fetch: async (url) => String(url).includes('instruments') ? response([instrument, { ...instrument, instId: 'BAD-USDT-SWAP', ctVal: '' }, { ...instrument, ctType: 'inverse' }]) : response([{ instId: instrument.instId, last: '100', bidPx: '99', askPx: '101', volCcy24h: '20', vol24h: '2000', ts: String(Date.now()) }]) });
    expect(await getUniverse(client)).toEqual([{ id: 'BTC-USDT-SWAP', base: 'BTC', ctVal: 0.01, lotSz: 0.01, minSz: 0.01, tickSz: 0.1, maxLeverage: 100, volumeUsdt: 2000, spreadBps: 200 }]);
  });
  it.each([-61000, 11000, NaN])('marks stale/future/missing ticker metrics unavailable (%s)', async (offset) => {
    const instrument = { instId: 'BTC-USDT-SWAP', instType: 'SWAP', instCategory: '1', ctType: 'linear', state: 'live', settleCcy: 'USDT', ctValCcy: 'BTC', ctVal: '0.01', ctMult: '1', lotSz: '0.01', minSz: '0.01', tickSz: '0.1', lever: '100' };
    const client = new OkxClient({ mode: 'public', fetch: async (url) => String(url).includes('instruments') ? response([instrument]) : response([{ instId: instrument.instId, last: '100', bidPx: '99', askPx: '101', volCcy24h: '20', ts: String(Date.now() + offset) }]) });
    expect(await getUniverse(client)).toMatchObject([{ spreadBps: null, volumeUsdt: null }]);
  });
  it('keeps valid confirmed candles sorted unique with base-volume units', async () => {
    const bar = ['1800000', '10', '12', '9', '11', '100', '1', '11', '1'];
    const client = new OkxClient({ mode: 'public', fetch: async () => response([bar, bar, ['900000', '10', '12', '9', '11', '100', '1', '11', '1'], [...bar.slice(0,8), '0'], ['1', '10', '8', '9', '11', '1', '1', '1', '1'], null]) });
    expect(await getCandles(client, 'BTC-USDT-SWAP', '15m')).toEqual([{ time: 900000, open: 10, high: 12, low: 9, close: 11, volume: 1 }, { time: 1800000, open: 10, high: 12, low: 9, close: 11, volume: 1 }]);
  });
});
describe('demo order mapping', () => {
  it('uses contracts, net isolated mode, attached market triggers and reduce-only exits', () => {
    const order = buildEntryOrder({ id: 'BTC-USDT-SWAP', clientOrderId: 'bot123', direction: 'long', contracts: 2, stop: 90, takeProfit: 120 });
    // Stop only: a full-size attached take profit would close the whole position at the first
    // target, which is not the staged exit the position was sized for.
    expect(order).toMatchObject({ sz: '2', tdMode: 'isolated', posSide: 'net', side: 'buy', attachAlgoOrds: [{ slTriggerPx: '90', slOrdPx: '-1' }] });
    expect(order.attachAlgoOrds[0]).not.toHaveProperty('tpTriggerPx');
    expect(buildExitOrder({ id: 'BTC-USDT-SWAP', clientOrderId: 'exit123', direction: 'short', contracts: 1 })).toMatchObject({ side: 'buy', reduceOnly: true, sz: '1' });
    expect(() => buildEntryOrder({ id: 'BTC-USDT-SWAP', clientOrderId: 'bad-id', direction: 'long', contracts: -1, stop: 90, takeProfit: 120 })).toThrow();
  });
  it('uses cumulative partial fills and never infers stop protection from attachments', async () => {
    const raw = { ordId: '123', clOrdId: 'bot123', state: 'partially_filled', sz: '5', accFillSz: '2', fillSz: '1', avgPx: '100', attachAlgoOrds: [{ attachAlgoId: '55' }] };
    expect(normalizeOrder(raw)).toMatchObject({ state: 'partially_filled', filledContracts: 2, remainingContracts: 3, protectionConfirmed: false });
    const client = new OkxClient({ mode: 'demo', env, fetch: async (url) => String(url).endsWith('/time') ? response([{ ts: String(Date.now()) }]) : response([raw]) });
    expect(await queryOrder(client, 'BTC-USDT-SWAP', 'bot123')).toMatchObject({ orderId: '123' });
    expect(() => normalizeOrder({ ...raw, accFillSz: 'NaN' })).toThrow();
  });
  it('rejects mismatched client ids during uncertain-order reconciliation', async () => {
    const client = new OkxClient({ mode: 'demo', env, fetch: async (url) => String(url).endsWith('/time') ? response([{ ts: String(Date.now()) }]) : response([{ ordId: '123', clOrdId: 'otherOrder', state: 'live', sz: '5', accFillSz: '0', avgPx: '' }]) });
    await expect(queryOrder(client, 'BTC-USDT-SWAP', 'bot123')).rejects.toThrow('okx_order_identity_mismatch');
  });
});

