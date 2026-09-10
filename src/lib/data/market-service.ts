import type { MarketSnapshot, PricePoint } from "../domain/types";
import { alphaVantageProvider } from "./alpha-vantage";
import { binanceProvider } from "./binance";
import { eodhdProvider } from "./eodhd";
import { massiveProvider } from "./massive";
import type { HistoryOptions, MarketDataProvider } from "./provider";
import { stooqProvider } from "./stooq";
import { yahooProvider } from "./yahoo";

const quoteCache = new Map<string, MarketSnapshot>();
const providers = [binanceProvider, massiveProvider, eodhdProvider, alphaVantageProvider, yahooProvider, stooqProvider];

export async function resolveQuote(symbol: string, candidates: MarketDataProvider[], cached?: MarketSnapshot): Promise<MarketSnapshot> {
  const errors: string[] = [];
  for (const provider of candidates) {
    if (!provider.supports(symbol)) continue;
    try { const result = await provider.getQuote(symbol); if (!Number.isFinite(result.price) || result.price <= 0) throw new Error("Geçersiz fiyat"); return result; }
    catch (error) { errors.push(`${provider.id}: ${error instanceof Error ? error.message : "hata"}`); }
  }
  if (cached) return { ...cached, source: `${cached.source} · yerel önbellek`, status: "stale" };
  throw new Error(errors.join(" | ") || `${symbol} için veri sağlayıcısı yok.`);
}

export async function getQuote(symbol: string): Promise<MarketSnapshot> {
  const normalized = symbol.trim().toUpperCase(); const snapshot = await resolveQuote(normalized, providers, quoteCache.get(normalized));
  if (snapshot.status !== "stale") quoteCache.set(normalized, snapshot); return snapshot;
}

export interface HistoryCoverage { requestedFrom: string; requestedTo: string; actualFrom?: string; actualTo?: string; requestedMonths: number; coveredMonths: number; observations: number; interval: "1d" | "4h"; market: "spot" | "futures"; cadenceComplete: boolean; complete: boolean; partial: boolean }
export interface HistoryResult { points: PricePoint[]; source: string; coverage: HistoryCoverage }
function requestedWindow(range: string, options: HistoryOptions) {
  const to = options.to === undefined ? new Date() : options.to instanceof Date ? options.to : new Date(options.to);
  const from = options.from === undefined ? new Date(to) : options.from instanceof Date ? options.from : new Date(options.from);
  const rangeMonths = range === "max" ? 120 : (Number.parseInt(range, 10) || 5) * 12;
  if (options.from === undefined) from.setUTCMonth(from.getUTCMonth() - rangeMonths);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) throw new Error("Geçersiz geçmiş veri tarih aralığı.");
  const requestedMonths = options.from === undefined ? rangeMonths : Math.max(1, (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth() + 1);
  return { from, to, requestedMonths };
}
function resultFor(points: PricePoint[], source: string, requested: ReturnType<typeof requestedWindow>, options: HistoryOptions): HistoryResult {
  const upper = Math.min(requested.to.getTime(), Date.now());
  const sorted = [...points].filter(point => { const time = Date.parse(point.date); return Number.isFinite(time) && time <= upper && (options.includeWarmup || time >= requested.from.getTime()); }).sort((a, b) => a.date.localeCompare(b.date));
  const coveredMonths = new Set(sorted.map(point => point.date.slice(0, 7))).size; const interval = options.interval ?? "1d"; const market = options.market ?? "spot";
   const step = interval === "4h" ? 4 * 3_600_000 : 86_400_000; const edgeTolerance = interval === "4h" && market === "futures" ? 8 * 3_600_000 : 7 * 86_400_000; const gapTolerance = interval === "4h" && market === "futures" ? 12 * 3_600_000 : 8 * 86_400_000;
  const startsOnTime = Boolean(sorted[0]) && Date.parse(sorted[0].date) - requested.from.getTime() <= edgeTolerance; const endsOnTime = Boolean(sorted.at(-1)) && upper - Date.parse(sorted.at(-1)!.date) <= edgeTolerance;
  const gapsValid = sorted.every((point, index) => index === 0 || Date.parse(point.date) - Date.parse(sorted[index - 1].date) <= gapTolerance); const expected = Math.max(1, Math.floor((upper - requested.from.getTime()) / step)); const densityValid = sorted.length >= expected * (interval === "4h" ? market === "futures" ? .8 : .15 : market === "futures" ? .8 : .5);
  const cadenceComplete = startsOnTime && endsOnTime && gapsValid && densityValid; const complete = coveredMonths >= requested.requestedMonths && cadenceComplete;
  return { points: sorted, source, coverage: { requestedFrom: requested.from.toISOString(), requestedTo: requested.to.toISOString(), actualFrom: sorted[0]?.date, actualTo: sorted.at(-1)?.date, requestedMonths: requested.requestedMonths, coveredMonths, observations: sorted.length, interval, market, cadenceComplete, complete, partial: sorted.length > 0 && !complete } };
}
export async function getHistory(symbol: string, range = "5y", options: HistoryOptions = {}): Promise<HistoryResult> {
  const errors: string[] = []; const requested = requestedWindow(range, options); let best: HistoryResult | undefined;
  for (const provider of symbol.endsWith(".IS") ? [yahooProvider, eodhdProvider] : providers) {
    if (!provider.supports(symbol)) continue;
    const interval = options.interval ?? "1d"; const market = options.market ?? "spot";
    if ((options.interval !== undefined || options.market !== undefined) && !(provider.historyCapabilities ?? [{ interval: "1d", market: "spot" }]).some(capability => capability.interval === interval && capability.market === market)) continue;
    try {
      const value = resultFor(await provider.getHistory(symbol, range, options), provider.id, requested, options);
      if (value.coverage.complete) return value;
      if (value.points.length && (!best || value.points.length > best.points.length)) best = value;
      if (value.points.length) errors.push(`${provider.id}: ${requested.requestedMonths} ay istendi, yalnızca ${value.coverage.coveredMonths} ay geldi`);
    } catch (error) { errors.push(`${provider.id}: ${error instanceof Error ? error.message : "hata"}`); }
  }
  if (options.allowPartial && best) return best;
  throw new Error(errors.join(" | ") || `${symbol} için geçmiş veri yok.`);
}

export function getProviderStatus() {
  return [
    { name: "Binance Public", active: true, keyRequired: false, coverage: "BTC ve ETH spot/futures fiyat, geçmiş ve piyasa yapısı" },
    { name: "Massive", active: Boolean(process.env.MASSIVE_API_KEY), keyRequired: true, coverage: "ABD hisse ve ETF günlük fiyatları" },
    { name: "EODHD", active: Boolean(process.env.EODHD_API_KEY), keyRequired: true, coverage: "Hisse, ETF, BIST, emtia, döviz ve kripto yedeği" },
    { name: "Alpha Vantage", active: Boolean(process.env.ALPHA_VANTAGE_API_KEY), keyRequired: true, coverage: "ABD hisse ve ETF fiyat yedeği" },
    { name: "FRED", active: Boolean(process.env.FRED_API_KEY), keyRequired: true, coverage: "M2, CPI ve 10 yıllık reel faiz" },
    { name: "Yahoo-compatible", active: true, keyRequired: false, coverage: "Anahtarlı servisler başarısızsa fiyat yedeği" },
    { name: "Stooq", active: true, keyRequired: false, coverage: "Gün sonu geçmiş fiyat yedeği" },
  ];
}
