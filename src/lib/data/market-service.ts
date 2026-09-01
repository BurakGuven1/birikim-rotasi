import type { MarketSnapshot, PricePoint } from "../domain/types";
import { binanceProvider } from "./binance";
import { coinGeckoProvider } from "./coingecko";
import type { MarketDataProvider } from "./provider";
import { stooqProvider } from "./stooq";
import { tcmbProvider } from "./tcmb";
import { yahooProvider } from "./yahoo";

const quoteCache = new Map<string, MarketSnapshot>();
const providers = [binanceProvider, coinGeckoProvider, tcmbProvider, yahooProvider, stooqProvider];

export async function resolveQuote(symbol: string, candidates: MarketDataProvider[], cached?: MarketSnapshot): Promise<MarketSnapshot> {
  const errors: string[] = [];
  for (const provider of candidates) {
    if (!provider.supports(symbol)) continue;
    try {
      const result = await provider.getQuote(symbol);
      if (!Number.isFinite(result.price) || result.price <= 0) throw new Error("Geçersiz fiyat");
      return result;
    } catch (error) {
      errors.push(`${provider.id}: ${error instanceof Error ? error.message : "hata"}`);
    }
  }
  if (cached) return { ...cached, source: `${cached.source} · yerel önbellek`, status: "stale" };
  throw new Error(errors.join(" | ") || `${symbol} için veri sağlayıcısı yok.`);
}

export async function getQuote(symbol: string): Promise<MarketSnapshot> {
  const normalized = symbol.trim().toUpperCase();
  const snapshot = await resolveQuote(normalized, providers, quoteCache.get(normalized));
  if (snapshot.status !== "stale") quoteCache.set(normalized, snapshot);
  return snapshot;
}

export async function getHistory(symbol: string, range = "5y"): Promise<{ points: PricePoint[]; source: string }> {
  const errors: string[] = [];
  for (const provider of providers) {
    if (!provider.supports(symbol)) continue;
    try {
      const points = await provider.getHistory(symbol, range);
      if (points.length > 0) return { points, source: provider.id };
    } catch (error) {
      errors.push(`${provider.id}: ${error instanceof Error ? error.message : "hata"}`);
    }
  }
  throw new Error(errors.join(" | ") || `${symbol} için geçmiş veri yok.`);
}

export function getProviderStatus() {
  return [
    { name: "Binance Public", active: true, keyRequired: false, coverage: "BTC anlık fiyat ve geçmiş" },
    { name: "CoinGecko", active: true, keyRequired: false, enhanced: Boolean(process.env.COINGECKO_DEMO_API_KEY), coverage: "BTC yedek fiyat/geçmiş" },
    { name: "Yahoo-compatible", active: true, keyRequired: false, coverage: "Hisse, ETF, BIST, emtia ve kur" },
    { name: "TCMB", active: true, keyRequired: false, enhanced: Boolean(process.env.TCMB_EVDS_API_KEY), coverage: "USD/TRY ve EVDS makro" },
    { name: "FRED", active: true, keyRequired: false, enhanced: Boolean(process.env.FRED_API_KEY), coverage: "Makro CSV; anahtarla API" },
    { name: "Alpha Vantage", active: Boolean(process.env.ALPHA_VANTAGE_API_KEY), keyRequired: true, coverage: "İsteğe bağlı temel oranlar" },
  ];
}
