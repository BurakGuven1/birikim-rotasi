"use client";

import { useState } from "react";
import { Plus, Save, X } from "lucide-react";
import type { AssetClass, Currency, Transaction } from "@/lib/domain/types";

interface TransactionFormState {
  symbol: string; name: string; assetClass: AssetClass; type: "buy" | "sell"; quantity: string; unitPrice: string; currency: Currency; commission: string; date: string;
}
const empty: TransactionFormState = { symbol: "", name: "", assetClass: "foreignEquity", type: "buy", quantity: "", unitPrice: "", currency: "TRY", commission: "0", date: new Date().toISOString().slice(0, 10) };

export function TransactionForm({ editing, onSave, onCancel }: { editing?: Transaction | null; onSave: (transaction: Transaction) => Promise<void>; onCancel: () => void }) {
  const [form, setForm] = useState<TransactionFormState>(() => editing ? { ...editing, quantity: String(editing.quantity), unitPrice: String(editing.unitPrice), commission: String(editing.commission) } : empty);
  const [error, setError] = useState("");
  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    const quantity = Number(form.quantity); const unitPrice = Number(form.unitPrice); const commission = Number(form.commission);
    if (!form.symbol.trim() || !form.name.trim() || quantity <= 0 || unitPrice < 0 || commission < 0) { setError("Sembol, ad, pozitif adet ve geçerli fiyat gerekli."); return; }
    await onSave({ id: editing?.id ?? crypto.randomUUID(), symbol: form.symbol.trim().toUpperCase(), name: form.name.trim(), assetClass: form.assetClass, type: form.type, quantity, unitPrice, currency: form.currency, commission, date: form.date });
    setForm(empty);
  };
  return <form onSubmit={submit}>
    <div className="form-grid">
      <div className="field"><label htmlFor="tx-symbol">Sembol</label><input id="tx-symbol" className="input" value={form.symbol} onChange={(e) => set("symbol", e.target.value)} placeholder="BTC, VOO, ASELS.IS" /></div>
      <div className="field"><label htmlFor="tx-name">Varlık adı</label><input id="tx-name" className="input" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Bitcoin" /></div>
      <div className="field"><label htmlFor="tx-class">Varlık sınıfı</label><select id="tx-class" className="select" value={form.assetClass} onChange={(e) => set("assetClass", e.target.value)}><option value="foreignEquity">Yabancı hisse/fon</option><option value="commodity">Emtia</option><option value="bitcoin">Bitcoin</option><option value="turkishEquity">Türk hisse/fon</option></select></div>
      <div className="field"><label htmlFor="tx-type">İşlem</label><select id="tx-type" className="select" value={form.type} onChange={(e) => set("type", e.target.value)}><option value="buy">Alış</option><option value="sell">Satış</option></select></div>
      <div className="field"><label htmlFor="tx-quantity">Adet</label><input id="tx-quantity" className="input" type="number" min="0" step="any" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} /></div>
      <div className="field"><label htmlFor="tx-price">Birim fiyat</label><input id="tx-price" className="input" type="number" min="0" step="any" value={form.unitPrice} onChange={(e) => set("unitPrice", e.target.value)} /></div>
      <div className="field"><label htmlFor="tx-currency">Para birimi</label><select id="tx-currency" className="select" value={form.currency} onChange={(e) => set("currency", e.target.value)}><option>TRY</option><option>USD</option><option>EUR</option></select></div>
      <div className="field"><label htmlFor="tx-commission">Komisyon</label><input id="tx-commission" className="input" type="number" min="0" step="any" value={form.commission} onChange={(e) => set("commission", e.target.value)} /></div>
      <div className="field"><label htmlFor="tx-date">İşlem tarihi</label><input id="tx-date" className="input" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} /></div>
      <div className="form-actions"><button className="button primary" type="submit">{editing ? <Save size={17} /> : <Plus size={17} />}{editing ? "Kaydet" : "İşlem ekle"}</button>{editing && <button className="button secondary" type="button" onClick={onCancel}><X size={17} />Vazgeç</button>}</div>
    </div>
    {error && <p className="negative">{error}</p>}
  </form>;
}
