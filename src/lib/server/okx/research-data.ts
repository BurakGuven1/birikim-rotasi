import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { Frames, Funding, Candle } from '../../bot/types';
import type { OkxClient } from './client';
import { getCandles, getHistoricalCandles, validateInstrumentId, type OkxInterval } from './market';

const durations: Record<OkxInterval, number> = { '15m': 900000, '1H': 3600000, '4H': 14400000, '1Dutc': 86400000, '1Wutc': 604800000 };
const warmup: Record<OkxInterval, number> = { '15m': 120, '1H': 200, '4H': 100, '1Dutc': 80, '1Wutc': 60 };
const bars = Object.keys(durations) as OkxInterval[];
const numeric = (value: unknown) => typeof value === 'string' && value.trim() || typeof value === 'number' ? Number(value) : NaN;
const pause = () => new Promise((done) => setTimeout(done, 120));
const align = (time: number, interval: OkxInterval) => {
  const offset = interval === '1Wutc' ? 345600000 : 0; // Monday 1970-01-05, 00:00 UTC.
  return Math.floor((time - offset) / durations[interval]) * durations[interval] + offset;
};
export interface ResearchData { frames: Frames; funding: Funding[]; fundingComplete: boolean; warnings: string[] }
interface FundingRate { time: number; rate: number }

/** Public exchange clock, floored to the most recent 15m close, never local wall-clock. */
export async function latestClosedTime(client: OkxClient): Promise<number> {
  const rows = await client.get<{ ts: string }>('/api/v5/public/time');
  const time = numeric(rows[0]?.ts);
  if (!Number.isSafeInteger(time) || time <= 0) throw new Error('okx_research_invalid_server_time');
  return align(time, '15m');
}
export function parseFundingRates(rows: unknown[], from: number, to: number): FundingRate[] {
  const rates = new Map<number, FundingRate>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const raw = row as Record<string, unknown>;
    const time = numeric(raw.fundingTime);
    const realized = numeric(raw.realizedRate);
    const rate = Number.isFinite(realized) ? realized : numeric(raw.fundingRate);
    if (Number.isSafeInteger(time) && time >= from && time <= to && Number.isFinite(rate)) rates.set(time, { time, rate });
  }
  return [...rates.values()].sort((a,b) => a.time - b.time);
}
/** Funding mark is the 15m MARK candle open at settlement, an explicit approximation. */
export function mapFundingMarks(rates: FundingRate[], rows: unknown[]): { funding: Funding[]; complete: boolean } {
  const prices = new Map<number, number>();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6 || row[5] !== '1') continue;
    const [time, open, high, low, close] = row.slice(0,5).map(numeric);
    if (Number.isSafeInteger(time) && [open,high,low,close].every((n) => Number.isFinite(n) && n > 0) && low <= Math.min(open,close) && high >= Math.max(open,close)) prices.set(time, open);
  }
  const funding = rates.flatMap((rate) => prices.has(rate.time) ? [{ ...rate, markPrice: prices.get(rate.time)! }] : []);
  return { funding, complete: rates.length > 0 && funding.length === rates.length };
}
/** Inclusive OPEN timestamp boundaries; requires every expected closed candle. */
export function requireCandleCoverage(candles: Candle[], from: number, to: number, interval: OkxInterval): void {
  const expected = Math.floor((to - from) / durations[interval]) + 1;
  if (!Array.isArray(candles) || candles.length !== expected || candles.some((candle,index) => !candle || candle.time !== from + index * durations[interval] || ![candle.open,candle.high,candle.low,candle.close,candle.volume].every(Number.isFinite) || Math.min(candle.open,candle.high,candle.low,candle.close) <= 0 || candle.volume < 0 || candle.low > Math.min(candle.open,candle.close) || candle.high < Math.max(candle.open,candle.close))) throw new Error(`okx_research_ohlc_coverage_${interval}`);
}
function frameArray(frames: Frames, interval: OkxInterval): Candle[] {
  return interval === '1Dutc' ? frames.bias!.daily : interval === '1Wutc' ? frames.bias!.weekly : frames[interval];
}
function coverage(data: ResearchData, from: number, to: number, required: OkxInterval[] = bars) {
  for (const interval of required) requireCandleCoverage(frameArray(data.frames, interval), align(from, interval) - warmup[interval] * durations[interval], align(to, interval) - durations[interval], interval);
}
async function fundingHistory(client: OkxClient, id: string, from: number, to: number): Promise<{ rates: FundingRate[]; complete: boolean; warnings: string[] }> {
  let cursor = to, reachedStart = false, malformed = false;
  const raw: unknown[] = [];
  for (let page = 0; page < 100; page++) {
    const rows = await client.get<Record<string, unknown>>(`/api/v5/public/funding-rate-history?instId=${id}&limit=400&after=${cursor}`);
    if (!rows.length) break;
    const valid = rows.filter((row) => row && (row.instId === undefined || row.instId === id) && Number.isSafeInteger(numeric(row.fundingTime)) && numeric(row.fundingTime) < cursor);
    malformed ||= valid.length !== rows.length || parseFundingRates(valid, 0, to - 1).length !== valid.length;
    raw.push(...valid);
    if (!valid.length) break;
    const oldest = Math.min(...valid.map((row) => numeric(row.fundingTime)));
    if (oldest <= from) { reachedStart = true; break; }
    if (oldest >= cursor) break;
    cursor = oldest;
    await pause();
  }
  const all = parseFundingRates(raw, 0, to - 1), rates = all.filter((rate) => rate.time >= from);
  // The authoritative history stream is paged past the starting boundary. A >8h hole
  // or uncovered recent edge is conservatively incomplete (settlement can be 1/2/4/8h).
  const maxGap = 8 * 3600000;
  const complete = reachedStart && !malformed && all.length > 0 && to - all.at(-1)!.time <= maxGap && all.every((rate,index) => index === 0 || rate.time - all[index - 1].time <= maxGap);
  const fallback = raw.some((row) => !Number.isFinite(numeric((row as Record<string, unknown>).realizedRate)));
  return { rates, complete, warnings: [...(!complete ? ['funding_history_incomplete'] : []), ...(fallback ? ['funding_rate_fallback_used_without_realized_rate'] : [])] };
}
async function markHistory(client: OkxClient, id: string, from: number, to: number): Promise<unknown[]> {
  const rows: unknown[] = [];
  let cursor = to;
  for (let page = 0; page < 100; page++) {
    const pageRows = await client.get<unknown>(`/api/v5/market/history-mark-price-candles?instId=${id}&bar=15m&limit=100&after=${cursor}`);
    if (!pageRows.length) break;
    rows.push(...pageRows);
    const times = pageRows.flatMap((row) => Array.isArray(row) && Number.isSafeInteger(numeric(row[0])) ? [numeric(row[0])] : []);
    if (!times.length) break;
    const oldest = Math.min(...times);
    if (oldest <= from || oldest >= cursor) break;
    cursor = oldest;
    await pause();
  }
  return rows;
}

