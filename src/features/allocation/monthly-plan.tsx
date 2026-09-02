"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CircleHelp, RefreshCw, ShieldCheck } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import { buildHybridAllocation } from "@/lib/domain/allocation";
import { convertTrySeriesToUsd, optimizeBalancedConsensus, valueAtOrBefore } from "@/lib/domain/backtest";
import { ASSET_CLASSES, DEFAULT_MONTHLY_BUDGET, NEUTRAL_WEIGHTS } from "@/lib/domain/config";
import { deriveBitcoinMacroSignal, derivePriceSignal, type PriceSignal } from "@/lib/domain/signals";
import type { AssetClass, AssetClassRecord, PricePoint } from "@/lib/domain/types";
import { formatMoney, formatUnsignedPercent } from "@/lib/format";
import { settingsRepository } from "@/lib/storage/settings-repository";

const proxies: Record<AssetClass, { symbol: string; label: string; scale: number }> = {
  foreignEquity: { symbol: "SP500", label: "S&P 500 / ABD büyük şirketleri", scale: 1 },
  commodity: { symbol: "GOLD", label: "Altın", scale: 0.8 },
  bitcoin: { symbol: "BTC", label: "Bitcoin", scale: 1.8 },
  turkishEquity: { symbol: "BIST100", label: "BIST 100", scale: 1.2 },
};

const monthLabel = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(new Date()).toLocaleUpperCase("tr-TR");

function weeklyPoints(points: PricePoint[]) {
  const byWeek = new Map<string, PricePoint>();
  points.forEach((point) => {
    const date = new Date(point.date);
    const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    const week = Math.ceil((((date.getTime() - firstThursday.getTime()) / 86_400_000) + firstThursday.getUTCDay() + 1) / 7);
    byWeek.set(`${date.getUTCFullYear()}-${week}`, point);
  });
  return [...byWeek.values()];
}

function monthlyPoints(points: PricePoint[]) {
  return [...points.reduce((byMonth, point) => byMonth.set(point.date.slice(0, 7), point), new Map<string, PricePoint>()).values()];
}

