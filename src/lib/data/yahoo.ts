import type { Currency, PricePoint } from "../domain/types";
import type { MarketDataProvider } from "./provider";
import { freshnessStatus } from "./provider";

const symbolMap: Record<string, string> = { BTC: "BTC-USD", GOLD: "GC=F", SILVER: "SI=F", BIST100: "XU100.IS", USDTRY: "TRY=X", SP500: "^GSPC", NASDAQ: "^IXIC", WORLD: "VT" };
const yahooSymbol = (symbol: string) => symbolMap[symbol.toUpperCase()] ?? symbol;

interface YahooResult { meta: { regularMarketPrice: number; chartPreviousClose?: number; currency?: string; regularMarketTime?: number }; timestamp?: number[]; indicators: { quote: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close: Array<number | null>; volume?: Array<number | null> }> } }
type YahooChart = { chart: { result: YahooResult[] | null; error: unknown } };

async function getChart(symbol: string, range: string, interval: string): Promise<YahooResult> {
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(symbol))}?range=${range}&interval=${interval}&events=div%2Csplits`, { headers: { "User-Agent": "Mozilla/5.0 Birikim-Rotasi/1.0" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Yahoo ${response.status}`);
  const payload = await response.json() as YahooChart;
  const result = payload.chart.result?.[0];
  if (!result) throw new Error("Yahoo boş veri döndürdü.");
  return result;
}

export const yahooProvider: MarketDataProvider = {
  id: "Yahoo Finance (anahtarsız)",
  supports: () => true,
  async getQuote(symbol) {
    const result = await getChart(symbol, "5d", "1d");
    const meta = result.meta;
    const asOf = new Date((meta.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString();
    const previous = meta.chartPreviousClose ?? meta.regularMarketPrice;
    const currency = (["TRY", "USD", "EUR"].includes(meta.currency ?? "") ? meta.currency : "USD") as Currency;
    return { price: meta.regularMarketPrice, currency, asOf, source: "Yahoo Finance (anahtarsız)", status: freshnessStatus(asOf), changePercent: previous ? (meta.regularMarketPrice / previous - 1) * 100 : 0 };
  },
  async getHistory(symbol, range = "5y") {
    const result = await getChart(symbol, range, range === "10y" || range === "max" ? "1wk" : "1d");
    const quote = result.indicators.quote[0];
    return (result.timestamp ?? []).flatMap((timestamp, index): PricePoint[] => {
      const close = quote.close[index];
      if (close == null) return [];
      return [{
        date: new Date(timestamp * 1000).toISOString(),
        close,
        open: quote.open?.[index] ?? undefined,
        high: quote.high?.[index] ?? undefined,
        low: quote.low?.[index] ?? undefined,
        volume: quote.volume?.[index] ?? undefined,
      }];
    });
  },
};
