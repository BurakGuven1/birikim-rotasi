"use client";

import { Pencil, Trash2 } from "lucide-react";
import type { Transaction } from "@/lib/domain/types";
import { formatMoney, formatNumber } from "@/lib/format";

export function TransactionTable({ transactions, onEdit, onRemove }: { transactions: Transaction[]; onEdit: (transaction: Transaction) => void; onRemove: (id: string) => Promise<void> }) {
  return <div className="table-wrap"><table className="data-table"><thead><tr><th>Tarih</th><th>Varlık</th><th>İşlem</th><th className="number">Adet</th><th className="number">Birim fiyat</th><th className="number">Komisyon</th><th aria-label="İşlemler" /></tr></thead><tbody>
    {[...transactions].sort((a, b) => b.date.localeCompare(a.date)).map((transaction) => <tr key={transaction.id}><td>{transaction.date}</td><td><strong>{transaction.symbol}</strong><br /><span className="muted">{transaction.name}</span></td><td><span className={`status-badge ${transaction.type === "buy" ? "fresh" : "stale"}`}>{transaction.type === "buy" ? "Alış" : "Satış"}</span></td><td className="number">{formatNumber(transaction.quantity, 6)}</td><td className="number">{formatMoney(transaction.unitPrice, transaction.currency)}</td><td className="number">{formatMoney(transaction.commission, transaction.currency)}</td><td><div style={{ display: "flex", gap: 6 }}><button className="button secondary small" onClick={() => onEdit(transaction)} aria-label={`${transaction.symbol} işlemini düzenle`}><Pencil size={15} /></button><button className="button danger small" onClick={() => void onRemove(transaction.id)} aria-label={`${transaction.symbol} işlemini sil`}><Trash2 size={15} /></button></div></td></tr>)}
  </tbody></table></div>;
}
