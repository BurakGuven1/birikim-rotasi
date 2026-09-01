import type { MarketDataProvider } from "./provider";

const symbols: Record<string, string> = { VOO: "spy.us", SP500: "^spx", NASDAQ: "^ndq", GOLD: "xauusd", SILVER: "xagusd" };

export const stooqProvider: MarketDataProvider = {
  id: "Stooq",
  supports: (symbol) => Boolean(symbols[symbol.toUpperCase()]),
  async getQuote(symbol) {
    const history = await this.getHistory(symbol, "1y");
    const last = history.at(-1);
    if (!last) throw new Error("Stooq boş veri döndürdü.");
    return { price: last.close, currency: "USD", asOf: last.date, source: "Stooq (gün sonu)", status: "delayed" };
  },
  async getHistory(symbol) {
    const response = await fetch(`https://stooq.com/q/d/l/?s=${symbols[symbol.toUpperCase()]}&i=d`, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`Stooq ${response.status}`);
    const text = await response.text();
    return text.trim().split(/\r?\n/).slice(1).flatMap((line) => {
      const [date, open, high, low, close, volume] = line.split(",");
      return Number.isFinite(Number(close)) ? [{ date: `${date}T00:00:00Z`, open: Number(open), high: Number(high), low: Number(low), close: Number(close), volume: Number(volume) }] : [];
    });
  },
};
