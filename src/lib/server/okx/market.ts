import type { OkxClient } from './client';
export interface OkxInstrument { id: string; base: string; ctVal: number; lotSz: number; minSz: number; tickSz: number; maxLeverage: number; /** Approximation: base volume times latest price. */ volumeUsdt: number | null; spreadBps: number | null }
export interface OkxCandle { time: number; open: number; high: number; low: number; close: number; /** Base currency volume (OKX volCcy). */ volume: number }
export type OkxInterval = '15m' | '1H' | '4H' | '1Dutc' | '1Wutc';
const number = (value: unknown): number => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN;
const positive = (value: unknown) => Number.isFinite(number(value)) && number(value) > 0;
export function validateInstrumentId(id: string) { if (!/^[A-Z0-9]+-USDT-SWAP$/.test(id)) throw new Error('okx_invalid_instrument'); }
export async function getUniverse(client: OkxClient): Promise<OkxInstrument[]> {
  const [instruments, tickers] = await Promise.all([client.get<Record<string, unknown>>('/api/v5/public/instruments?instType=SWAP'), client.get<Record<string, unknown>>('/api/v5/market/tickers?instType=SWAP')]);
  const byId = new Map(tickers.filter((t) => t && typeof t.instId === 'string').map((t) => [t.instId, t]));
  const result = new Map<string, OkxInstrument>();
  for (const raw of instruments) {
    if (!raw || raw.instType !== 'SWAP' || raw.instCategory !== '1' || raw.ctType !== 'linear' || raw.state !== 'live' || raw.settleCcy !== 'USDT' || typeof raw.instId !== 'string' || !/^[A-Z0-9]+-USDT-SWAP$/.test(raw.instId)) continue;
    const base = raw.instId.split('-')[0];
    if (raw.ctValCcy !== base || !['ctVal', 'lotSz', 'minSz', 'tickSz', 'lever'].every((key) => positive(raw[key])) || (raw.ctMult !== undefined && !positive(raw.ctMult))) continue;
    const ticker = byId.get(raw.instId);
    const tickerTime = number(ticker?.ts);
    const age = Date.now() - tickerTime;
    const fresh = Number.isSafeInteger(tickerTime) && age >= -10000 && age <= 60000;
    const bid = number(ticker?.bidPx), ask = number(ticker?.askPx), last = number(ticker?.last), volume = number(ticker?.volCcy24h);
    const ctVal = number(raw.ctVal) * (raw.ctMult === undefined ? 1 : number(raw.ctMult));
    if (!Number.isFinite(ctVal)) continue;
    result.set(raw.instId, { id: raw.instId, base, ctVal, lotSz: number(raw.lotSz), minSz: number(raw.minSz), tickSz: number(raw.tickSz), maxLeverage: number(raw.lever), volumeUsdt: fresh && positive(last) && Number.isFinite(volume * last) && volume >= 0 ? volume * last : null, spreadBps: fresh && positive(bid) && positive(ask) && ask >= bid ? (ask - bid) / ((ask + bid) / 2) * 10000 : null });
  }
  return [...result.values()].sort((a,b) => a.id.localeCompare(b.id));
}
export function parseCandles(rows: unknown[]): OkxCandle[] {
  const unique = new Map<number, OkxCandle>();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 9 || row[8] !== '1') continue;
    const [time, open, high, low, close] = row.slice(0, 5).map(number), volume = number(row[6]);
    if (![time,open,high,low,close,volume].every(Number.isFinite) || !Number.isSafeInteger(time) || time < 0 || Math.min(open,high,low,close) <= 0 || volume < 0 || low > Math.min(open,close) || high < Math.max(open,close) || low > high) continue;
    unique.set(time, { time, open, high, low, close, volume });
  }
  return [...unique.values()].sort((a,b) => a.time - b.time);
}
export async function getCandles(client: OkxClient, id: string, interval: OkxInterval, limit = 300): Promise<OkxCandle[]> {
  validateInstrumentId(id);
  if (!['15m','1H','4H','1Dutc','1Wutc'].includes(interval) || !Number.isInteger(limit) || limit < 1 || limit > 300) throw new Error('okx_invalid_candle_request');
  return parseCandles(await client.get(`/api/v5/market/candles?instId=${id}&bar=${interval}&limit=${limit}`));
}
/** Bounded historical fetch; callers must verify coverage/gaps before replay. Range uses candle open time. */
export async function getHistoricalCandles(client: OkxClient, id: string, interval: OkxInterval, options: { from?: number; to?: number; maxPages?: number } = {}): Promise<OkxCandle[]> {
  validateInstrumentId(id);
  const { from = 0, to = Date.now(), maxPages = 10 } = options;
  if (!['15m','1H','4H','1Dutc','1Wutc'].includes(interval) || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 600) throw new Error('okx_invalid_history_request');
  let cursor = to + 1;
  const candles = new Map<number, OkxCandle>();
  for (let page = 0; page < maxPages; page++) {
    const rows = await client.get<unknown>(`/api/v5/market/history-candles?instId=${id}&bar=${interval}&limit=100&after=${cursor}`);
    const parsed = parseCandles(rows);
    for (const candle of parsed) if (candle.time >= from && candle.time <= to) candles.set(candle.time, candle);
    const times = rows.flatMap((row) => Array.isArray(row) && Number.isSafeInteger(number(row[0])) && number(row[0]) >= 0 ? [number(row[0])] : []);
    if (!times.length) break;
    const next = Math.min(...times);
    if (next <= from || next >= cursor) break;
    cursor = next;
    if (page + 1 < maxPages) await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return [...candles.values()].sort((a,b) => a.time - b.time);
}
