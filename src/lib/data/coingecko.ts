import type { MarketDataProvider } from "./provider";
import { freshnessStatus } from "./provider";

const baseUrl = "https://api.coingecko.com/api/v3";
const headers = () => process.env.COINGECKO_DEMO_API_KEY ? { "x-cg-demo-api-key": process.env.COINGECKO_DEMO_API_KEY } : undefined;

export const coinGeckoProvider: MarketDataProvider = {
  id: "CoinGecko",
  supports: (symbol) => symbol.toUpperCase() === "BTC",
  async getQuote() {
    const response = await fetch(`${baseUrl}/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`, { headers: headers(), signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`CoinGecko ${response.status}`);
    const data = await response.json() as { bitcoin: { usd: number; usd_24h_change: number; last_updated_at: number } };
    const asOf = new Date(data.bitcoin.last_updated_at * 1000).toISOString();
    return { price: data.bitcoin.usd, currency: "USD", asOf, source: "CoinGecko", status: freshnessStatus(asOf, "crypto"), changePercent: data.bitcoin.usd_24h_change };
  },
  async getHistory(_symbol, range = "5y") {
    const days: Record<string, number> = { "1y": 365, "3y": 1095, "5y": 1825, "10y": 3650 };
    const response = await fetch(`${baseUrl}/coins/bitcoin/market_chart?vs_currency=usd&days=${days[range] ?? 1825}&interval=daily`, { headers: headers(), signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`CoinGecko ${response.status}`);
    const data = await response.json() as { prices: Array<[number, number]> };
    return data.prices.map(([time, close]) => ({ date: new Date(time).toISOString(), close }));
  },
};
