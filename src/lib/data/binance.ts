import type { HistoryOptions, MarketDataProvider } from "./provider";
import { freshnessStatus } from "./provider";

const spotUrl = "https://data-api.binance.vision";
const futuresUrl = "https://fapi.binance.com";
const pair = (symbol: string) => `${symbol.trim().toUpperCase()}USDT`;
const supported = (symbol: string) => ["BTC", "ETH"].includes(symbol.trim().toUpperCase());
function timestamp(value: HistoryOptions["from"], fallback: number) { if (value === undefined) return fallback; const result = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value); if (!Number.isFinite(result)) throw new Error("Geçersiz tarih."); return result; }
const rangeMs = (range: string) => (range === "max" ? 10 : Number.parseInt(range, 10) || 5) * 365.25 * 86_400_000;
async function json<T>(url: string): Promise<T> { const response = await fetch(url, { signal: AbortSignal.timeout(10_000) }); if (!response.ok) throw new Error(`Binance ${response.status}`); return response.json() as Promise<T>; }

export const binanceProvider: MarketDataProvider = {
  id: "Binance Public", historyCapabilities: [{ interval: "1d", market: "spot" }, { interval: "4h", market: "spot" }, { interval: "1d", market: "futures" }, { interval: "4h", market: "futures" }], supports: supported,
  async getQuote(symbol) { const data = await json<{ lastPrice: string; priceChangePercent: string; closeTime: number }>(`${spotUrl}/api/v3/ticker/24hr?symbol=${pair(symbol)}`); const asOf = new Date(data.closeTime).toISOString(); return { price: Number(data.lastPrice), currency: "USD", asOf, source: "Binance Public (USDT≈USD)", status: freshnessStatus(asOf, "crypto"), changePercent: Number(data.priceChangePercent) }; },
  async getHistory(symbol, range = "5y", options = {}) {
    if (!supported(symbol)) throw new Error("Binance sembolü desteklenmiyor.");
    const interval = options.interval ?? "1d"; const market = options.market ?? "spot"; const end = timestamp(options.to, Date.now()); let cursor = timestamp(options.from, end - rangeMs(range));
    const path = market === "futures" ? "/fapi/v1/klines" : "/api/v3/klines"; const base = market === "futures" ? futuresUrl : spotUrl; const points: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }> = [];
    for (let page = 0; cursor <= end && page < 100; page++) {
      const rows = await json<Array<[number, string, string, string, string, string, number]>>(`${base}${path}?symbol=${pair(symbol)}&interval=${interval}&startTime=${Math.floor(cursor)}&endTime=${Math.floor(end)}&limit=1000`);
      if (!rows.length) break;
      for (const row of rows) if (row[6] <= Math.min(end, Date.now())) points.push({ date: new Date(row[0]).toISOString(), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) });
      const next = rows.at(-1)![6] + 1; if (next <= cursor || rows.length < 1000) break; cursor = next;
    }
    return points;
  },
};

export interface FundingPoint { time: string; rate: number; markPrice?: number }
export async function getFundingHistory(symbol: string, from?: HistoryOptions["from"], to?: HistoryOptions["to"]): Promise<FundingPoint[]> {
  if (!supported(symbol)) throw new Error("Binance sembolü desteklenmiyor.");
  const end = timestamp(to, Date.now()); let cursor = timestamp(from, end - 30 * 86_400_000); const result: FundingPoint[] = [];
  for (let page = 0; cursor <= end && page < 100; page++) {
    const rows = await json<Array<{ fundingTime: number; fundingRate: string; markPrice?: string }>>(`${futuresUrl}/fapi/v1/fundingRate?symbol=${pair(symbol)}&startTime=${Math.floor(cursor)}&endTime=${Math.floor(end)}&limit=1000`); if (!rows.length) break;
    for (const row of rows) if (!result.length || result.at(-1)!.time !== new Date(row.fundingTime).toISOString()) result.push({ time: new Date(row.fundingTime).toISOString(), rate: Number(row.fundingRate), markPrice: row.markPrice === undefined ? undefined : Number(row.markPrice) });
    const next = rows.at(-1)!.fundingTime + 1; if (next <= cursor || rows.length < 1000) break; cursor = next;
  }
  return result;
}

export interface BinanceContext { symbol: string; quoteCurrency: "USDT"; markPrice: number; fundingRate: number; nextFundingTime: string; book: { bid: number; ask: number; bidSize: number; askSize: number; spread: number }; flow: { buyVolume: number; sellVolume: number; buyRatio: number; trades: number }; asOf: string; source: string }
export async function getBinanceContext(symbol: string): Promise<BinanceContext> {
  if (!supported(symbol)) throw new Error("Binance sembolü desteklenmiyor."); const name = pair(symbol);
  const [premium, book, trades] = await Promise.all([json<{ markPrice: string; lastFundingRate: string; nextFundingTime: number; time: number }>(`${futuresUrl}/fapi/v1/premiumIndex?symbol=${name}`), json<{ bidPrice: string; bidQty: string; askPrice: string; askQty: string }>(`${futuresUrl}/fapi/v1/ticker/bookTicker?symbol=${name}`), json<Array<{ price: string; qty: string; isBuyerMaker: boolean }>>(`${futuresUrl}/fapi/v1/trades?symbol=${name}&limit=1000`)]);
  let buyVolume = 0; let sellVolume = 0; for (const trade of trades) { const value = Number(trade.qty) * Number(trade.price); if (trade.isBuyerMaker) sellVolume += value; else buyVolume += value; }
  const total = buyVolume + sellVolume; const bid = Number(book.bidPrice); const ask = Number(book.askPrice);
  return { symbol: symbol.trim().toUpperCase(), quoteCurrency: "USDT", markPrice: Number(premium.markPrice), fundingRate: Number(premium.lastFundingRate), nextFundingTime: new Date(premium.nextFundingTime).toISOString(), book: { bid, ask, bidSize: Number(book.bidQty), askSize: Number(book.askQty), spread: ask - bid }, flow: { buyVolume, sellVolume, buyRatio: total ? buyVolume / total : .5, trades: trades.length }, asOf: new Date(premium.time).toISOString(), source: "Binance Futures Public" };
}
