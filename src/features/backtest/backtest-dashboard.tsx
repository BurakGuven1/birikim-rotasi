"use client";

import { useCallback, useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { runAllocationBacktest, runDcaBacktest, type BacktestResult } from "@/lib/domain/backtest";
import { buildAllocation } from "@/lib/domain/allocation";
import { derivePriceSignal } from "@/lib/domain/signals";
import type { AssetClass, AssetClassRecord, PricePoint } from "@/lib/domain/types";
import { formatMoney, formatPercent } from "@/lib/format";

const assets: Record<AssetClass, { symbol: string; label: string; color: string }> = {
  foreignEquity: { symbol: "VT", label: "Dünya hisseleri", color: "#315f9d" }, commodity: { symbol: "GOLD", label: "Altın", color: "#b7791f" }, bitcoin: { symbol: "BTC", label: "Bitcoin", color: "#6941c6" }, turkishEquity: { symbol: "BIST100", label: "BIST 100", color: "#087a61" },
};

const monthly = (points: PricePoint[]) => [...points.reduce((map, point) => map.set(point.date.slice(0, 7), point), new Map<string, PricePoint>()).values()];

export function BacktestDashboard() {
  const [period, setPeriod] = useState("5y"); const [contribution, setContribution] = useState(50_000); const [results, setResults] = useState<Array<{ name: string; result: BacktestResult; color: string }>>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const run = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const entries = await Promise.all(Object.entries(assets).map(async ([key, asset]) => {
        const response = await fetch(`/api/market/history?symbol=${asset.symbol}&range=${period}`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error); return [key, monthly(payload.points)] as const;
      }));
      const series = Object.fromEntries(entries) as Record<AssetClass, PricePoint[]>;
      const singles = Object.entries(assets).map(([key, asset]) => ({ name: asset.label, color: asset.color, result: runDcaBacktest({ monthlyContribution: contribution, prices: series[key as AssetClass] }) }));
      const neutral = runAllocationBacktest({ monthlyContribution: contribution, series, allocate: () => ({ foreignEquity: .35, commodity: .25, bitcoin: .2, turkishEquity: .2 }) });
      const dynamic = runAllocationBacktest({ monthlyContribution: contribution, series, allocate: (history) => {
        const signal = Object.fromEntries(Object.keys(assets).map((key) => [key, derivePriceSignal(history[key as AssetClass].map((point) => point.close), key === "bitcoin" ? 1.8 : 1).score])) as AssetClassRecord;
        const confidence = Object.fromEntries(Object.keys(assets).map((key) => [key, Math.min(1, history[key as AssetClass].length / 60)])) as AssetClassRecord;
        return Object.fromEntries(buildAllocation({ monthlyBudget: contribution, signals: signal, confidence }).items.map((item) => [item.assetClass, item.weight])) as AssetClassRecord;
      } });
      setResults([{ name: "Sabit nötr sepet", result: neutral, color: "#152030" }, { name: "SMA dinamik sepet", result: dynamic, color: "#c2414b" }, ...singles]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Backtest verisi alınamadı."); setResults([]); }
    finally { setLoading(false); }
  }, [contribution, period]);
  useEffect(() => { void Promise.resolve().then(run); }, [run]);
  const chartData = results[0]?.result.series.map((point, index) => Object.fromEntries([["date", point.date.slice(0, 7)], ...results.map((entry) => [entry.name, entry.result.series[index]?.value ?? null])])) ?? [];
  return <div>
    <PageHeader eyebrow="Geçmiş performans" title="Düzenli alım backtesti" description="Her ay aynı tutarın yatırıldığı stratejileri karşılaştır. Geçmiş sonuç gelecekteki getiriyi garanti etmez." actions={<><select className="select" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Backtest dönemi"><option value="1y">1 yıl</option><option value="3y">3 yıl</option><option value="5y">5 yıl</option><option value="10y">10 yıl</option></select><input className="input" type="number" min="1000" step="1000" value={contribution} onChange={(e) => setContribution(Number(e.target.value))} aria-label="Aylık katkı" /><button className="button primary" onClick={() => void run()}>Hesapla</button></>} />
    {loading ? <Card><EmptyState title="Backtest hesaplanıyor" description="Geçmiş fiyatlar ücretsiz kaynaklardan alınıyor." /></Card> : error ? <Card><EmptyState title="Backtest tamamlanamadı" description={error} /></Card> : <>
      <div className="grid grid-3">{results.slice(0, 3).map((entry) => <Card className="metric-card" key={entry.name}><div className="metric-label">{entry.name}</div><div className="metric-value">{formatMoney(entry.result.finalValue)}</div><div className="metric-meta"><span className={entry.result.totalReturn >= 0 ? "positive" : "negative"}>{formatPercent(entry.result.totalReturn)} toplam</span> · {formatMoney(entry.result.totalInvested)} yatırım</div></Card>)}</div>
      <Card className="section-gap"><div className="card-title"><div><h2>Portföy değeri karşılaştırması</h2><p>Aylık katkılar dahil nominal değer</p></div></div><div className="chart-box" style={{ height: 380 }}><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="date" tick={{ fill: "var(--muted)", fontSize: 11 }} /><YAxis tickFormatter={(v) => `${Math.round(v / 1000)}K`} tick={{ fill: "var(--muted)", fontSize: 11 }} /><Tooltip formatter={(value) => formatMoney(Number(value))} /><Legend />{results.map((entry, index) => <Line key={entry.name} dataKey={entry.name} stroke={entry.color} strokeWidth={index < 2 ? 3 : 1.5} strokeDasharray={index === 1 ? "6 4" : undefined} dot={false} />)}</LineChart></ResponsiveContainer></div></Card>
      <Card className="section-gap"><div className="card-title"><div><h2>Strateji ölçümleri</h2><p>Fiyat tabanlı; vergi ve ürün bazlı tüm maliyetler dahil değildir</p></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Strateji</th><th className="number">Yatırılan</th><th className="number">Son değer</th><th className="number">Toplam getiri</th><th className="number">Yıllıklandırılmış</th><th className="number">Maks. düşüş</th><th className="number">Volatilite</th></tr></thead><tbody>{results.map((entry) => <tr key={entry.name}><td><strong>{entry.name}</strong></td><td className="number">{formatMoney(entry.result.totalInvested)}</td><td className="number">{formatMoney(entry.result.finalValue)}</td><td className="number">{formatPercent(entry.result.totalReturn)}</td><td className="number">{formatPercent(entry.result.annualizedReturn)}</td><td className="number negative">{formatPercent(entry.result.maximumDrawdown)}</td><td className="number">{formatPercent(entry.result.volatility)}</td></tr>)}</tbody></table></div></Card>
      <div className="notice section-gap"><p>Çoklu sinyal backtesti yalnızca fiyat/SMA bileşenlerini kullanır. Tarihsel point-in-time F/K ve benzeri değerlemeler ücretsiz ve güvenilir biçimde bulunmadığı için bugünkü oranlar geçmişe taşınmamıştır.</p></div>
    </>}
  </div>;
}
