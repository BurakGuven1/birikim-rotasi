"use client";

import { useCallback, useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import {
  applyUsdInflation,
  buildAnnualContributionSchedule,
  convertTrySeriesToUsd,
  optimizeBalancedConsensus,
  runDcaBacktest,
  runWalkForwardAllocationBacktest,
  type BacktestResult,
} from "@/lib/domain/backtest";
import { blendAllocationWeights, buildAllocation } from "@/lib/domain/allocation";
import { ASSET_CLASSES, NEUTRAL_WEIGHTS } from "@/lib/domain/config";
import { deriveBitcoinMacroSignal, derivePriceSignal } from "@/lib/domain/signals";
import { DEFAULT_STRATEGY_PROFILE } from "@/lib/domain/strategy";
import { runCoreTacticalBacktest } from "@/lib/domain/tactical-backtest";
import type { AssetClass, AssetClassRecord, PricePoint } from "@/lib/domain/types";
import { formatMoney, formatPercent } from "@/lib/format";
import { settingsRepository } from "@/lib/storage/settings-repository";

const assets: Record<AssetClass, { symbol: string; label: string; color: string }> = {
  foreignEquity: { symbol: "SP500", label: "S&P 500", color: "#315f9d" },
  commodity: { symbol: "GOLD", label: "Altın", color: "#b7791f" },
  bitcoin: { symbol: "BTC", label: "Bitcoin", color: "#6941c6" },
  turkishEquity: { symbol: "BIST100", label: "BIST 100", color: "#087a61" },
};

const periodMonths: Record<string, number> = { "1y": 12, "3y": 36, "5y": 60, "10y": 120 };
const monthly = (points: PricePoint[]) => [...points.reduce((map, point) => map.set(point.date.slice(0, 7), point), new Map<string, PricePoint>()).values()];

function weekly(points: PricePoint[]) {
  const weeks = new Map<string, PricePoint>();
  points.forEach((point) => {
    const date = new Date(point.date);
    const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    const week = Math.ceil((((date.getTime() - firstThursday.getTime()) / 86_400_000) + firstThursday.getUTCDay() + 1) / 7);
    weeks.set(`${date.getUTCFullYear()}-${week}`, point);
  });
  return [...weeks.values()];
}

interface StrategyEntry {
  name: string;
  result: BacktestResult;
  color: string;
  dash?: string;
  weights?: AssetClassRecord;
  primary?: boolean;
  tacticalStats?: { pnl: number; trades: number; winRate: number; benchmarkDelta: number };
}

export function BacktestDashboard() {
  const [period, setPeriod] = useState("5y");
  const [contribution, setContribution] = useState(1_000);
  const [annualContribution, setAnnualContribution] = useState(3_750);
  const [annualContributionMonth, setAnnualContributionMonth] = useState(1);
  const [tacticalShare, setTacticalShare] = useState(DEFAULT_STRATEGY_PROFILE.tacticalShare);
  const [perTradeRisk, setPerTradeRisk] = useState(DEFAULT_STRATEGY_PROFILE.perTradeRisk);
  const [minRiskReward, setMinRiskReward] = useState(DEFAULT_STRATEGY_PROFILE.minRiskReward);
  const [minConfidence, setMinConfidence] = useState(DEFAULT_STRATEGY_PROFILE.minConfidence);
  const [results, setResults] = useState<StrategyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const run = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const macroSeries = async (series: "M2SL" | "CPIAUCSL") => fetch(`/api/market/macro-history?series=${series}`)
        .then(async (response) => {
          const payload = await response.json() as { points?: PricePoint[]; error?: string };
          if (!response.ok || !payload.points?.length) throw new Error(payload.error ?? `${series} geçmişi alınamadı.`);
          return payload.points;
        });
      const m2Promise = macroSeries("M2SL");
      const cpiPromise = macroSeries("CPIAUCSL");
      const entries = await Promise.all(Object.entries(assets).map(async ([key, asset]) => {
        const response = await fetch(`/api/market/history?symbol=${asset.symbol}&range=max`);
        const payload = await response.json() as { points?: PricePoint[]; error?: string };
        if (!response.ok || !payload.points) throw new Error(payload.error ?? `${asset.label} geçmişi alınamadı.`);
        return [key, payload.points] as const;
      }));
      const fxResponse = await fetch("/api/market/history?symbol=USDTRY&range=max");
      const fxPayload = await fxResponse.json() as { points?: PricePoint[]; error?: string };
      if (!fxResponse.ok || !fxPayload.points?.length) throw new Error(fxPayload.error ?? "USD/TRY geçmişi alınamadı.");
      const fxHistory = fxPayload.points;
      const rawTrySeries = Object.fromEntries(entries) as Record<AssetClass, PricePoint[]>;
      const rawSeries: Record<AssetClass, PricePoint[]> = {
        ...rawTrySeries,
        turkishEquity: convertTrySeriesToUsd(rawTrySeries.turkishEquity, fxHistory),
      };
      const series = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, monthly(rawSeries[assetClass])])) as Record<AssetClass, PricePoint[]>;
      const [m2, cpi] = await Promise.all([m2Promise, cpiPromise]);
      const maxPeriods = periodMonths[period];
      const contributionForDate = buildAnnualContributionSchedule(contribution, annualContribution, annualContributionMonth);
      const inRealUsd = (result: BacktestResult) => applyUsdInflation(result, cpi);
      const singles = ASSET_CLASSES.map((assetClass) => ({
        name: assets[assetClass].label,
        color: assets[assetClass].color,
        result: inRealUsd(runDcaBacktest({ monthlyContribution: contribution, contributionForDate, prices: series[assetClass], maxPeriods })),
      }));
      const allocationCache = new Map<string, { dynamic: AssetClassRecord; hybrid: AssetClassRecord }>();
      const allocationAt = (history: Record<AssetClass, PricePoint[]>) => {
        const cutoff = history.foreignEquity.at(-1)?.date ?? "";
        if (!cutoff) return { dynamic: NEUTRAL_WEIGHTS, hybrid: NEUTRAL_WEIGHTS };
        const cached = allocationCache.get(cutoff);
        if (cached) return cached;
        const signalEntries = ASSET_CLASSES.map((assetClass) => {
          const available = weekly(rawSeries[assetClass].filter((point) => point.date <= cutoff));
          const signal = assetClass === "bitcoin"
            ? deriveBitcoinMacroSignal(available, m2.filter((point) => point.date <= cutoff))
            : derivePriceSignal(available.map((point) => point.close), assetClass === "commodity" ? .8 : assetClass === "turkishEquity" ? 1.2 : 1);
          return [assetClass, signal] as const;
        });
        const signals = Object.fromEntries(signalEntries.map(([assetClass, signal]) => [assetClass, signal.score])) as AssetClassRecord;
        const confidence = Object.fromEntries(signalEntries.map(([assetClass, signal]) => [assetClass, signal.confidence])) as AssetClassRecord;
        const dynamicWeights = Object.fromEntries(buildAllocation({ monthlyBudget: contribution, signals, confidence }).items.map((item) => [item.assetClass, item.weight])) as AssetClassRecord;
        const balancedWeights = history.foreignEquity.length >= 12
          ? optimizeBalancedConsensus({ monthlyContribution: contribution, contributionForDate, series: history }).weights
          : NEUTRAL_WEIGHTS;
        const allocations = { dynamic: dynamicWeights, hybrid: blendAllocationWeights(balancedWeights, dynamicWeights) };
        allocationCache.set(cutoff, allocations);
        return allocations;
      };
      const dynamic = inRealUsd(runWalkForwardAllocationBacktest({ monthlyContribution: contribution, contributionForDate, series, maxPeriods, allocate: (history) => allocationAt(history).dynamic }));
      const hybrid = inRealUsd(runWalkForwardAllocationBacktest({ monthlyContribution: contribution, contributionForDate, series, maxPeriods, allocate: (history) => allocationAt(history).hybrid }));
      const tacticalRaw = runCoreTacticalBacktest({
        monthlyContribution: contribution,
        annualContribution,
        annualContributionMonth,
        corePrices: rawSeries.foreignEquity,
        tacticalPrices: rawSeries.bitcoin,
        maxPeriods,
        profile: {
          ...DEFAULT_STRATEGY_PROFILE,
          monthlyContributionUsd: contribution,
          annualContributionUsd: annualContribution,
          annualContributionMonth,
          tacticalShare,
          reserveShare: 1 - DEFAULT_STRATEGY_PROFILE.coreShare - tacticalShare,
          perTradeRisk,
          minRiskReward,
          minConfidence,
        },
      });
      const tactical = inRealUsd(tacticalRaw);
      setResults([
        { name: "Çekirdek + kurallı swing", result: tactical, color: "#0f766e", primary: true, tacticalStats: { pnl: tacticalRaw.tacticalPnlUsd, trades: tacticalRaw.tradeCount, winRate: tacticalRaw.winRate, benchmarkDelta: tacticalRaw.benchmarkDelta } },
        { name: "Aylık plan · %70/%30 walk-forward", result: hybrid, color: "#2563eb", dash: "3 3" },
        { name: "BTC/M2 + SMA dinamik", result: dynamic, color: "#c2414b", dash: "7 4" },
        ...singles,
      ]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Backtest verisi alınamadı.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [annualContribution, annualContributionMonth, contribution, minConfidence, minRiskReward, perTradeRisk, period, tacticalShare]);

  useEffect(() => { void settingsRepository.get().then((settings) => {
    setContribution(settings.monthlyBudgetUsd);
    setAnnualContribution(settings.annualContributionUsd);
    setAnnualContributionMonth(settings.annualContributionMonth);
    setTacticalShare(settings.tacticalShare);
    setPerTradeRisk(settings.perTradeRisk);
    setMinRiskReward(settings.minRiskReward);
    setMinConfidence(settings.minConfidence);
  }); }, []);
  useEffect(() => { void Promise.resolve().then(run); }, [run]);

  const chartData = results[0]?.result.series.map((point) => Object.fromEntries([
    ["date", point.date.slice(0, 7)],
    ["ABD TÜFE koruma eşiği", point.inflationHurdle ?? null],
    ...results.map((entry) => [entry.name, entry.result.series.find((candidate) => candidate.date.slice(0, 7) === point.date.slice(0, 7))?.value ?? null]),
  ])) ?? [];
  const firstDate = results[0]?.result.series.at(0)?.date.slice(0, 7);
  const lastDate = results[0]?.result.series.at(-1)?.date.slice(0, 7);
  const exactUsdInvested = results[0]?.result.totalInvested ?? 0;

  return <div>
    <PageHeader eyebrow="Geçmiş performans · sabit USD" title="Düzenli alım backtesti" description="Aylık ve yıllık katkıyı; çekirdek portföy, maliyetli swing simülasyonu ve ABD enflasyon eşiğiyle aynı nakit akışında karşılaştırır." actions={<><select className="select" value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Backtest dönemi"><option value="1y">1 yıl</option><option value="3y">3 yıl</option><option value="5y">5 yıl</option><option value="10y">10 yıl</option></select><input className="input" type="number" min="1" step="50" value={contribution} onChange={(event) => setContribution(Number(event.target.value))} aria-label="Aylık USD katkısı" /><button className="button primary" onClick={() => void run()}>Hesapla</button></>} />
    {loading ? <Card><EmptyState title="Backtest hesaplanıyor" description="Geçmiş fiyatlar ücretsiz kaynaklardan alınıyor." /></Card> : error ? <Card><EmptyState title="Backtest tamamlanamadı" description={error} /></Card> : <>
      <div className="notice"><p><strong>{firstDate}–{lastDate}</strong> · tam <strong>{results[0]?.result.series.length} aylık alım</strong> · ayda <strong>{formatMoney(contribution, "USD")}</strong> + yılda <strong>{formatMoney(annualContribution, "USD")}</strong> · <strong data-testid="exact-invested">{formatMoney(exactUsdInvested, "USD")} yatırım</strong>. Bütün stratejiler aynı USD nakit akışıyla karşılaştırılır.</p></div>
      <div className="grid grid-4 section-gap">{results.filter((entry) => entry.primary).map((entry) => <Card className="metric-card" key={entry.name}><div className="metric-label">{entry.name}</div><div className="metric-value">{formatMoney(entry.result.finalValue, "USD")}</div><div className="metric-meta"><span className={(entry.result.realReturn ?? 0) >= 0 ? "positive" : "negative"}>{formatPercent(entry.result.realReturn ?? 0)} ABD enflasyonu sonrası</span> · {formatPercent(entry.result.totalReturn)} USD getiri</div>{entry.tacticalStats ? <div className="metric-meta">{entry.tacticalStats.trades} kapanan işlem · {formatMoney(entry.tacticalStats.pnl, "USD")} swing P/L · {formatPercent(entry.tacticalStats.winRate)} kazanma</div> : null}</Card>)}</div>
      <Card className="section-gap"><div className="card-title"><div><h2>USD portföy değeri karşılaştırması</h2><p>Gri kesikli çizgi, her tarihsel dolar katkısının ABD TÜFE ile korunması için gereken değeri gösterir</p></div></div><div className="chart-box" style={{ height: 420 }}><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="date" tick={{ fill: "var(--muted)", fontSize: 11 }} /><YAxis tickFormatter={(value) => `$${Math.round(value / 1000)}K`} tick={{ fill: "var(--muted)", fontSize: 11 }} /><Tooltip formatter={(value) => formatMoney(Number(value), "USD")} /><Legend /><Line dataKey="ABD TÜFE koruma eşiği" stroke="#7b8794" strokeWidth={2} strokeDasharray="4 5" dot={false} isAnimationActive={false} />{results.map((entry) => <Line key={entry.name} dataKey={entry.name} stroke={entry.color} strokeWidth={entry.primary ? 2.8 : 1.25} strokeDasharray={entry.dash} dot={false} isAnimationActive={false} />)}</LineChart></ResponsiveContainer></div></Card>
      <Card className="section-gap"><div className="card-title"><div><h2>Strateji ölçümleri</h2><p>USD bazlıdır; ABD TÜFE sonrası reel getiri ayrıca gösterilir. Vergi ve ürün maliyetleri dahil değildir.</p></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Strateji</th><th className="number">Yatırılan (USD)</th><th className="number">Son değer (USD)</th><th className="number">USD getiri</th><th className="number">Reel USD getiri</th><th className="number">Yıllık TWR</th><th className="number">Maks. düşüş</th><th className="number">Volatilite</th></tr></thead><tbody>{results.map((entry) => <tr key={entry.name}><td><strong>{entry.name}</strong></td><td className="number">{formatMoney(entry.result.totalInvested, "USD")}</td><td className="number">{formatMoney(entry.result.finalValue, "USD")}</td><td className="number">{formatPercent(entry.result.totalReturn)}</td><td className={`number ${(entry.result.realReturn ?? 0) >= 0 ? "positive" : "negative"}`}>{formatPercent(entry.result.realReturn ?? 0)}</td><td className="number">{formatPercent(entry.result.annualizedReturn)}</td><td className="number negative">{formatPercent(entry.result.maximumDrawdown)}</td><td className="number">{formatPercent(entry.result.volatility)}</td></tr>)}</tbody></table></div></Card>
      <div className="notice section-gap"><p><strong>Okuma notu:</strong> Swing satırında sinyal yalnızca o günün kapanışına kadar olan veriyle kurulur ve en erken sonraki barda işleme girer. Aynı barda stop ve hedef görülürse stop önce sayılır; varsayılan 8 baz puan spread ve işlem başına 0,50 $ komisyon düşülür. Geçmiş sonuç hedef bandının garantisi değildir. Walk-forward satırı da yalnızca bir önceki aya kadar mevcut fiyat ve M2 verisini kullanır.</p></div>
    </>}
  </div>;
}
