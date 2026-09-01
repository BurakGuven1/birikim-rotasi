import type { MarketDataProvider } from "./provider";
import { freshnessStatus } from "./provider";

const baseUrl = "https://data-api.binance.vision";

export const binanceProvider: MarketDataProvider = {
  id: "Binance Public",
  supports: (symbol) => symbol.toUpperCase() === "BTC",
  async getQuote() {
    const response = await fetch(`${baseUrl}/api/v3/ticker/24hr?symbol=BTCUSDT`, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`Binance ${response.status}`);
    const data = await response.json() as { lastPrice: string; priceChangePercent: string; closeTime: number };
    const asOf = new Date(data.closeTime).toISOString();
    return { price: Number(data.lastPrice), currency: "USD", asOf, source: "Binance Public", status: freshnessStatus(asOf, "crypto"), changePercent: Number(data.priceChangePercent) };
  },
  async getHistory(_symbol, range = "5y") {
    const limits: Record<string, number> = { "1y": 365, "3y": 1095, "5y": 1825, "10y": 3650 };
    const limit = Math.min(1000, limits[range] ?? 1000);
    const response = await fetch(`${baseUrl}/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=${limit}`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Binance ${response.status}`);
    const rows = await response.json() as Array<[number, string, string, string, string, string]>;
    return rows.map((row) => ({ date: new Date(row[0]).toISOString(), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) }));
  },
};
