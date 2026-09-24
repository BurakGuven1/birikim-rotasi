import { ASSETS, MACRO, type AssetId } from "../config.ts";
import { env } from "../env.ts";
import { cached } from "./cache.ts";
import { fetchEodhdDaily } from "./eodhd.ts";
import { fetchFred } from "./fred.ts";
import type { Bar, Point } from "./types.ts";
import { fetchYahooDaily } from "./yahoo.ts";

const MAX_AGE_H = 12;

async function daily(symbol: string, eodhd?: string): Promise<Bar[]> {
  return cached(`yahoo_${symbol}`, MAX_AGE_H, async () => {
    try {
      return await fetchYahooDaily(symbol);
    } catch (err) {
      const key = env("EODHD_API_KEY");
      if (!key || !eodhd) throw err;
      console.warn(`! Yahoo ${symbol} başarısız, EODHD ${eodhd} deneniyor`);
      return fetchEodhdDaily(eodhd, key);
    }
  });
}

/** TRY cinsi OHLC'yi aynı günün (yoksa son bilinen) USD/TRY kuruna bölerek USD'ye çevirir. */
export function convertByFx(bars: Bar[], fx: Bar[]): Bar[] {
  const fxMap = new Map(fx.map((b) => [b.date, b.close]));
  const fxDates = fx.map((b) => b.date);
  let j = 0;
  let last: number | undefined;
  const out: Bar[] = [];
  for (const b of bars) {
    while (j < fxDates.length && fxDates[j] <= b.date) {
      last = fxMap.get(fxDates[j]);
      j++;
    }
    if (!last) continue;
    out.push({ date: b.date, open: b.open / last, high: b.high / last, low: b.low / last, close: b.close / last, volume: b.volume });
  }
  return out;
}

export async function loadAsset(id: AssetId): Promise<Bar[]> {
  const def = ASSETS[id];
  const bars = await daily(def.yahoo, def.eodhd);
  if (!def.fxDivisor) return bars;
  const fx = await daily(def.fxDivisor, "USDTRY.FOREX");
  return convertByFx(bars, fx);
}

export async function loadAll(ids: AssetId[]): Promise<Record<AssetId, Bar[]>> {
  const out = {} as Record<AssetId, Bar[]>;
  for (const id of ids) out[id] = await loadAsset(id);
  return out;
}

export async function loadCpi(): Promise<Point[]> {
  return cached(`fred_${MACRO.cpi}`, 24, () => fetchFred(MACRO.cpi, env("FRED_API_KEY")));
}

/** Hazine bonosu faizi (yıllık %, ^IRX). */
export async function loadTbill(): Promise<Bar[]> {
  return daily(MACRO.tbillYahoo);
}