/** Interval [from,to), maximum 1200 days. Throws on insufficient/gapped OHLC, including warmup.
 * Local clock does not extend exchange history. Incomplete funding remains explicit.
 */
export async function loadResearchData(client: OkxClient, id: string, options: { from: number; to: number; cache?: boolean; frames?: OkxInterval[] }): Promise<ResearchData> {
  validateInstrumentId(id);
  if (![options.from,options.to].every(Number.isSafeInteger) || options.from <= 0 || options.to <= options.from || options.to - options.from > 1200 * 86400000) throw new Error('okx_research_invalid_range');
  const end = Math.min(options.to, await latestClosedTime(client));
  if (end <= options.from) throw new Error('okx_research_range_after_exchange_time');
  const from = options.from;
  const clampWarnings = end < options.to ? ['requested_end_clamped_to_okx_server_time'] : [];
  // Only the frames a study actually reads are fetched and required, so a 4H model is not blocked
  // by a contract whose 15m history is shorter than the requested window.
  const required = options.frames ?? bars;
  const cacheDir = resolve(process.cwd(), '.bot-data', 'market-cache');
  const key = createHash('sha256').update(`v1:${id}:${from}:${end}:${required.join(',')}`).digest('hex');
  const path = join(cacheDir, key + '.json');
  if (options.cache !== false) {
    try {
      const cached = JSON.parse(await readFile(path, 'utf8')) as ResearchData;
      coverage(cached, from, end, required);
      if (typeof cached.fundingComplete === 'boolean' && Array.isArray(cached.warnings) && cached.warnings.every((w) => typeof w === 'string') && Array.isArray(cached.funding) && cached.funding.every((f,index) => f && Number.isSafeInteger(f.time) && f.time >= from && f.time < end && Number.isFinite(f.rate) && Number.isFinite(f.markPrice) && f.markPrice > 0 && (index === 0 || f.time > cached.funding[index - 1].time))) return { ...cached, warnings: [...new Set([...cached.warnings,...clampWarnings])] };
    } catch { /* Absent, partial, or obsolete public cache is fetched again. */ }
  }
  const arrays = new Map<OkxInterval, Candle[]>();
  // Sequential frames avoid multiplying the per-IP historical candle limit across pages.
  for (const interval of required) {
    const start = align(from, interval) - warmup[interval] * durations[interval];
    const last = align(end, interval) - durations[interval];
    let candles: Candle[];
    // Pages are 100 candles; size the budget from the requested span so long windows are not silently short.
    const maxPages = Math.min(600, Math.ceil((last - start) / durations[interval] / 100) + 5);
    try { candles = await getHistoricalCandles(client, id, interval, { from: start, to: last, maxPages }); }
    catch { throw new Error(`okx_research_ohlc_fetch_${interval}`); }
    requireCandleCoverage(candles, start, last, interval);
    arrays.set(interval, candles);
  }
  // A frame that was not requested is empty rather than absent, so callers keep a stable shape.
  const result: ResearchData = { frames: { '15m': arrays.get('15m') ?? [], '1H': arrays.get('1H') ?? [], '4H': arrays.get('4H') ?? [], bias: { daily: arrays.get('1Dutc') ?? [], weekly: arrays.get('1Wutc') ?? [] } }, funding: [], fundingComplete: false, warnings: [...clampWarnings] };
  if (required.length < bars.length) result.warnings.push(`partial_frames_${required.join('_')}`);
  try {
    const history = await fundingHistory(client, id, from, end);
    result.warnings.push(...history.warnings);
    result.fundingComplete = history.complete && history.rates.length === 0;
    if (history.rates.length) {
      const mapped = mapFundingMarks(history.rates, await markHistory(client, id, history.rates[0].time, end));
      result.funding = mapped.funding;
      result.fundingComplete = history.complete && mapped.complete;
      result.warnings.push('funding_mark_approximated_by_15m_mark_candle_open');
      if (!mapped.complete) result.warnings.push('funding_mark_history_incomplete');
    }
  } catch { result.warnings.push('funding_history_or_marks_unavailable'); }
  if (!result.fundingComplete && !result.warnings.includes('funding_history_incomplete')) result.warnings.push('funding_history_incomplete');
  if (options.cache !== false) {
    const temp = join(cacheDir, `${key}.${randomUUID()}.tmp`);
    try {
      await mkdir(cacheDir, { recursive: true });
      await writeFile(temp, JSON.stringify(result), { encoding: 'utf8', flag: 'wx' });
      await rename(temp, path);
    } catch { result.warnings.push('public_market_cache_write_unavailable'); }
    finally { await unlink(temp).catch(() => undefined); }
  }
  return result;
}
/** Paper accrual interval [from,to), capped at 3 days. An empty, proven history window
 * differs from an unavailable response. Missing costs keep complete=false for entry gates.
 */
