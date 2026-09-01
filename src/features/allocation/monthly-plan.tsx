"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CircleHelp, RefreshCw, ShieldCheck } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import { buildAllocation } from "@/lib/domain/allocation";
import { DEFAULT_MONTHLY_BUDGET } from "@/lib/domain/config";
import { derivePriceSignal, type PriceSignal } from "@/lib/domain/signals";
import type { AssetClass, AssetClassRecord, PricePoint } from "@/lib/domain/types";
import { formatMoney, formatPercent } from "@/lib/format";
import { settingsRepository } from "@/lib/storage/settings-repository";

const proxies: Record<AssetClass, { symbol: string; label: string; scale: number }> = {
  foreignEquity: { symbol: "VT", label: "VT / dünya hisseleri", scale: 1 },
  commodity: { symbol: "GOLD", label: "Altın", scale: 0.8 },
  bitcoin: { symbol: "BTC", label: "Bitcoin", scale: 1.8 },
  turkishEquity: { symbol: "BIST100", label: "BIST 100", scale: 1.2 },
};

function weeklyCloses(points: PricePoint[]) {
  const byWeek = new Map<string, number>();
  points.forEach((point) => {
    const date = new Date(point.date);
    const week = `${date.getUTCFullYear()}-${Math.floor((date.getUTCDate() + 6 + new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).getUTCDay()) / 7)}-${date.getUTCMonth()}`;
    byWeek.set(week, point.close);
  });
  return [...byWeek.values()];
}

export function MonthlyPlan() {
  const [budget, setBudget] = useState(DEFAULT_MONTHLY_BUDGET);
  const [signals, setSignals] = useState<Partial<Record<AssetClass, PriceSignal>>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const entries = await Promise.all(Object.entries(proxies).map(async ([assetClass, proxy]) => {
      try {
        const response = await fetch(`/api/market/history?symbol=${proxy.symbol}&range=5y`);
        const payload = await response.json() as { points?: PricePoint[] };
        if (!response.ok || !payload.points) throw new Error("veri yok");
        return [assetClass, derivePriceSignal(weeklyCloses(payload.points), proxy.scale)] as const;
      } catch { return [assetClass, undefined] as const; }
    }));
    setSignals(Object.fromEntries(entries));
    setLoading(false);
  }, []);

  useEffect(() => { void settingsRepository.get().then((settings) => setBudget(settings.monthlyBudget)); void Promise.resolve().then(load); }, [load]);
  const allocation = useMemo(() => {
    const score = Object.fromEntries(Object.keys(proxies).map((key) => [key, signals[key as AssetClass]?.score ?? 0])) as AssetClassRecord;
    const confidence = Object.fromEntries(Object.keys(proxies).map((key) => [key, signals[key as AssetClass]?.confidence ?? 0.25])) as AssetClassRecord;
    return buildAllocation({ monthlyBudget: budget, signals: score, confidence });
  }, [budget, signals]);

  return <div>
    <PageHeader eyebrow="Eylül 2026" title="Bu ayın birikim rotası" description="Piyasa trendi, veri güveni ve sınıf sınırları birlikte değerlendirilir. Son karar her zaman sana aittir." actions={<button className="button secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={17} />{loading ? "Veri alınıyor" : "Yenile"}</button>} />
    <div className="split-hero">
      <Card className="hero-panel">
        <span className="pill"><ShieldCheck size={14} />Açıklanabilir dağılım</span>
        <p className="hero-amount">{formatMoney(budget)}</p>
        <p className="muted">Bu ay portföye eklenecek toplam tutar</p>
        <div className="chart-legend">
          <span>Toplam güven: <strong>{formatPercent(allocation.confidence, 0)}</strong></span>
          <span>Turnover sınırı: <strong>10 puan</strong></span>
          <span>Satış: <strong>varsayılan kapalı</strong></span>
        </div>
      </Card>
      <Card>
        <div className="card-title"><div><h2>Dağılım özeti</h2><p>Her renk bir varlık sınıfını gösterir</p></div></div>
        <div className="progress" style={{ height: 18, display: "flex" }} aria-label="Önerilen varlık sınıfı dağılımı">
          {allocation.items.map((item, index) => <span key={item.assetClass} title={`${item.label} ${formatPercent(item.weight)}`} style={{ width: `${item.weight * 100}%`, background: `var(--chart-${index + 1})` }} />)}
        </div>
        <div className="chart-legend">{allocation.items.map((item, index) => <span key={item.assetClass}><i className="legend-dot" style={{ background: `var(--chart-${index + 1})` }} />{item.label} {formatPercent(item.weight)}</span>)}</div>
        <div className="notice section-gap"><CircleHelp size={20} /><p>Düşük güvenli veri, nötr ağırlıktan büyük sapmaları otomatik olarak bastırır.</p></div>
      </Card>
    </div>
    <Card className="section-gap">
      <div className="card-title"><div><h2>Uygulanabilir alış listesi</h2><p>Tutarlar tam {formatMoney(budget)} olacak şekilde yuvarlandı</p></div></div>
      {allocation.items.map((item, index) => {
        const detail = signals[item.assetClass];
        return <div className="allocation-row" key={item.assetClass}>
          <div><div className="allocation-name">{item.label}</div><div className="allocation-note">{proxies[item.assetClass].label} sinyali · Nötr {formatPercent(item.neutralWeight, 0)}</div></div>
          <div className="progress"><span style={{ width: `${item.weight * 100}%`, background: `var(--chart-${index + 1})` }} /></div>
          <strong>{formatPercent(item.weight, 1)}</strong>
          <div className="number"><strong>{formatMoney(item.amount)}</strong><div className="confidence">Güven {formatPercent(item.confidence, 0)}</div></div>
          <details style={{ gridColumn: "1 / -1" }}><summary className="muted">Neden bu oran?</summary><p className="muted">{item.explanation} {detail?.reasons.join(" ") ?? "Canlı geçmiş veri alınamadığı için nötr ağırlık korundu."}</p></details>
        </div>;
      })}
    </Card>
    <div className="grid grid-2 section-gap">
      <Card><div className="card-title"><div><h3>Portföyünü hesaba kat</h3><p>Yeni katkıyı satış yapmadan eksik sınıflara yönlendir</p></div></div><Link className="button primary" href="/portfoyum">Portföyümü aç <ArrowRight size={16} /></Link></Card>
      <Card><div className="card-title"><div><h3>Metodolojiyi incele</h3><p>Sinyal katsayıları, sınırlar ve veri kaynakları</p></div></div><Link className="button secondary" href="/arastirma">Nasıl hesaplandı? <ArrowRight size={16} /></Link></Card>
    </div>
  </div>;
}
