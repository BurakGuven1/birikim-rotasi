"use client";

import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui";
import { buildPortfolioHistory, type HistorySeries } from "@/lib/domain/portfolio-history";
import type { MarketSnapshot, Transaction } from "@/lib/domain/types";
import { formatMoney } from "@/lib/format";

export function PortfolioHistoryChart({ transactions, quotes }: { transactions: Transaction[]; quotes: Record<string, MarketSnapshot> }) {
  const [requested, setRequested] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; series: Record<string, HistorySeries>; errors: string[] }>();
  const [period, setPeriod] = useState(0);
  const symbols = [...new Set([...transactions.map(t => t.symbol), "USDTRY"])].sort();
  const firstDate = transactions.map(t => t.date.slice(0, 10)).sort()[0];
  const through = new Date().toISOString().slice(0, 10);
  const requestKey = JSON.stringify({ symbols, firstDate, through, attempt });
  useEffect(() => {
    if (!requested || !firstDate) return;
    const controller = new AbortController();
    const request = JSON.parse(requestKey) as { symbols: string[]; firstDate: string; through: string };
    const series: Record<string, HistorySeries> = {};
    const errors: string[] = [];
    const queue = [...request.symbols];
    const from = new Date(Date.parse(request.firstDate) - 4 * 86_400_000).toISOString();
    const worker = async () => {
      while (queue.length && !controller.signal.aborted) {
        const symbol = queue.shift()!;
        try {
          const params = new URLSearchParams({ symbol, range: "max", from, to: `${request.through}T23:59:59.999Z`, allowPartial: "true" });
          const response = await fetch(`/api/market/history?${params}`, { signal: controller.signal });
          const data = await response.json();
          if (!response.ok || !Array.isArray(data.points)) throw new Error(data.error ?? "Geçmiş alınamadı");
          series[symbol] = { points: data.points, source: data.source };
          if (data.coverage?.partial) errors.push(`${symbol}: tarihçe kapsamı kısmi`);
        } catch (error) {
          if (!controller.signal.aborted) errors.push(`${symbol}: ${error instanceof Error ? error.message : "Veri alınamadı"}`);
        }
      }
    };
    void Promise.all([worker(), worker(), worker()]).then(() => {
      if (!controller.signal.aborted) setLoaded({ key: requestKey, series, errors });
    });
    return () => controller.abort();
  }, [requested, requestKey, firstDate]);

  const result = useMemo(() => {
    if (!loaded || loaded.key !== requestKey) return { rows: [], error: "" };
    const histories = Object.fromEntries(Object.entries(loaded.series).map(([symbol, history]) => [symbol, { ...history, currency: quotes[symbol]?.currency }]));
    try { return { rows: buildPortfolioHistory(transactions, histories, loaded.series.USDTRY?.points ?? [], through), error: "" }; }
    catch (error) { return { rows: [], error: error instanceof Error ? error.message : "Geçmiş hesaplanamadı" }; }
  }, [loaded, requestKey, quotes, transactions, through]);
  const loading = requested && loaded?.key !== requestKey;
  const cutoff = period ? new Date(Date.parse(through) - period * 86_400_000).toISOString().slice(0, 10) : "";
  const rows = result.rows.filter(row => row.date >= cutoff);
  const latest = result.rows.findLast(row => row.value !== null && row.invested !== null);
  const missing = rows.filter(row => row.value === null || row.invested === null).length;
  return <Card className="section-gap">
    <div className="card-title"><div><h2>Portföyün zaman içindeki gelişimi</h2><p>İşlem gününün kuru ve günlük kapanışlarla · TL</p></div><button className="button secondary" disabled={loading} onClick={() => { setRequested(true); setAttempt(value => value + 1); }}>{loading ? "Geçmiş yükleniyor…" : requested ? "Geçmişi yenile" : "Portföy geçmişini hesapla"}</button></div>
    {!requested && <p className="muted">Net yatırılan para, eldeki varlıkların değeri ve toplam kazancı karşılaştır. Geçmiş fiyatlar bu düğmeyle yüklenir.</p>}
    {result.error && <p role="alert">{result.error}</p>}
    {requested && !loading && loaded && <>
      {loaded.errors.length > 0 && <div className="notice"><p>{loaded.errors.join(" · ")}</p></div>}
      {latest && <p><strong>{latest.date}</strong> · Net yatırılan {formatMoney(latest.invested!)} · Varlık değeri {formatMoney(latest.value!)} · Kazanç {formatMoney(latest.profit!)}</p>}
      <div className="chart-controls" aria-label="Portföy grafik dönemi">{[[90, "3 ay"], [365, "1 yıl"], [1095, "3 yıl"], [0, "Tümü"]].map(([days, label]) => <button key={days} className={`button small ${period === days ? "primary" : "secondary"}`} aria-pressed={period === days} onClick={() => setPeriod(Number(days))}>{label}</button>)}</div>
      {rows.some(row => row.value !== null || row.invested !== null) ? <div className="chart-box"><ResponsiveContainer width="100%" height="100%"><LineChart data={rows}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="date" minTickGap={40} tickFormatter={date => rows.length <= 90 ? date.slice(5) : date.slice(0, 7)} /><YAxis tickFormatter={value => `${Math.round(value / 1000)}K`} width={65} /><Tooltip formatter={value => value == null ? "Veri yok" : formatMoney(Number(value))} /><Legend /><Line name="Net yatırılan" type="stepAfter" dataKey="invested" stroke="#b7791f" strokeDasharray="6 4" dot={false} isAnimationActive={false} connectNulls={false} /><Line name="Varlık değeri" dataKey="value" stroke="#315f9d" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} /><Line name="Toplam kazanç" dataKey="profit" stroke="#087a61" dot={false} isAnimationActive={false} connectNulls={false} /></LineChart></ResponsiveContainer></div> : <p>Bu dönem için yeterli fiyat ve kur verisi yok.</p>}
      {missing > 0 && <p className="muted">{missing} günde fiyat veya kur eksik; ilgili çizgiler boş bırakıldı. EUR dönüşümü desteklenmiyor.</p>}
      <p className="muted">Satış gelirleri net yatırılan tutardan düşülür; hesapta nakit tutulduğu varsayılmaz. Tatillerde en fazla 4 gün önceki kapanış kullanılır. Temettü, vergi ve kayıtlarda bulunmayan bölünmeler dahil değildir; sağlayıcının bölünme düzeltmesi adetlerle uyuşmayabilir.</p>
      <p className="muted">Kaynaklar: {[...new Set(Object.values(loaded.series).map(series => series.source).filter(Boolean))].join(", ") || "Veri alınamadı"}</p>
    </>}
  </Card>;
}
