import { z } from "zod";
import type { StockMarket, StockSnapshot } from "../domain/stock-watchlist";

const nullableNumber = z.number().finite().nullable();
const snapshotSchema = z.object({
  market: z.enum(["US", "TR"]), fetchedAt: z.string().datetime(), source: z.string(), cached: z.boolean().optional(), fundamentalsWarning: z.string().optional(),
  rows: z.array(z.object({
    symbol: z.string(), ticker: z.string(), name: z.string(), market: z.enum(["US", "TR"]), sector: z.string(), scannerSymbol: z.string(), currency: z.enum(["USD", "TRY"]),
    price: nullableNumber, change: nullableNumber, pe: nullableNumber, pb: nullableNumber, evEbitda: nullableNumber, sma200Weekly: nullableNumber, smaDistance: nullableNumber, marketCap: nullableNumber,
    priceAsOf: z.string().datetime().nullable(), delayMinutes: nullableNumber,
    priceUpdatedAt: z.string().datetime().nullable().optional(),
    fundamentals: z.object({
      industry: z.string(), roe: nullableNumber, roa: nullableNumber, roic: nullableNumber,
      debt: nullableNumber, ebitda: nullableNumber, priceFcf: nullableNumber,
      operatingCashflow: nullableNumber, netIncome: nullableNumber, epsGrowth: nullableNumber, revenueGrowth: nullableNumber,
      perf1m: nullableNumber, perf6m: nullableNumber, perf12m: nullableNumber,
      reportedAt: z.string().datetime().nullable(), fScore: nullableNumber,
    }).optional(),
  })).max(100),
});
const key = "birikim-stock-watchlist-v1";
function readCache(cacheKey: string): Partial<Record<StockMarket, StockSnapshot>> {
  const raw = localStorage.getItem(cacheKey);
  if (!raw) return {};
  const parsed = z.object({ US: snapshotSchema.optional(), TR: snapshotSchema.optional() }).safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error("Kayıtlı takip verisi okunamadı. Güncelle ile yeniden yükleyebilirsin.");
  return parsed.data;
}
export function readWatchlistCache() { return readCache(key); }
export function readPreviousWatchlistCache() { return readCache(`${key}-previous`); }
export function savePreviousWatchlistCache(value: Partial<Record<StockMarket, StockSnapshot>>) { localStorage.setItem(`${key}-previous`, JSON.stringify(value)); }
export function saveWatchlistCache(value: Partial<Record<StockMarket, StockSnapshot>>) { localStorage.setItem(key, JSON.stringify(value)); }
