import type { PricePoint } from "../domain/types";
import type { MarketDataProvider } from "./provider";
import { freshnessStatus } from "./provider";

const baseUrl = "https://www.alphavantage.co/query";
const symbolMap: Record<string, string> = { SP500: "SPY", NASDAQ: "QQQ", WORLD: "VT" };

function key() {
  const value = process.env.ALPHA_VANTAGE_API_KEY;
  if (!value) throw new Error("ALPHA_VANTAGE_API_KEY yapılandırılmadı.");
  return value;
}

function supportsSymbol(symbol: string) {
  const normalized = symbol.toUpperCase();
  return Boolean(process.env.ALPHA_VANTAGE_API_KEY)
    && !["BTC", "GOLD", "SILVER", "BIST100", "USDTRY"].includes(normalized)
    && !normalized.endsWith(".IS");
}

function apiSymbol(symbol: string) {
  const normalized = symbol.toUpperCase();
  return symbolMap[normalized] ?? normalized;
}

function apiError(payload: Record<string, unknown>) {
  const message = payload.Note ?? payload.Information ?? payload["Error Message"];
  if (typeof message === "string") throw new Error(`Alpha Vantage: ${message}`);
}

export const alphaVantageProvider: MarketDataProvider = {
  id: "Alpha Vantage",
  supports: supportsSymbol,
  async getQuote(symbol) {
    const response = await fetch(`${baseUrl}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(apiSymbol(symbol))}&apikey=${encodeURIComponent(key())}`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Alpha Vantage ${response.status}`);
    const payload = await response.json() as Record<string, unknown>;
    apiError(payload);
    const quote = payload["Global Quote"] as Record<string, string> | undefined;
    const price = Number(quote?.["05. price"]);
    if (!Number.isFinite(price) || price <= 0) throw new Error("Alpha Vantage geçerli fiyat döndürmedi.");
    const latestDay = quote?.["07. latest trading day"];
    const asOf = latestDay ? `${latestDay}T21:00:00Z` : new Date().toISOString();
    const rawChange = quote?.["10. change percent"]?.replace("%", "");
    return { price, currency: "USD", asOf, source: "Alpha Vantage", status: freshnessStatus(asOf), changePercent: rawChange ? Number(rawChange) : undefined };
  },
  async getHistory(symbol) {
    const response = await fetch(`${baseUrl}?function=TIME_SERIES_WEEKLY&symbol=${encodeURIComponent(apiSymbol(symbol))}&apikey=${encodeURIComponent(key())}`, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`Alpha Vantage ${response.status}`);
    const payload = await response.json() as Record<string, unknown>;
    apiError(payload);
    const series = payload["Weekly Time Series"] as Record<string, Record<string, string>> | undefined;
    if (!series) throw new Error("Alpha Vantage geçmiş veri döndürmedi.");
    return Object.entries(series).map(([date, row]): PricePoint => ({
      date: `${date}T00:00:00Z`,
      open: Number(row["1. open"]),
      high: Number(row["2. high"]),
      low: Number(row["3. low"]),
      close: Number(row["4. close"]),
      volume: Number(row["5. volume"]),
    })).filter((point) => Number.isFinite(point.close) && point.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  },
};
