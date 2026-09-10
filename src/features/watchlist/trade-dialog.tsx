"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { StockIdentity, StockRow } from "@/lib/domain/stock-watchlist";
import { portfolioRepository } from "@/lib/storage/portfolio-repository";
import { formatMoney } from "@/lib/format";

export function TradeDialog({ stock, row, type, held, onClose, onSaved }: { stock: StockIdentity; row?: StockRow; type: "buy" | "sell"; held: number; onClose: () => void; onSaved: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState(row?.price?.toString() ?? "");
  const [commission, setCommission] = useState("0");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const currency = stock.market === "TR" ? "TRY" : "USD";
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (saving) return;
    setSaving(true); setError("");
    try {
      await portfolioRepository.addValidated({ id: crypto.randomUUID(), symbol: stock.symbol, name: stock.name, assetClass: stock.market === "TR" ? "turkishEquity" : "foreignEquity", type, quantity: Number(quantity), unitPrice: Number(price), commission: Number(commission), currency, date });
      await onSaved(); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "İşlem kaydedilemedi."); setSaving(false); }
  };
  const total = Number(quantity) * Number(price) + (type === "buy" ? 1 : -1) * Number(commission);
  return <dialog ref={dialog} className="watchlist-dialog" aria-labelledby="stock-trade-title" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <div className="watchlist-dialog-heading"><div><span className="eyebrow">PORTFÖY İŞLEMİ</span><h2 id="stock-trade-title">{stock.ticker} · {type === "buy" ? "Alış ekle" : "Satış ekle"}</h2><p>{stock.name}</p></div><button type="button" className="watchlist-icon-button" aria-label="İşlem formunu kapat" disabled={saving} onClick={onClose}><X size={20} /></button></div>
    <div className="watchlist-position">Portföyünde <strong>{held.toLocaleString("tr-TR", { maximumFractionDigits: 6 })} adet</strong></div>
    <form onSubmit={event => void save(event)}>
      <div className="watchlist-trade-fields">
        <label>Adet<input autoFocus className="input" type="number" min="0.00000001" step="any" required value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
        <label>Birim fiyat ({currency})<input className="input" type="number" min="0.00000001" step="any" required value={price} onChange={event => setPrice(event.target.value)} /></label>
        <label>Komisyon ({currency})<input className="input" type="number" min="0" step="any" required value={commission} onChange={event => setCommission(event.target.value)} /></label>
        <label>İşlem tarihi<input className="input" type="date" required max={new Date().toISOString().slice(0, 10)} value={date} onChange={event => setDate(event.target.value)} /></label>
      </div>
      <p className="muted">{row?.price ? "Son fiyat öneri olarak dolduruldu. Gerçekleşen işlem fiyatını ve tarihini kontrol et." : "Gerçekleşen işlem fiyatını gir."} Bu kayıt aracı kuruma emir göndermez.</p>
      <div className="watchlist-trade-total"><span>{type === "buy" ? "Toplam maliyet" : "Net satış tutarı"}</span><strong>{Number.isFinite(total) ? formatMoney(total, currency) : "—"}</strong></div>
      {error && <p role="alert" className="negative">{error}</p>}
      <div className="watchlist-dialog-actions"><button type="button" className="button secondary" disabled={saving} onClick={onClose}>Vazgeç</button><button type="submit" className="button primary" disabled={saving}>{saving ? "Kaydediliyor…" : "Portföye kaydet"}</button></div>
    </form>
  </dialog>;
}
