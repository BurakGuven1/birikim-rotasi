import { parseScannerRows, scannerRequest, type StockMarket, type StockSnapshot } from "../domain/stock-watchlist";

const cache = new Map<StockMarket, StockSnapshot>();
const pending = new Map<StockMarket, Promise<StockSnapshot>>();
const attempted = new Map<StockMarket, number>();

export async function refreshStockWatchlist(market: StockMarket): Promise<StockSnapshot> {
  const running = pending.get(market);
  if (running) return running;
  const last = attempted.get(market);
  if (last && Date.now() - last < 30_000) {
    const cached = cache.get(market);
    if (cached) return { ...cached, cached: true };
    throw new Error("Kaynak kısa süre önce yanıt vermedi. 30 saniye sonra tekrar dene.");
  }
  attempted.set(market, Date.now());
  const task = (async () => {
    const request = (expanded: boolean) => fetch(`https://scanner.tradingview.com/${market === "TR" ? "turkey" : "america"}/scan`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(scannerRequest(market, expanded)), cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    let response = await request(true);
    let fundamentalsWarning: string | undefined;
    if (response.status === 400 || response.status === 422) {
      response = await request(false);
      fundamentalsWarning = "Temel veri alanları alınamadı. Fiyat listesi güncellendi; fırsat sıralaması için veri yetersiz.";
    }
    if (!response.ok) throw new Error(response.status === 429 ? "Veri kaynağının istek sınırına ulaşıldı. Biraz sonra tekrar dene." : `Veri kaynağı yanıt vermedi (${response.status}).`);
    const rows = parseScannerRows(await response.json(), market);
    if (!rows.length) throw new Error("Kaynak kullanılabilir hisse döndürmedi. Önceki listen korundu.");
    const snapshot: StockSnapshot = { market, rows, fetchedAt: new Date().toISOString(), source: "TradingView tarayıcı verisi", ...(fundamentalsWarning ? { fundamentalsWarning } : {}) };
    cache.set(market, snapshot);
    return snapshot;
  })();
  pending.set(market, task);
  try { return await task; } finally { pending.delete(market); }
}
