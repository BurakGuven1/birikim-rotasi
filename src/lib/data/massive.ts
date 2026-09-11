import type { MarketSnapshot, PricePoint } from "../domain/types";
import type { HistoryOptions, MarketDataProvider } from "./provider";
import { freshnessStatus } from "./provider";

const origin = "https://api.massive.com";
const cache = new Map<string, { expires: number; value: unknown }>();
let lastRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();
function key() { const value = process.env.MASSIVE_API_KEY; if (!value) throw new Error("MASSIVE_API_KEY yapılandırılmadı."); return value; }
function dateValue(value: HistoryOptions["from"], fallback: Date) { const date = value instanceof Date ? value : value === undefined ? fallback : new Date(value); if (!Number.isFinite(date.getTime())) throw new Error("Geçersiz tarih."); return date; }
async function request(pathOrUrl: string): Promise<unknown> {
  const url = new URL(pathOrUrl, origin);
  if (url.origin !== origin) throw new Error("Massive sayfalama host adresi geçersiz.");
  url.searchParams.delete("apiKey");
  const id = url.toString();
  const hit = cache.get(id); if (hit && hit.expires > Date.now()) return hit.value;
  const operation=queue.then(async()=>{
    const again=cache.get(id);if(again&&again.expires>Date.now())return again.value;
    const configured=Number(process.env.MASSIVE_REQUESTS_PER_MINUTE??5);
    const delay=60000/(Number.isFinite(configured)&&configured>0?Math.min(configured,1000):5)+50;
    const wait=Math.max(0,delay-(Date.now()-lastRequestAt));
    if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
    lastRequestAt=Date.now();
    const response=await fetch(url,{headers:{Authorization:`Bearer ${key()}`},signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw new Error(`Massive ${response.status} ? erişim / istek sınırı`);
    const value=await response.json();
    if(cache.size>=128)cache.delete(cache.keys().next().value!);
    cache.set(id,{expires:Date.now()+300000,value});return value;
  });
  queue=operation.catch(()=>{});return operation;
}
type Aggregate = { t: number; o?: number; h?: number; l?: number; c: number; v?: number };
async function aggregates(symbol: string, from: Date, to: Date, interval: "1d" | "4h" = "1d") {
  let next: string | undefined = `${origin}/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/${interval === "4h" ? "4/hour" : "1/day"}/${from.toISOString().slice(0, 10)}/${to.toISOString().slice(0, 10)}?adjusted=true&sort=asc&limit=50000`; const rows: Aggregate[] = [];
  for (let page = 0; next && page < 100; page++) { const payload = await request(next) as { results?: Aggregate[]; next_url?: string }; rows.push(...(payload.results ?? [])); next = payload.next_url; }
  return rows;
}
function rangeStart(range: string, to: Date) { const from = new Date(to); from.setUTCFullYear(from.getUTCFullYear() - (range === "max" ? 20 : Number.parseInt(range, 10) || 5)); return from; }
const point = (row: Aggregate): PricePoint => ({ date: new Date(row.t).toISOString(), open: row.o, high: row.h, low: row.l, close: Number(row.c), volume: row.v });
export const massiveProvider: MarketDataProvider = {
  id: "Massive",
  historyCapabilities: [{ interval: "1d", market: "spot" }, { interval: "4h", market: "spot" }],
  supports(symbol) { const value = symbol.trim().toUpperCase(); return Boolean(process.env.MASSIVE_API_KEY) && !value.endsWith(".IS") && /^[A-Z][A-Z0-9.\-]{0,14}$/.test(value) && !["BTC", "ETH", "BTCUSDT", "ETHUSDT", "GOLD", "SILVER", "BIST100", "USDTRY", "SP500", "NASDAQ"].includes(value); },
  async getQuote(symbol): Promise<MarketSnapshot> { const to = new Date(); const rows = await aggregates(symbol.trim().toUpperCase(), new Date(to.getTime() - 10 * 86_400_000), to); const last = rows.at(-1); const previous = rows.at(-2); if (!last || !Number.isFinite(last.c) || last.c <= 0) throw new Error("Massive geçerli fiyat döndürmedi."); const asOf = new Date(last.t).toISOString(); return { price: last.c, currency: "USD", asOf, source: "Massive ? günlük fiyat (anlık erişim doğrulanmadı)", status: freshnessStatus(asOf) === "stale" ? "stale" : "delayed", changePercent: previous?.c ? (last.c / previous.c - 1) * 100 : undefined }; },
  async getHistory(symbol, range = "5y", options = {}) { const to = dateValue(options.to, new Date()); const from = dateValue(options.from, rangeStart(range, to)); if(options.market === "futures") throw new Error("Massive hisse adaptörü futures sağlamaz."); const interval=options.interval ?? "1d"; return (await aggregates(symbol.trim().toUpperCase(), from, to, interval)).filter(row => Number.isFinite(row.c) && row.c > 0 && row.t + (interval === "4h" ? 4*3600000 : 86400000) <= Math.min(to.getTime(), Date.now())).map(point); },
};