export async function getPaperFunding(client: OkxClient, id: string, from: number, to: number): Promise<{ funding: Funding[]; complete: boolean; warnings: string[] }> {
  validateInstrumentId(id);
  if (![from,to].every(Number.isSafeInteger) || from <= 0 || to <= from || to - from > 3 * 86400000) throw new Error('okx_paper_funding_invalid_range');
  try {
    const end = Math.min(to, await latestClosedTime(client));
    if (end <= from) return { funding: [], complete: false, warnings: ['funding_range_after_exchange_time'] };
    const history = await fundingHistory(client, id, from, end);
    const warnings = [...history.warnings];
    const fullEnd = end === to;
    if (!fullEnd) warnings.push('funding_end_clamped_to_okx_server_time');
    if (!history.rates.length) return { funding: [], complete: history.complete && fullEnd, warnings };
    const mapped = mapFundingMarks(history.rates, await markHistory(client, id, history.rates[0].time, end));
    warnings.push('funding_mark_approximated_by_15m_mark_candle_open');
    if (!mapped.complete) warnings.push('funding_mark_history_incomplete');
    return { funding: mapped.funding, complete: history.complete && mapped.complete && fullEnd, warnings };
  } catch { return { funding: [], complete: false, warnings: ['funding_history_or_marks_unavailable'] }; }
}
/** Five closed public timeframes for the scan worker; no strategy evaluation or trading. */
export async function getLiveFrames(client: OkxClient, id: string): Promise<Frames> {
  validateInstrumentId(id);
  const end = await latestClosedTime(client);
  // Daily carries the 4H trend bias, whose slow EMA is 200 periods; fetching 80 starved it live.
  const values = await Promise.all(bars.map(async (interval) => (await getCandles(client, id, interval, interval === '1Dutc' ? 300 : interval === '1Wutc' ? 60 : 300)).filter((candle) => candle.time + durations[interval] <= end)));
  return { '15m': values[0], '1H': values[1], '4H': values[2], bias: { daily: values[3], weekly: values[4] } };
}
