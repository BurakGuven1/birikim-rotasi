import type { Transaction } from "../domain/types";
import { investmentDb } from "./db";
import { validateWatchlistTrade } from "../domain/stock-watchlist";

const requireDb = () => {
  if (!investmentDb) throw new Error("Yerel portföy deposu yalnızca tarayıcıda kullanılabilir.");
  return investmentDb;
};

export const EXAMPLE_TRANSACTIONS: Transaction[] = [
  { id: "demo-btc", symbol: "BTC", name: "Bitcoin", assetClass: "bitcoin", type: "buy", quantity: 0.08, unitPrice: 2_150_000, currency: "TRY", commission: 220, date: "2025-10-15" },
  { id: "demo-voo", symbol: "VOO", name: "Vanguard S&P 500 ETF", assetClass: "foreignEquity", type: "buy", quantity: 4, unitPrice: 545, currency: "USD", commission: 2, date: "2025-11-15" },
  { id: "demo-gold", symbol: "GOLD", name: "Altın", assetClass: "commodity", type: "buy", quantity: 1.5, unitPrice: 3_380, currency: "USD", commission: 1, date: "2025-12-15" },
  { id: "demo-asels", symbol: "ASELS.IS", name: "Aselsan", assetClass: "turkishEquity", type: "buy", quantity: 300, unitPrice: 93, currency: "TRY", commission: 28, date: "2026-01-15" },
];

export const portfolioRepository = {
  list: () => requireDb().transactions.orderBy("date").toArray(),
  add: (transaction: Transaction) => requireDb().transactions.add(transaction),
  addValidated: (transaction: Transaction) => {
    const db = requireDb();
    return db.transaction("rw", db.transactions, async () => {
      const existing = await db.transactions.toArray();
      // Existing FIFO readers order equal dates by id. Preserve the entry order
      // under that contract instead of letting a random UUID precede its buy.
      const last = existing.filter(row => row.date === transaction.date).sort((a, b) => a.id.localeCompare(b.id)).at(-1);
      let id = last ? `${last.id}~` : transaction.id;
      while (existing.some(row => row.id === id)) id += "~";
      const orderedTransaction = { ...transaction, id };
      validateWatchlistTrade(existing, orderedTransaction, new Date().toISOString().slice(0, 10));
      await db.transactions.add(orderedTransaction);
    });
  },
  update: (transaction: Transaction) => requireDb().transactions.put(transaction),
  remove: (id: string) => requireDb().transactions.delete(id),
  replaceAll: async (transactions: Transaction[]) => requireDb().transaction("rw", requireDb().transactions, async () => {
    await requireDb().transactions.clear();
    await requireDb().transactions.bulkAdd(transactions);
  }),
  seedExample: async () => {
    const db = requireDb();
    if (await db.transactions.count()) return;
    await db.transactions.bulkAdd(EXAMPLE_TRANSACTIONS);
  },
};
