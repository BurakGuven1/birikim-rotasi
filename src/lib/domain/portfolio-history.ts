import type { Currency, PricePoint, Transaction } from "./types";

export interface HistorySeries { points: PricePoint[]; currency?: Currency; source?: string }
export interface PortfolioHistoryPoint { date: string; invested: number | null; value: number | null; profit: number | null }
const dayMs = 86_400_000;
const ordered = (transactions: Transaction[]) => [...transactions].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

// Only past closes are eligible. Four calendar days bridge ordinary weekends;
// longer holidays/provider gaps remain unavailable rather than extending stale prices.
function priceReader(points: PricePoint[]) {
  const sorted = [...points].filter(p => Number.isFinite(p.close) && p.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  let index = -1;
  return (date: string): number | null => {
    while (index + 1 < sorted.length && sorted[index + 1].date.slice(0, 10) <= date) index++;
    const point = sorted[index];
    return point && Date.parse(date) - Date.parse(point.date.slice(0, 10)) <= 4 * dayMs ? point.close : null;
  };
}

export function buildPortfolioHistory(transactions: Transaction[], histories: Record<string, HistorySeries>, usdTry: PricePoint[], through: string): PortfolioHistoryPoint[] {
  const trades = ordered(transactions).filter(t => t.date.slice(0, 10) <= through);
  if (!trades.length) return [];
  const readers = Object.fromEntries(Object.entries(histories).map(([symbol, history]) => [symbol, priceReader(history.points)]));
  const fxReader = priceReader(usdTry);
  const holdings = new Map<string, number>();
  const rows: PortfolioHistoryPoint[] = [];
  let invested: number | null = 0;
  let cursor = 0;
  for (let time = Date.parse(trades[0].date.slice(0, 10)); time <= Date.parse(through); time += dayMs) {
    const date = new Date(time).toISOString().slice(0, 10);
    const fx = fxReader(date);
    const rate = (currency?: Currency) => currency === "TRY" ? 1 : currency === "USD" ? fx : null;
    while (cursor < trades.length && trades[cursor].date.slice(0, 10) <= date) {
      const trade = trades[cursor++];
      if (!Number.isFinite(trade.quantity) || trade.quantity <= 0 || !Number.isFinite(trade.unitPrice) || trade.unitPrice < 0 || !Number.isFinite(trade.commission) || trade.commission < 0) throw new Error("Geçersiz portföy işlemi.");
      const quantity = (holdings.get(trade.symbol) ?? 0) + (trade.type === "buy" ? trade.quantity : -trade.quantity);
      if (quantity < -1e-9) throw new Error(`${trade.symbol} için satılabilir adetten fazla satış girildi.`);
      holdings.set(trade.symbol, Math.max(0, quantity));
      const transactionFx = rate(trade.currency);
      invested = invested === null || transactionFx === null ? null : invested + ((trade.type === "buy" ? 1 : -1) * trade.quantity * trade.unitPrice + trade.commission) * transactionFx;
    }
    let value: number | null = 0;
    for (const [symbol, quantity] of holdings) {
      if (quantity <= 1e-9) continue;
      const close = readers[symbol]?.(date) ?? null;
      const quoteFx = rate(histories[symbol]?.currency);
      if (close === null || quoteFx === null) { value = null; break; }
      value += quantity * close * quoteFx;
    }
    rows.push({ date, invested, value, profit: value === null || invested === null ? null : value - invested });
  }
  return rows;
}

// A cost line is shown only when trades and chart share a currency; converting
// historical costs using today's FX would give a misleading entry price.
export function positionAverageCost(transactions: Transaction[], currency: Currency): number | null {
  if (transactions.some(t => t.currency !== currency)) return null;
  const lots: Array<{ quantity: number; cost: number }> = [];
  for (const trade of ordered(transactions)) {
    if (trade.type === "buy") lots.push({ quantity: trade.quantity, cost: trade.unitPrice + trade.commission / trade.quantity });
    else {
      let remaining = trade.quantity;
      while (remaining > 1e-9) {
        const lot = lots[0];
        if (!lot) return null;
        const sold = Math.min(remaining, lot.quantity);
        remaining -= sold; lot.quantity -= sold;
        if (lot.quantity <= 1e-9) lots.shift();
      }
    }
  }
  const quantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
  return quantity > 1e-9 ? lots.reduce((sum, lot) => sum + lot.quantity * lot.cost, 0) / quantity : null;
}
