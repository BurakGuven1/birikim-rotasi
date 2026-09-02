"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import {
  applyUsdInflation,
  convertTrySeriesToUsd,
  optimizeStaticAllocation,
  runAllocationBacktest,
  runDcaBacktest,
  runPerfectForesightBacktest,
  valueAtOrBefore,
  type BacktestResult,
} from "@/lib/domain/backtest";
import { buildAllocation } from "@/lib/domain/allocation";
import { ASSET_CLASSES, ASSET_LABELS } from "@/lib/domain/config";
import { deriveBitcoinMacroSignal, derivePriceSignal } from "@/lib/domain/signals";
import type { AssetClass, AssetClassRecord, PricePoint } from "@/lib/domain/types";
import { formatMoney, formatPercent, formatUnsignedPercent } from "@/lib/format";

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
}

interface OracleChoice { date: string; assetClass: AssetClass; contribution: number }

function WeightLegend({ weights }: { weights: AssetClassRecord }) {
  return <div className="chart-legend">
    {ASSET_CLASSES.map((assetClass, index) => <span key={assetClass}><i className="legend-dot" style={{ background: `var(--chart-${index + 1})` }} />{ASSET_LABELS[assetClass]} <strong>{formatUnsignedPercent(weights[assetClass], 0)}</strong></span>)}
  </div>;
}