export function MonthlyPlan() {
  const [budget, setBudget] = useState(DEFAULT_MONTHLY_BUDGET);
  const [signals, setSignals] = useState<Partial<Record<AssetClass, PriceSignal>>>({});
  const [balancedWeights, setBalancedWeights] = useState<AssetClassRecord>({ ...NEUTRAL_WEIGHTS });
  const [balancedPeriods, setBalancedPeriods] = useState<number[]>([]);
  const [usdTryRate, setUsdTryRate] = useState<number>();
  const [modelWarning, setModelWarning] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setModelWarning("");
    const m2Promise = fetch("/api/market/macro-history?series=M2SL")
      .then(async (response) => {
        const payload = await response.json() as { points?: PricePoint[] };
        return response.ok && payload.points ? payload.points : [];
      })
      .catch(() => [] as PricePoint[]);
    const historyEntries = await Promise.all(ASSET_CLASSES.map(async (assetClass) => {
      try {
        const proxy = proxies[assetClass];
        const response = await fetch(`/api/market/history?symbol=${proxy.symbol}&range=max`);
        const payload = await response.json() as { points?: PricePoint[] };
        if (!response.ok || !payload.points) throw new Error("veri yok");
        return [assetClass, payload.points] as const;
      } catch {
        return [assetClass, [] as PricePoint[]] as const;
      }
    }));
    const [fxHistoryResponse, fxQuoteResponse] = await Promise.all([
      fetch("/api/market/history?symbol=USDTRY&range=max").catch(() => undefined),
      fetch("/api/market/quotes?symbols=USDTRY").catch(() => undefined),
    ]);
    const fxHistoryPayload = fxHistoryResponse ? await fxHistoryResponse.json() as { points?: PricePoint[] } : {};
    const fxQuotePayload = fxQuoteResponse ? await fxQuoteResponse.json() as { USDTRY?: { ok?: boolean; data?: { price?: number } } } : {};
    if (!fxHistoryResponse?.ok || !fxHistoryPayload.points?.length) {
      setSignals({});
      setBalancedWeights({ ...NEUTRAL_WEIGHTS });
      setBalancedPeriods([]);
      setUsdTryRate(undefined);
      setModelWarning("USD/TRY geçmişi alınamadı; hatalı para birimi karşılaştırması yapmamak için model nötr dağılıma döndü.");
      setLoading(false);
      return;
    }
    const liveRate = fxQuotePayload.USDTRY?.data?.price ?? fxHistoryPayload.points.at(-1)?.close;
    setUsdTryRate(liveRate && liveRate > 0 ? liveRate : undefined);
    const rawTrySeries = Object.fromEntries(historyEntries) as Record<AssetClass, PricePoint[]>;
    const rawSeries: Record<AssetClass, PricePoint[]> = {
      ...rawTrySeries,
      turkishEquity: convertTrySeriesToUsd(rawTrySeries.turkishEquity, fxHistoryPayload.points),
    };
    const m2 = await m2Promise;
    const signalEntries = ASSET_CLASSES.map((assetClass) => {
      const weekly = weeklyPoints(rawSeries[assetClass]);
      const signal = assetClass === "bitcoin"
        ? deriveBitcoinMacroSignal(weekly, m2)
        : derivePriceSignal(weekly.map((point) => point.close), proxies[assetClass].scale);
      return [assetClass, signal] as const;
    });
    setSignals(Object.fromEntries(signalEntries));
    try {
      const series = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, monthlyPoints(rawSeries[assetClass])])) as Record<AssetClass, PricePoint[]>;
      const consensus = optimizeBalancedConsensus({
        monthlyContribution: 1,
        contributionForDate: (date) => 1 / (valueAtOrBefore(fxHistoryPayload.points!, date) ?? 1),
        series,
      });
      setBalancedWeights(consensus.weights);
      setBalancedPeriods(consensus.periods);
      if (consensus.periods.length < 4) setModelWarning("Bazı uzun dönemler için ortak veri bulunamadı; dengeli optimum yalnızca tamamlanan dönemlerden hesaplandı.");
    } catch (error) {
      setBalancedWeights({ ...NEUTRAL_WEIGHTS });
      setBalancedPeriods([]);
      setModelWarning(error instanceof Error ? `${error.message} Dengeli tarafta nötr dağılım kullanıldı.` : "Dengeli optimum hesaplanamadı; nötr dağılım kullanıldı.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void settingsRepository.get().then((settings) => setBudget(settings.monthlyBudget));
    void Promise.resolve().then(load);
  }, [load]);

  const allocation = useMemo(() => {
    const score = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, signals[assetClass]?.score ?? 0])) as AssetClassRecord;
    const confidence = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, signals[assetClass]?.confidence ?? 0.25])) as AssetClassRecord;
    return buildHybridAllocation({ monthlyBudget: budget, signals: score, confidence, balancedWeights });
  }, [balancedWeights, budget, signals]);

  return <div>
    <PageHeader eyebrow={monthLabel} title="Bu ayın birikim rotası" description="Çok dönemli dengeli optimum ile güncel piyasa sinyali eşit ağırlıkla birleştirilir. Bu bir karar desteğidir; kazanç garantisi değildir." actions={<button className="button secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={17} />{loading ? "Modeller hesaplanıyor" : "Yenile"}</button>} />
    <div className="split-hero">
      <Card className="hero-panel">
        <span className="pill"><ShieldCheck size={14} />İki model uzlaşısı</span>
        <p className="hero-amount">{formatMoney(budget)}</p>
        <p className="metric-meta" data-testid="monthly-budget-usd">{usdTryRate ? formatMoney(budget / usdTryRate, "USD") : "USD karşılığı alınamadı"}</p>
        <p className="muted">Bu ay portföye eklenecek toplam tutar · canlı USD/TRY karşılığı</p>
        <div className="chart-legend">
          <span>Dengeli optimum <strong>%50</strong></span>
          <span>Güncel dinamik <strong>%50</strong></span>
          <span>Veri güveni <strong>{formatUnsignedPercent(allocation.confidence, 0)}</strong></span>
          <span>Model para birimi <strong>USD</strong></span>
          <span>Satış <strong>kapalı</strong></span>
        </div>
      </Card>
      <Card>
        <div className="card-title"><div><h2>Hibrit dağılım özeti</h2><p>İki modelin eşit birleşiminden çıkan uygulanabilir oranlar</p></div></div>
        <div className="progress" style={{ height: 18, display: "flex" }} aria-label="Önerilen hibrit varlık sınıfı dağılımı">
          {allocation.items.map((item, index) => <span key={item.assetClass} title={`${item.label} ${formatUnsignedPercent(item.weight)}`} style={{ width: `${item.weight * 100}%`, background: `var(--chart-${index + 1})` }} />)}
        </div>
        <div className="chart-legend">{allocation.items.map((item, index) => <span key={item.assetClass}><i className="legend-dot" style={{ background: `var(--chart-${index + 1})` }} />{item.label} {formatUnsignedPercent(item.weight)}</span>)}</div>
        <div className="notice section-gap"><CircleHelp size={20} /><p>Dengeli optimum {balancedPeriods.length ? balancedPeriods.map((period) => `${period / 12} yıl`).join(", ") : "mevcut"} dönemlerinden USD bazında ortak tabanı kurar. Yabancı hisse sınıfı yalnızca S&P 500’dür; BIST geçmişi tarihsel USD/TRY ile dolara çevrilir. Güncel dinamik model fiyat trendini; Bitcoin için ayrıca BTC/M2 ve haftalık SMA200 rejimini değerlendirir.</p></div>
      </Card>
    </div>
    {modelWarning ? <div className="notice section-gap"><p><strong>Veri notu:</strong> {modelWarning}</p></div> : null}
    <Card className="section-gap">
      <div className="card-title"><div><h2>Uygulanabilir alış listesi</h2><p>Tutarlar tam {formatMoney(budget)} olacak şekilde yuvarlandı; dolar karşılıkları canlı USD/TRY ile gösterilir</p></div></div>
      {allocation.items.map((item, index) => {
        const detail = signals[item.assetClass];
        const balanced = allocation.balancedWeights[item.assetClass];
        const dynamic = allocation.dynamicWeights[item.assetClass];
        const rawBlend = (balanced + dynamic) / 2;
        const deltaPoints = (item.weight - item.neutralWeight) * 100;
        const isMore = deltaPoints > 0.75;
        const isLess = deltaPoints < -0.75;
        const action = isMore
          ? `Nötr oranın ${deltaPoints.toFixed(1)} puan üzerinde: bu ay görece daha fazla al.`
          : isLess
            ? `Nötr oranın ${Math.abs(deltaPoints).toFixed(1)} puan altında: bu ay görece daha az al; bu bir satış önerisi değildir.`
            : "Nötr uzun vadeli orana yakın: bu ay dengeli alımı koru.";
        const modelEffect = dynamic > balanced + 0.005
          ? "Güncel piyasa sinyali, tarihsel optimum tabanın üzerine çıkardı."
          : dynamic < balanced - 0.005
            ? "Güncel piyasa sinyali, tarihsel optimum tabanı aşağı çekti."
            : "İki model bu varlıkta birbirine yakın sonuç verdi.";
        const summary = isMore ? "Neden bu ay daha fazla?" : isLess ? "Neden bu ay daha az?" : "Neden bu oran?";
        return <div className="allocation-row" key={item.assetClass}>
          <div><div className="allocation-name">{item.label}</div><div className="allocation-note">Optimum {formatUnsignedPercent(balanced, 0)} · Dinamik {formatUnsignedPercent(dynamic, 0)} · Nötr {formatUnsignedPercent(item.neutralWeight, 0)}</div></div>
          <div className="progress"><span style={{ width: `${item.weight * 100}%`, background: `var(--chart-${index + 1})` }} /></div>
          <strong>{formatUnsignedPercent(item.weight, 1)}</strong>
          <div className="number"><strong>{formatMoney(item.amount)}</strong><div className="confidence">{usdTryRate ? formatMoney(item.amount / usdTryRate, "USD") : "USD karşılığı yok"} · Fırsat {item.signal >= 0 ? "+" : ""}{Math.round(item.signal * 100)}/100 · Veri güveni {formatUnsignedPercent(item.confidence, 0)}</div></div>
          <details style={{ gridColumn: "1 / -1" }}><summary className="muted">{summary}</summary><div className="muted"><p><strong>Karar:</strong> {action}</p><p><strong>Hesap:</strong> Dengeli optimum {formatUnsignedPercent(balanced, 1)} × %50 + güncel dinamik {formatUnsignedPercent(dynamic, 1)} × %50 = ham {formatUnsignedPercent(rawBlend, 1)}; sınıf risk sınırları uygulandıktan sonra nihai {formatUnsignedPercent(item.weight, 1)}. {modelEffect}</p><p><strong>Güncel göstergeler:</strong> {detail?.reasons.join(" ") ?? "Canlı geçmiş veri alınamadığı için dinamik taraf nötr ağırlığa yaklaştırıldı."}</p></div></details>
        </div>;
      })}
    </Card>
    <div className="grid grid-2 section-gap">
      <Card><div className="card-title"><div><h3>Portföyünü hesaba kat</h3><p>Yeni katkıyı satış yapmadan eksik sınıflara yönlendir</p></div></div><Link className="button primary" href="/portfoyum">Portföyümü aç <ArrowRight size={16} /></Link></Card>
      <Card><div className="card-title"><div><h3>Metodolojiyi incele</h3><p>Hibrit model, sinyal katsayıları, sınırlar ve veri kaynakları</p></div></div><Link className="button secondary" href="/arastirma">Nasıl hesaplandı? <ArrowRight size={16} /></Link></Card>
    </div>
  </div>;
}
