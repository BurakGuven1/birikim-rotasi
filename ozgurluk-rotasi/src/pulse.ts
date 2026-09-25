/** Piyasa nabzı: günlük değişimli ana göstergeler, kripto korku/açgözlülük ve yaklaşan önemli tarihler. */
import { getJson } from "./data/http.ts";
import { EVENTS } from "./data/events.ts";

interface Ticker { id: string; label: string; group: string; source: "yahoo" | "okx"; symbol: string; unit?: string; invertHint?: string }

export const TICKERS: Ticker[] = [
  { id: "spx", label: "S&P 500", group: "ABD", source: "yahoo", symbol: "^GSPC" },
  { id: "ndx", label: "Nasdaq 100", group: "ABD", source: "yahoo", symbol: "^NDX" },
  { id: "vix", label: "VIX (korku)", group: "Risk", source: "yahoo", symbol: "^VIX", invertHint: "Yükselmesi = piyasada gerginlik" },
  { id: "tnx", label: "ABD 10Y faiz", group: "Makro", source: "yahoo", symbol: "^TNX", unit: "%" },
  { id: "dxy", label: "Dolar endeksi", group: "Makro", source: "yahoo", symbol: "DX-Y.NYB" },
  { id: "gold", label: "Altın (ons)", group: "Emtia", source: "yahoo", symbol: "GC=F" },
  { id: "brent", label: "Brent petrol", group: "Emtia", source: "yahoo", symbol: "BZ=F" },
  { id: "btc", label: "Bitcoin", group: "Kripto", source: "okx", symbol: "BTC-USDT" },
  { id: "eth", label: "Ethereum", group: "Kripto", source: "okx", symbol: "ETH-USDT" },
  { id: "bist", label: "BIST 100", group: "Türkiye", source: "yahoo", symbol: "XU100.IS" },
  { id: "usdtry", label: "USD/TRY", group: "Türkiye", source: "yahoo", symbol: "TRY=X" },
];

/** FOMC 2026 toplantı günleri (Fed'in yayımladığı takvim; karar ikinci günün akşamı). */
export const FOMC_2026 = ["2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09"];

export interface PulseTicker { id: string; label: string; group: string; price: number; change: number; unit?: string; hint?: string; spark: number[] }
export interface PulsePayload {
  generatedAt: string;
  tickers: PulseTicker[];
  fearGreed?: { value: number; label: string; previous?: number; weekAgo?: number };
  upcoming: { date: string; title: string; daysLeft: number }[];
}

async function yahoo(symbol: string): Promise<{ price: number; change: number; spark: number[] }> {
  const j = await getJson<{ chart: { result: { meta: { regularMarketPrice: number }; indicators: { quote: { close: (number | null)[] }[] } }[] } }>(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`,
  );
  const r = j.chart.result[0];
  const closes = r.indicators.quote[0].close.filter((x): x is number => x != null);
  const price = r.meta.regularMarketPrice ?? closes[closes.length - 1];
  // Son günlük bar genellikle bugünün (canlı) barıdır: fiyata ~eşitse bir önceki kapanışı baz al
  const last = closes[closes.length - 1];
  const prev = closes.length >= 2 ? (Math.abs(last - price) / price < 5e-4 ? closes[closes.length - 2] : last) : price;
  return { price, change: price / prev - 1, spark: closes.slice(-22) };
}

async function okx(instId: string): Promise<{ price: number; change: number; spark: number[] }> {
  const [t, c] = await Promise.all([
    getJson<{ data: { last: string; open24h: string }[] }>(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`),
    getJson<{ data: string[][] }>(`https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=1Dutc&limit=22`),
  ]);
  const last = Number(t.data[0].last);
  return { price: last, change: last / Number(t.data[0].open24h) - 1, spark: c.data.map((r) => Number(r[4])).reverse() };
}

let cache: { at: number; data: PulsePayload } | undefined;

export async function getPulse(force = false): Promise<PulsePayload> {
  if (!force && cache && Date.now() - cache.at < 5 * 60_000) return cache.data;
  const res = await Promise.allSettled(TICKERS.map((t) => (t.source === "okx" ? okx(t.symbol) : yahoo(t.symbol))));
  const tickers: PulseTicker[] = [];
  TICKERS.forEach((t, i) => {
    const r = res[i];
    if (r.status === "fulfilled") tickers.push({ id: t.id, label: t.label, group: t.group, unit: t.unit, hint: t.invertHint, ...r.value });
  });
  let fearGreed: PulsePayload["fearGreed"];
  try {
    const fg = await getJson<{ data: { value: string; value_classification: string }[] }>("https://api.alternative.me/fng/?limit=8");
    const TR: Record<string, string> = { "Extreme Fear": "Aşırı korku", Fear: "Korku", Neutral: "Nötr", Greed: "Açgözlülük", "Extreme Greed": "Aşırı açgözlülük" };
    fearGreed = { value: Number(fg.data[0].value), label: TR[fg.data[0].value_classification] ?? fg.data[0].value_classification, previous: Number(fg.data[1]?.value), weekAgo: Number(fg.data[7]?.value) };
  } catch { /* isteğe bağlı */ }
  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  const upcoming = [
    ...FOMC_2026.filter((d) => d >= today).map((d) => ({ date: d, title: "Fed faiz kararı (FOMC)" })),
    ...EVENTS.filter((e) => e.upcoming && e.date >= today).map((e) => ({ date: e.date, title: e.title })),
  ]
    .map((e) => ({ ...e, daysLeft: Math.ceil((Date.parse(e.date) - now) / 86_400_000) }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 6);
  const data = { generatedAt: new Date().toISOString(), tickers, fearGreed, upcoming };
  if (tickers.length || !cache) cache = { at: Date.now(), data };
  return cache.data;
}
