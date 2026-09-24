import type { Bar } from "./types.ts";
import { getJson } from "./http.ts";

interface ChartResponse {
  chart: {
    result: {
      timestamp: number[];
      indicators: {
        quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[];
        adjclose?: { adjclose: (number | null)[] }[];
      };
    }[] | null;
    error: unknown;
  };
}

/** Yahoo günlük tüm geçmiş. OHLC, düzeltmeli kapanış oranıyla ölçeklenir (temettü dahil toplam getiri). */
export async function fetchYahooDaily(symbol: string): Promise<Bar[]> {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=0&period2=9999999999&interval=1d&events=div%2Csplit`;
  const json = await getJson<ChartResponse>(url);
  const r = json.chart.result?.[0];
  if (!r) throw new Error(`Yahoo: ${symbol} için veri yok`);
  const q = r.indicators.quote[0];
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const byDate = new Map<string, Bar>();
  r.timestamp.forEach((ts, i) => {
    const c = q.close[i];
    const o = q.open[i];
    const h = q.high[i];
    const l = q.low[i];
    if (c == null || o == null || h == null || l == null || !(c > 0)) return;
    const a = adj?.[i] ?? c;
    const f = a / c;
    const date = new Date(ts * 1000).toISOString().slice(0, 10);
    byDate.set(date, { date, open: o * f, high: h * f, low: l * f, close: a, volume: q.volume[i] ?? 0 });
  });
  return [...byDate.values()].sort((x, y) => x.date.localeCompare(y.date));
}
