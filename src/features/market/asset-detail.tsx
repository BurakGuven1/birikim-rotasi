"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, DatabaseZap } from "lucide-react";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { derivePriceSignal } from "@/lib/domain/signals";
import type { MarketSnapshot, PricePoint, Transaction } from "@/lib/domain/types";
import { positionAverageCost } from "@/lib/domain/portfolio-history";
import { portfolioRepository } from "@/lib/storage/portfolio-repository";
import { formatDateTime, formatMoney, formatPercent } from "@/lib/format";
import { CandlestickChart } from "./candlestick-chart";

const names: Record<string, string> = { BTC: "Bitcoin", VTI: "ABD toplam hisse piyasası", IAU: "iShares Gold Trust", GOLD: "Altın", SILVER: "Gümüş", SP500: "S&P 500", VT: "Dünya Hisseleri", VOO: "S&P 500 ETF", QQQM: "Nasdaq 100 ETF", BIST100: "BIST 100", USDTRY: "Dolar / TL" };

export function AssetDetail({ symbol }: { symbol: string }) {
  const [quote, setQuote] = useState<MarketSnapshot>();
  const [points, setPoints] = useState<PricePoint[]>([]);
  const [error, setError] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [storageError, setStorageError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    void Promise.all([
      fetch(`/api/market/quotes?symbols=${encodeURIComponent(symbol)}`, options).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Fiyat alınamadı"); if (!controller.signal.aborted && data[symbol]?.ok) setQuote(data[symbol].data); }),
      fetch(`/api/market/history?symbol=${encodeURIComponent(symbol)}&range=10y&allowPartial=true`, options).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); if (!controller.signal.aborted) setPoints(data.points); }),
    ]).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Veri alınamadı."); });
    void portfolioRepository.list().then(rows => { if (!controller.signal.aborted) setTransactions(rows.filter(t => t.symbol === symbol && t.date.slice(0, 10) <= new Date().toISOString().slice(0, 10))); }).catch(() => { if (!controller.signal.aborted) setStorageError("Yerel işlemler okunamadı; alım işaretleri ve maliyet gösterilemiyor."); });
    return () => controller.abort();
  }, [symbol]);
  const averageCost = useMemo(() => quote ? positionAverageCost(transactions, quote.currency) : null, [transactions, quote]);
  const levels = useMemo(() => averageCost === null ? [] : [{ price: averageCost, title: "Kalan pozisyon maliyeti", color: "#b7791f" }], [averageCost]);
  const signal = useMemo(() => derivePriceSignal(points.map((point) => point.close), symbol === "BTC" ? 1.8 : 1), [points, symbol]);
  const performance = (years: number) => {
    if (!points.length) return 0; const cutoff = new Date(points.at(-1)!.date).getTime() - years * 365.25 * 86_400_000;
    const start = points.find((point) => new Date(point.date).getTime() >= cutoff) ?? points[0];
    return points.at(-1)!.close / start.close - 1;
  };
  return <div>
    <Link href="/piyasa" className="button secondary small"><ArrowLeft size={16} />Piyasaya dön</Link>
    <PageHeader eyebrow={symbol} title={names[symbol] ?? symbol} description="Fiyat trendi, uzun ortalamalar ve sinyalin açıklanabilir kırılımı." actions={quote && <StatusBadge status={quote.status} />} />
    {error && !points.length ? <Card><EmptyState title="Geçmiş veri alınamadı" description={error} /></Card> : <>
      <div className="grid grid-4">
        <Card className="metric-card"><div className="metric-label">Son fiyat</div><div className="metric-value">{quote ? formatMoney(quote.price, quote.currency) : "—"}</div><div className="metric-meta">{quote ? `${quote.source} · ${formatDateTime(quote.asOf)}` : "Veri bekleniyor"}</div></Card>
        <Card className="metric-card"><div className="metric-label">SMA200 uzaklığı</div><div className={`metric-value ${signal.distanceFromLongAverage <= 0 ? "positive" : "negative"}`}>{formatPercent(signal.distanceFromLongAverage)}</div><div className="metric-meta">Volatiliteye göre sinyal {signal.score.toFixed(2)}</div></Card>
        <Card className="metric-card"><div className="metric-label">Zirveden değişim</div><div className="metric-value">{formatPercent(signal.drawdownFromAth)}</div><div className="metric-meta">ATH’den güncel kapanışa</div></Card>
        <Card className="metric-card"><div className="metric-label">Veri güveni</div><div className="metric-value">{formatPercent(signal.confidence, 0)}</div><div className="metric-meta">{points.length} gözlem</div></Card>
      </div>
      <Card className="section-gap"><div className="card-title"><div><h2>Fiyat ve işlemlerim</h2><p>Mum/çizgi, hacim, SMA40 ve SMA200 · {points[0]?.date.slice(0, 10) ?? "—"} – {points.at(-1)?.date.slice(0, 10) ?? "—"}</p></div></div>{points.length ? <CandlestickChart key={symbol} points={points} trades={transactions} levels={levels} /> : <EmptyState title="Grafik hazırlanıyor" description="Geçmiş fiyatlar ücretsiz kaynaktan alınıyor." />}{storageError && <p role="alert">{storageError}</p>}{transactions.length > 0 && <p className="muted">{transactions.length} yerel işlem · {averageCost !== null && quote ? `Kalan pozisyonun komisyon dahil FIFO maliyeti: ${formatMoney(averageCost, quote.currency)}` : "Açık pozisyon yoksa veya işlem ve grafik para birimleri farklıysa maliyet çizilmez."} Bölünme düzeltmeleri işlem adetleriyle eşleşmelidir.</p>}</Card>
      <div className="grid grid-2 section-gap"><Card><div className="card-title"><div><h2>Dönemsel performans</h2><p>Tek seferlik fiyat değişimi; DCA sonucu değildir</p></div></div><table className="data-table"><tbody>{[1,3,5,10].map((year) => <tr key={year}><td>{year} yıl</td><td className={`number ${performance(year) >= 0 ? "positive" : "negative"}`}><strong>{formatPercent(performance(year))}</strong></td></tr>)}</tbody></table></Card><Card><div className="card-title"><div><h2>Sinyal kırılımı</h2><p>Yapay zekâ yorumu kullanılmaz</p></div></div>{signal.reasons.map((reason) => <p key={reason} className="muted"><DatabaseZap size={14} style={{ display: "inline", marginRight: 8 }} />{reason}</p>)}<div className="notice"><p>Değerleme oranı için güvenilir point-in-time veri bulunmadığında fiyat/SMA sinyali tek başına gösterilir ve güven düşürülür.</p></div></Card></div>
    </>}
  </div>;
}
