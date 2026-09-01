import { z } from "zod";
import type { Transaction } from "../domain/types";

const transactionSchema = z.object({
  id: z.string().min(1),
  symbol: z.string().min(1),
  name: z.string().min(1),
  assetClass: z.enum(["foreignEquity", "commodity", "bitcoin", "turkishEquity"]),
  type: z.enum(["buy", "sell"]),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  currency: z.enum(["TRY", "USD", "EUR"]),
  commission: z.number().nonnegative(),
  date: z.string().min(10),
});

const backupSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  transactions: z.array(transactionSchema),
});

export function exportPortfolioJson(transactions: Transaction[]): string {
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), transactions }, null, 2);
}

export function parsePortfolioJson(value: string): Transaction[] {
  try {
    return backupSchema.parse(JSON.parse(value)).transactions;
  } catch {
    throw new Error("Geçersiz veya desteklenmeyen portföy yedeği.");
  }
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function exportTransactionsCsv(transactions: Transaction[]): string {
  const columns: Array<keyof Transaction> = [
    "id", "date", "type", "symbol", "name", "assetClass", "quantity", "unitPrice", "currency", "commission",
  ];
  return [
    columns.join(","),
    ...transactions.map((transaction) => columns.map((column) => csvCell(transaction[column])).join(",")),
  ].join("\n");
}
