import type { MarketSnapshot, PricePoint } from "../domain/types";

export interface MarketDataProvider {
  id: string;
  historyCapabilities?: ReadonlyArray<{ interval: HistoryInterval; market: HistoryMarket }>;
  supports(symbol: string): boolean;
  getQuote(symbol: string): Promise<MarketSnapshot>;
  getHistory(symbol: string, range?: string, options?: HistoryOptions): Promise<PricePoint[]>;
}

export type HistoryInterval = "1d" | "4h";
export type HistoryMarket = "spot" | "futures";
export type HistoryDate = string | number | Date;
export interface HistoryOptions { interval?: HistoryInterval; market?: HistoryMarket; from?: HistoryDate; to?: HistoryDate; allowPartial?: boolean; includeWarmup?: boolean }

export function freshnessStatus(asOf: string, market: "crypto" | "market" | "macro" = "market") {
  const ageMinutes = (Date.now() - new Date(asOf).getTime()) / 60_000;
  const freshLimit = market === "crypto" ? 15 : market === "market" ? 24 * 60 : 45 * 24 * 60;
  const staleLimit = freshLimit * 3;
  return ageMinutes <= freshLimit ? "fresh" as const : ageMinutes <= staleLimit ? "delayed" as const : "stale" as const;
}
