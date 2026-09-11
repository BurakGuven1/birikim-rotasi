"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, ColorType, createChart, createSeriesMarkers, HistogramSeries, LineSeries, type AutoscaleInfo, type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type LineStyle, type SeriesMarker, type Time } from "lightweight-charts";
import type { PricePoint } from "@/lib/domain/types";
import { prepareChartData } from "./chart-data";

export interface ChartLevel { price: number; title: string; color?: string; lineStyle?: number }
export interface ChartTrade { date: string; type: "buy" | "sell"; quantity: number }
const noLevels: ChartLevel[] = [];
const noTrades: ChartTrade[] = [];
interface ChartInstance {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  line: ISeriesApi<"Line">;
  fast: ISeriesApi<"Line">;
  slow: ISeriesApi<"Line">;
  volume: ISeriesApi<"Histogram">;
  candleMarkers: ISeriesMarkersPluginApi<Time>;
  lineMarkers: ISeriesMarkersPluginApi<Time>;
  priceLines: Array<{ series: ISeriesApi<"Line"> | ISeriesApi<"Candlestick">; line: IPriceLine }>;
  fitted: boolean;
}

export function CandlestickChart({ points, levels = noLevels, trades = noTrades, intraday = false }: { points: PricePoint[]; levels?: ChartLevel[]; trades?: ChartTrade[]; intraday?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<ChartInstance | null>(null);
  const [mode, setMode] = useState<"candles" | "line">("candles");
  const [period, setPeriod] = useState(0);
  const [full, setFull] = useState(false);
  const data = useMemo(() => prepareChartData(points, intraday), [points, intraday]);

  useEffect(() => {
    if (!host.current) return;
    const chart = createChart(host.current, { autoSize: true, height: 400, layout: { background: { type: ColorType.Solid, color: "transparent" } }, timeScale: { timeVisible: intraday, secondsVisible: false }, rightPriceScale: { scaleMargins: { top: .12, bottom: .25 } } });
    const candles = chart.addSeries(CandlestickSeries, { upColor: "#087a61", downColor: "#c2414b", wickUpColor: "#087a61", wickDownColor: "#c2414b", borderVisible: false });
    const line = chart.addSeries(LineSeries, { color: "#315f9d", lineWidth: 2 });
    const fast = chart.addSeries(LineSeries, { color: "#b7791f", lineWidth: 2, title: "SMA40", priceLineVisible: false });
    const slow = chart.addSeries(LineSeries, { color: "#6941c6", lineWidth: 2, lineStyle: 2, title: "SMA200", priceLineVisible: false });
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume", priceLineVisible: false, lastValueVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: .82, bottom: 0 } });
    const current: ChartInstance = { chart, candles, line, fast, slow, volume, candleMarkers: createSeriesMarkers(candles), lineMarkers: createSeriesMarkers(line), priceLines: [], fitted: false };
    instance.current = current;
    const theme = () => {
      const styles = getComputedStyle(document.documentElement);
      const border = styles.getPropertyValue("--border").trim() || "#ddd";
      chart.applyOptions({ layout: { textColor: styles.getPropertyValue("--muted").trim() || "#64748b" }, grid: { vertLines: { color: border }, horzLines: { color: border } }, rightPriceScale: { borderColor: border }, timeScale: { borderColor: border } });
    };
    theme();
    const observer = new MutationObserver(theme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => { observer.disconnect(); current.candleMarkers.detach(); current.lineMarkers.detach(); chart.remove(); instance.current = null; };
  }, [intraday]);

  useEffect(() => {
    const current = instance.current;
    if (!current) return;
    const showCandles = mode === "candles" && data.hasOhlc;
    current.candles.applyOptions({ visible: showCandles });
    current.line.applyOptions({ visible: !showCandles });
    current.candles.setData(data.hasOhlc ? data.bars.map(p => ({ time: p.time, open: p.open!, high: p.high!, low: p.low!, close: p.close })) : []);
    current.line.setData(data.bars.map(p => ({ time: p.time, value: p.close })));
    current.fast.setData(data.sma40);
    current.slow.setData(data.sma200);
    current.volume.setData(data.bars.filter(p => p.volume != null && Number.isFinite(p.volume) && p.volume >= 0).map(p => ({ time: p.time, value: p.volume!, color: p.close >= (p.open ?? p.close) ? "#087a6144" : "#c2414b44" })));
    current.priceLines.forEach(({ series, line }) => series.removePriceLine(line));
    const active = showCandles ? current.candles : current.line;
    active.applyOptions({ autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
      const info = original();
      if (!info?.priceRange) return info;
      for (const level of levels) {
        if (!Number.isFinite(level.price)) continue;
        info.priceRange.minValue = Math.min(info.priceRange.minValue, level.price);
        info.priceRange.maxValue = Math.max(info.priceRange.maxValue, level.price);
      }
      return info;
    } });
    current.priceLines = levels.filter(level => Number.isFinite(level.price)).map(level => ({ series: active, line: active.createPriceLine({ price: level.price, title: level.title, color: level.color ?? "#64748b", lineWidth: 1, lineStyle: (level.lineStyle ?? 2) as LineStyle, axisLabelVisible: true }) }));
    const markers: SeriesMarker<Time>[] = [];
    for (const trade of [...trades].sort((a, b) => a.date.localeCompare(b.date))) {
      const bar = data.bars.find(p => intraday ? Date.parse(p.date) === Date.parse(trade.date) : p.date.slice(0, 10) === trade.date.slice(0, 10));
      if (bar) markers.push({ time: bar.time, position: trade.type === "buy" ? "belowBar" : "aboveBar", color: trade.type === "buy" ? "#087a61" : "#c2414b", shape: trade.type === "buy" ? "arrowUp" : "arrowDown", text: `${trade.type === "buy" ? "Alım" : "Satış"} ${trade.quantity}` });
    }
    current.candleMarkers.setMarkers(showCandles ? markers : []);
    current.lineMarkers.setMarkers(showCandles ? [] : markers);
    if (!current.fitted && data.bars.length) { current.chart.timeScale().fitContent(); current.fitted = true; }
  }, [data, levels, trades, mode, intraday]);

  const choosePeriod = (days: number) => {
    setPeriod(days);
    const chart = instance.current?.chart;
    const last = data.bars.at(-1);
    if (!chart || !last) return;
    if (!days) { chart.timeScale().fitContent(); return; }
    const cutoff = Date.parse(last.date) - days * 86_400_000;
    const first = data.bars.find(p => Date.parse(p.date) >= cutoff);
    if (first && first.time !== last.time) chart.timeScale().setVisibleRange({ from: first.time, to: last.time });
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setFull(false); };
    if (full) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  return <div className={`price-chart${full ? " price-chart-expanded" : ""}`}>
    <div className="chart-controls">
      <div className="chart-controls" aria-label="Fiyat grafik dönemi">{[[90, "3 ay"], [365, "1 yıl"], [1095, "3 yıl"], [0, "Tümü"]].map(([days, label]) => <button key={days} className={`button small ${period === days ? "primary" : "secondary"}`} aria-pressed={period === days} onClick={() => choosePeriod(Number(days))}>{label}</button>)}</div>
      <button className="button secondary small" onClick={() => setMode(value => value === "candles" ? "line" : "candles")} disabled={!data.hasOhlc}>{mode === "candles" && data.hasOhlc ? "Çizgiye geç" : "Muma geç"}</button>
      <button className="button secondary small" aria-pressed={full} onClick={() => setFull(value => !value)}>{full ? "Grafiği küçült" : "Tam ekran"}</button>
    </div>
    <div ref={host} className="price-chart-canvas" aria-label="Fiyat, hareketli ortalamalar, hacim ve işlemler grafiği" />
    <p className="muted chart-caption">SMA40 · SMA200 · Varsa hacim · {data.bars.length} gözlem. İşaretler yalnız işlem tarihiyle eşleşen mumlarda gösterilir. <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™</a></p>
  </div>;
}
