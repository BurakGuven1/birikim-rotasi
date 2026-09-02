import type { MarketSnapshot, PricePoint } from "../domain/types";
import { alphaVantageProvider } from "./alpha-vantage";
import { binanceProvider } from "./binance";
import { eodhdProvider } from "./eodhd";
import type { MarketDataProvider } from "./provider";
import { stooqProvider } from "./stooq";
import { yahooProvider } from "./yahoo";

const quoteCache = new Map<string, MarketSnapshot>();
const providers = [binanceProvider, eodhdProvider, alphaVantageProvider, yahooProvider, stooqProvider];

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
  const requestedMonths = range === "max" ? 120 : (Number.parseInt(range, 10) || 5) * 12;
  for (const provider of providers) {
    if (!provider.supports(symbol)) continue;
    try {
      const points = await provider.getHistory(symbol, range);
      const coveredMonths = new Set(points.map((point) => point.date.slice(0, 7))).size;
      if (coveredMonths >= requestedMonths) return { points, source: provider.id };
      if (points.length > 0) errors.push(`${provider.id}: ${requestedMonths} ay istendi, yalnızca ${coveredMonths} ay geldi`);
    } catch (error) {
      errors.push(`${provider.id}: ${error instanceof Error ? error.message : "hata"}`);
    }
  }
  throw new Error(errors.join(" | ") || `${symbol} için geçmiş veri yok.`);
}

export function getProviderStatus() {
  return [
    { name: "Binance Public", active: true, keyRequired: false, coverage: "BTC anlık fiyat ve geçmiş" },
    { name: "EODHD", active: Boolean(process.env.EODHD_API_KEY), keyRequired: true, coverage: "Hisse, ETF, BIST, emtia, döviz ve kripto yedeği" },
    { name: "Alpha Vantage", active: Boolean(process.env.ALPHA_VANTAGE_API_KEY), keyRequired: true, coverage: "ABD hisse ve ETF fiyat yedeği" },
    { name: "FRED", active: Boolean(process.env.FRED_API_KEY), keyRequired: true, coverage: "M2, CPI ve 10 yıllık reel faiz" },
    { name: "Yahoo-compatible", active: true, keyRequired: false, coverage: "Anahtarlı servisler başarısızsa fiyat yedeği" },
    { name: "Stooq", active: true, keyRequired: false, coverage: "Gün sonu geçmiş fiyat yedeği" },
  ];
}