export function BacktestDashboard() {
  const [period, setPeriod] = useState("5y");
  const [contribution, setContribution] = useState(50_000);
  const [results, setResults] = useState<StrategyEntry[]>([]);
  const [oracleChoices, setOracleChoices] = useState<OracleChoice[]>([]);
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
      const contributionForDate = (date: string) => {
        const rate = valueAtOrBefore(fxHistory, date);
        if (!rate) throw new Error(`${date.slice(0, 7)} için USD/TRY kuru bulunamadı.`);
        return contribution / rate;
      };
      const inRealUsd = (result: BacktestResult) => applyUsdInflation(result, cpi);
      const singles = ASSET_CLASSES.map((assetClass) => ({
        name: assets[assetClass].label,
        color: assets[assetClass].color,
        result: inRealUsd(runDcaBacktest({ monthlyContribution: contribution, contributionForDate, prices: series[assetClass], maxPeriods })),
      }));
      const neutralWeights: AssetClassRecord = { foreignEquity: .35, commodity: .25, bitcoin: .2, turkishEquity: .2 };
      const neutral = inRealUsd(runAllocationBacktest({ monthlyContribution: contribution, contributionForDate, series, maxPeriods, allocate: () => neutralWeights }));
      const dynamic = inRealUsd(runAllocationBacktest({ monthlyContribution: contribution, contributionForDate, series, maxPeriods, allocate: (history) => {
        const cutoff = history.foreignEquity.at(-1)?.date ?? "";
        const signalEntries = ASSET_CLASSES.map((assetClass) => {
          const available = weekly(rawSeries[assetClass].filter((point) => point.date <= cutoff));
          const signal = assetClass === "bitcoin"
            ? deriveBitcoinMacroSignal(available, m2.filter((point) => point.date <= cutoff))
            : derivePriceSignal(available.map((point) => point.close), assetClass === "commodity" ? .8 : assetClass === "turkishEquity" ? 1.2 : 1);
          return [assetClass, signal] as const;
        });
        const signals = Object.fromEntries(signalEntries.map(([assetClass, signal]) => [assetClass, signal.score])) as AssetClassRecord;
        const confidence = Object.fromEntries(signalEntries.map(([assetClass, signal]) => [assetClass, signal.confidence])) as AssetClassRecord;
        return Object.fromEntries(buildAllocation({ monthlyBudget: contribution, signals, confidence }).items.map((item) => [item.assetClass, item.weight])) as AssetClassRecord;
      } }));
      const balanced = optimizeStaticAllocation({ monthlyContribution: contribution, contributionForDate, series, objective: "balanced", maxPeriods });
      const maximum = optimizeStaticAllocation({ monthlyContribution: contribution, contributionForDate, series, objective: "maximumReturn", maxPeriods });
      const oracle = runPerfectForesightBacktest({ monthlyContribution: contribution, contributionForDate, series, maxPeriods });
      setOracleChoices(oracle.monthlyChoices);
      setResults([
        { name: "BTC/M2 + SMA dinamik", result: dynamic, color: "#c2414b", dash: "7 4", primary: true },
        { name: "Dengeli optimum", result: inRealUsd(balanced.result), weights: balanced.weights, color: "#0f766e", dash: "3 3", primary: true },
        { name: "Maksimum statik", result: inRealUsd(maximum.result), weights: maximum.weights, color: "#c46a16", dash: "10 4", primary: true },
        { name: "Teorik üst sınır", result: inRealUsd(oracle.result), weights: oracle.weights, color: "#7c3aed", dash: "2 3", primary: true },
        { name: "Sabit nötr sepet", result: neutral, weights: neutralWeights, color: "#152030" },
        ...singles,
      ]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Backtest verisi alınamadı.");
      setResults([]);
      setOracleChoices([]);
    } finally {
      setLoading(false);
    }
  }, [contribution, period]);

  useEffect(() => { void Promise.resolve().then(run); }, [run]);

  const chartData = results[0]?.result.series.map((point, index) => Object.fromEntries([
    ["date", point.date.slice(0, 7)],
    ["ABD TÜFE koruma eşiği", point.inflationHurdle ?? null],
    ...results.map((entry) => [entry.name, entry.result.series[index]?.value ?? null]),
  ])) ?? [];
  const yearlyChoices = useMemo(() => {
    const rows = new Map<string, AssetClassRecord>();
    oracleChoices.forEach((choice) => {
      const year = choice.date.slice(0, 4);
      const row = rows.get(year) ?? { foreignEquity: 0, commodity: 0, bitcoin: 0, turkishEquity: 0 };
      row[choice.assetClass] += choice.contribution;
      rows.set(year, row);
    });
    return [...rows].map(([year, counts]) => {
      const total = ASSET_CLASSES.reduce((sum, assetClass) => sum + counts[assetClass], 0);
      return { year, weights: Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, total ? counts[assetClass] / total : 0])) as AssetClassRecord };
    });
  }, [oracleChoices]);
  const firstDate = results[0]?.result.series.at(0)?.date.slice(0, 7);
  const lastDate = results[0]?.result.series.at(-1)?.date.slice(0, 7);
  const nominalTryInvested = contribution * (results[0]?.result.series.length ?? 0);

  return <div>
    <PageHeader eyebrow="Geçmiş performans · USD bazlı" title="Düzenli alım backtesti" description="Her ay sabit TL katkıyı o tarihin USD/TRY kuruyla dolara çevirir; S&P 500, altın, Bitcoin ve dolar bazlı BIST 100’ü ABD enflasyon eşiğiyle karşılaştırır." actions={<><select className="select" value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Backtest dönemi"><option value="1y">1 yıl</option><option value="3y">3 yıl</option><option value="5y">5 yıl</option><option value="10y">10 yıl</option></select><input className="input" type="number" min="1000" step="1000" value={contribution} onChange={(event) => setContribution(Number(event.target.value))} aria-label="Aylık TL katkısı" /><button className="button primary" onClick={() => void run()}>Hesapla</button></>} />
    {loading ? <Card><EmptyState title="Backtest hesaplanıyor" description="Geçmiş fiyatlar ücretsiz kaynaklardan alınıyor." /></Card> : error ? <Card><EmptyState title="Backtest tamamlanamadı" description={error} /></Card> : <>
      <div className="notice"><p><strong>{firstDate}–{lastDate}</strong> · tam <strong>{results[0]?.result.series.length} aylık alım</strong> · <strong data-testid="exact-invested">{formatMoney(nominalTryInvested)} / {formatMoney(results[0]?.result.totalInvested ?? 0, "USD")} yatırım</strong>. TL katkılar tarihsel kurdan çevrilir; sonuçlar ve getiriler USD bazındadır.</p></div>
      <div className="grid grid-4 section-gap">{results.filter((entry) => entry.primary).map((entry) => <Card className="metric-card" key={entry.name}><div className="metric-label">{entry.name}</div><div className="metric-value">{formatMoney(entry.result.finalValue, "USD")}</div><div className="metric-meta"><span className={(entry.result.realReturn ?? 0) >= 0 ? "positive" : "negative"}>{formatPercent(entry.result.realReturn ?? 0)} ABD enflasyonu sonrası</span> · {formatPercent(entry.result.totalReturn)} USD getiri</div></Card>)}</div>
      <Card className="section-gap"><div className="card-title"><div><h2>USD portföy değeri karşılaştırması</h2><p>Gri kesikli çizgi, her tarihsel dolar katkısının ABD TÜFE ile korunması için gereken değeri gösterir</p></div></div><div className="chart-box" style={{ height: 420 }}><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="date" tick={{ fill: "var(--muted)", fontSize: 11 }} /><YAxis tickFormatter={(value) => `$${Math.round(value / 1000)}K`} tick={{ fill: "var(--muted)", fontSize: 11 }} /><Tooltip formatter={(value) => formatMoney(Number(value), "USD")} /><Legend /><Line dataKey="ABD TÜFE koruma eşiği" stroke="#7b8794" strokeWidth={2} strokeDasharray="4 5" dot={false} isAnimationActive={false} />{results.map((entry) => <Line key={entry.name} dataKey={entry.name} stroke={entry.color} strokeWidth={entry.primary ? 2.8 : 1.25} strokeDasharray={entry.dash} dot={false} isAnimationActive={false} />)}</LineChart></ResponsiveContainer></div></Card>
      <div className="grid grid-3 section-gap">
        {results.filter((entry) => entry.weights).slice(0, 3).map((entry) => <Card key={entry.name}><div className="card-title"><div><h3>{entry.name}</h3><p>{entry.name === "Dengeli optimum" ? "Risk, düşüş ve oynaklık dengesi; her sınıf %10–%50" : entry.name === "Maksimum statik" ? "Tüm dönem için en yüksek son değer; 5 puanlık tarama" : "Her ay gelecekte en çok kazandıracak varlığı önceden bilseydik"}</p></div></div><WeightLegend weights={entry.weights!} /></Card>)}
      </div>
      <Card className="section-gap"><div className="card-title"><div><h2>Teorik en iyi alımlar hangi yıllarda nereye giderdi?</h2><p>Her ayın katkısı, o tarihten dönem sonuna en çok yükselecek sınıfa yönlendirilmiştir. Bu gelecek bilgisi kullanan, uygulanabilir olmayan bir üst sınırdır.</p></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Yıl</th>{ASSET_CLASSES.map((assetClass) => <th className="number" key={assetClass}>{ASSET_LABELS[assetClass]}</th>)}</tr></thead><tbody>{yearlyChoices.map((row) => <tr key={row.year}><td><strong>{row.year}</strong></td>{ASSET_CLASSES.map((assetClass) => <td className="number" key={assetClass}>{formatUnsignedPercent(row.weights[assetClass], 0)}</td>)}</tr>)}</tbody></table></div></Card>
      <Card className="section-gap"><div className="card-title"><div><h2>Strateji ölçümleri</h2><p>USD bazlıdır; ABD TÜFE sonrası reel getiri ayrıca gösterilir. Vergi ve ürün maliyetleri dahil değildir.</p></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Strateji</th><th className="number">Yatırılan (USD)</th><th className="number">Son değer (USD)</th><th className="number">USD getiri</th><th className="number">Reel USD getiri</th><th className="number">Yıllık TWR</th><th className="number">Maks. düşüş</th><th className="number">Volatilite</th></tr></thead><tbody>{results.map((entry) => <tr key={entry.name}><td><strong>{entry.name}</strong></td><td className="number">{formatMoney(entry.result.totalInvested, "USD")}</td><td className="number">{formatMoney(entry.result.finalValue, "USD")}</td><td className="number">{formatPercent(entry.result.totalReturn)}</td><td className={`number ${(entry.result.realReturn ?? 0) >= 0 ? "positive" : "negative"}`}>{formatPercent(entry.result.realReturn ?? 0)}</td><td className="number">{formatPercent(entry.result.annualizedReturn)}</td><td className="number negative">{formatPercent(entry.result.maximumDrawdown)}</td><td className="number">{formatPercent(entry.result.volatility)}</td></tr>)}</tbody></table></div></Card>
      <div className="notice section-gap"><p><strong>Okuma notu:</strong> USD getiri, tarihsel kurdan dolara çevrilen toplam katkıyla son değeri karşılaştırır. Reel USD getiri, her katkının FRED ABD TÜFE endeksiyle bugün korunması gereken tutarı aşma oranıdır. Yıllık TWR, maksimum düşüş ve volatilite yeni para girişlerini getiri sanmadan hesaplanır. BTC/M2 + SMA dinamik yalnızca o tarihte mevcut veriyi kullanır; optimumlar geriye dönük, teorik üst sınır ise gelecek bilgisiyle hesaplanır.</p></div>
    </>}
  </div>;
}
