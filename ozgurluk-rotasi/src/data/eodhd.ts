import type { Bar } from "./types.ts";
import { getJson } from "./http.ts";

interface EodRow { date: string; open: number; high: number; low: number; close: number; adjusted_close: number; volume: number }

export async function fetchEodhdDaily(symbol: string, apiKey: string): Promise<Bar[]> {
  const url = `https://eodhd.com/api/eod/${encodeURIComponent(symbol)}?api_token=${apiKey}&fmt=json&from=1990-01-01`;
  const rows = await getJson<EodRow[]>(url);
  return rows
    .filter((r) => r.close > 0)
    .map((r) => {
      const f = (r.adjusted_close || r.close) / r.close;
      return { date: r.date, open: r.open * f, high: r.high * f, low: r.low * f, close: r.adjusted_close || r.close, volume: r.volume };
    });
}
