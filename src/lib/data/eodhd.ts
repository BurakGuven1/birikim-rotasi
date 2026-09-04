import type { Currency, PricePoint } from "../domain/types";
import type { MarketDataProvider } from "./provider";
import { freshnessStatus } from "./provider";

const baseUrl = "https://eodhd.com/api";
const symbolMap: Record<string, string> = {
  BTC: "BTC-USD.CC",
  GOLD: "XAUUSD.FOREX",
  SILVER: "XAGUSD.FOREX",
  VT: "VT.US",
  VOO: "VOO.US",
  QQQM: "QQQM.US",
  QUAL: "QUAL.US",
  SGOV: "SGOV.US",
  SP500: "GSPC.INDX",
  NASDAQ: "IXIC.INDX",
  BIST100: "XU100.INDX",
  USDTRY: "USDTRY.FOREX",
};

function apiSymbol(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  if (symbolMap[normalized]) return symbolMap[normalized];
  return normalized.includes(".") ? normalized : `${normalized}.US`;
}

function currencyFor(symbol: string): Currency {
  const normalized = symbol.toUpperCase();
  return normalized === "USDTRY" || normalized.endsWith(".IS") ? "TRY" : "USD";
}

function token() {
  const value = process.env.EODHD_API_KEY;
  if (!value) throw new Error("EODHD_API_KEY yapılandırılmadı.");
  return value;
}

function fromDate(range: string) {
  const years = range === "max" ? 20 : Number.parseInt(range, 10) || 5;
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
}

export const eodhdProvider: MarketDataProvider = {
  id: "EODHD",
  supports: () => Boolean(process.env.EODHD_API_KEY),
  async getQuote(symbol) {
    const response = await fetch(`${baseUrl}/real-time/${encodeURIComponent(apiSymbol(symbol))}?api_token=${encodeURIComponent(token())}&fmt=json`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`EODHD ${response.status}`);
    const data = await response.json() as { timestamp?: number; close?: number; previousClose?: number; change_p?: number };
    const price = Number(data.close);
    if (!Number.isFinite(price) || price <= 0) throw new Error("EODHD geçerli fiyat döndürmedi.");
    const asOf = new Date((data.timestamp ?? Date.now() / 1000) * 1000).toISOString();
    const previous = Number(data.previousClose);
    const changePercent = Number.isFinite(Number(data.change_p))
      ? Number(data.change_p)
      : Number.isFinite(previous) && previous > 0 ? (price / previous - 1) * 100 : undefined;
    return { price, currency: currencyFor(symbol), asOf, source: "EODHD", status: freshnessStatus(asOf, symbol.toUpperCase() === "BTC" ? "crypto" : "market"), changePercent };
  },
  async getHistory(symbol, range = "5y") {
    const response = await fetch(`${baseUrl}/eod/${encodeURIComponent(apiSymbol(symbol))}?api_token=${encodeURIComponent(token())}&fmt=json&order=a&period=d&from=${fromDate(range)}`, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`EODHD ${response.status}`);
    const rows = await response.json() as Array<{ date: string; open?: number; high?: number; low?: number; close: number; volume?: number }>;
    if (!Array.isArray(rows)) throw new Error("EODHD geçmiş veri biçimi geçersiz.");
    return rows.flatMap((row): PricePoint[] => Number.isFinite(Number(row.close)) && Number(row.close) > 0 ? [{
      date: `${row.date}T00:00:00Z`,
      open: Number.isFinite(Number(row.open)) ? Number(row.open) : undefined,
      high: Number.isFinite(Number(row.high)) ? Number(row.high) : undefined,
      low: Number.isFinite(Number(row.low)) ? Number(row.low) : undefined,
      close: Number(row.close),
      volume: Number.isFinite(Number(row.volume)) ? Number(row.volume) : undefined,
    }] : []);
  },
};
