import type { AssetId } from "../config.ts";
import { getJson } from "./http.ts";

/**
 * Portföy için anlık fiyatlar. Varlık, gerçekte alınan araçla fiyatlanır:
 * altın ons (XAU), BTC/ETH adet, ETF'ler pay, BIST 100 USD cinsinden endeks puanı.
 */
export interface QuoteDef {
  label: string;
  unit: string;
  source: "okx" | "yahoo" | "yahoo-fx";
  symbol: string;
  fx?: string;
}

export const QUOTES: Record<AssetId, QuoteDef> = {
  SPY: { label: "SPY (S&P 500 ETF)", unit: "pay", source: "yahoo", symbol: "SPY" },
  QQQ: { label: "QQQ (Nasdaq 100 ETF)", unit: "pay", source: "yahoo", symbol: "QQQ" },
  GLD: { label: "XAU/USD (altın ons)", unit: "ons", source: "okx", symbol: "XAUT-USDT" },
  BIST: { label: "XU100 (USD)", unit: "endeks birimi", source: "yahoo-fx", symbol: "XU100.IS", fx: "TRY=X" },
  BTC: { label: "BTC/USDT", unit: "BTC", source: "okx", symbol: "BTC-USDT" },
  ETH: { label: "ETH/USDT", unit: "ETH", source: "okx", symbol: "ETH-USDT" },
  DBC: { label: "DBC (emtia ETF)", unit: "pay", source: "yahoo", symbol: "DBC" },
};

async function yahooLast(symbol: string): Promise<{ price: number; time: string }> {
  const j = await getJson<{ chart: { result: { meta: { regularMarketPrice: number; regularMarketTime: number } }[] } }>(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`,
  );
  const m = j.chart.result[0].meta;
  return { price: m.regularMarketPrice, time: new Date(m.regularMarketTime * 1000).toISOString() };
}

async function okxLast(instId: string): Promise<{ price: number; time: string }> {
  const j = await getJson<{ code: string; data: { last: string; ts: string }[] }>(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`);
  const d = j.data[0];
  return { price: Number(d.last), time: new Date(Number(d.ts)).toISOString() };
}

export interface Quote { price: number; time: string; label: string; unit: string }

let cache: { at: number; data: Record<AssetId, Quote> } | undefined;

/** Tüm varlıkların anlık fiyatı (5 dk önbellek). Hata veren varlık `fallback` fiyatına düşer. */
export async function fetchQuotes(fallback: Partial<Record<AssetId, { price: number; time: string }>> = {}, force = false): Promise<Record<AssetId, Quote>> {
  if (!force && cache && Date.now() - cache.at < 300_000) return cache.data;
  const out = {} as Record<AssetId, Quote>;
  await Promise.all(
    (Object.keys(QUOTES) as AssetId[]).map(async (id) => {
      const q = QUOTES[id];
      try {
        let r: { price: number; time: string };
        if (q.source === "okx") r = await okxLast(q.symbol);
        else if (q.source === "yahoo") r = await yahooLast(q.symbol);
        else {
          const [a, fx] = await Promise.all([yahooLast(q.symbol), yahooLast(q.fx!)]);
          r = { price: a.price / fx.price, time: a.time };
        }
        if (!(r.price > 0)) throw new Error("geçersiz fiyat");
        out[id] = { ...r, label: q.label, unit: q.unit };
      } catch {
        const f = fallback[id];
        if (f) out[id] = { ...f, label: q.label + " (son kapanış)", unit: q.unit };
      }
    }),
  );
  cache = { at: Date.now(), data: out };
  return out;
}
