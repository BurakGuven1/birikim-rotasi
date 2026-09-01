"use client";

import { useEffect, useRef } from "react";
import { CandlestickSeries, ColorType, createChart, LineSeries, type Time } from "lightweight-charts";
import { simpleMovingAverage } from "@/lib/domain/indicators";
import type { PricePoint } from "@/lib/domain/types";

export function CandlestickChart({ points }: { points: PricePoint[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || points.length === 0) return;
    const styles = getComputedStyle(document.documentElement);
    const chart = createChart(ref.current, { height: 360, layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: styles.getPropertyValue("--muted") }, grid: { vertLines: { color: styles.getPropertyValue("--border") }, horzLines: { color: styles.getPropertyValue("--border") } }, rightPriceScale: { borderColor: styles.getPropertyValue("--border") }, timeScale: { borderColor: styles.getPropertyValue("--border"), timeVisible: false } });
    const normalized = points.slice(-520).map((point) => ({ ...point, time: point.date.slice(0, 10) as Time }));
    const hasOhlc = normalized.every((point) => point.open != null && point.high != null && point.low != null);
    if (hasOhlc) {
      const candles = chart.addSeries(CandlestickSeries, { upColor: "#087a61", downColor: "#c2414b", wickUpColor: "#087a61", wickDownColor: "#c2414b", borderVisible: false });
      candles.setData(normalized.map((point) => ({ time: point.time, open: point.open!, high: point.high!, low: point.low!, close: point.close })));
    } else {
      const price = chart.addSeries(LineSeries, { color: "#315f9d", lineWidth: 2 });
      price.setData(normalized.map((point) => ({ time: point.time, value: point.close })));
    }
    const closes = normalized.map((point) => point.close);
    const sma40 = simpleMovingAverage(closes, Math.min(40, closes.length));
    const sma200 = simpleMovingAverage(closes, Math.min(200, closes.length));
    const fast = chart.addSeries(LineSeries, { color: "#b7791f", lineWidth: 2, title: "SMA40" });
    const slow = chart.addSeries(LineSeries, { color: "#6941c6", lineWidth: 2, lineStyle: 2, title: "SMA200" });
    fast.setData(normalized.flatMap((point, index) => sma40[index] == null ? [] : [{ time: point.time, value: sma40[index]! }]));
    slow.setData(normalized.flatMap((point, index) => sma200[index] == null ? [] : [{ time: point.time, value: sma200[index]! }]));
    chart.timeScale().fitContent();
    const observer = new ResizeObserver(() => chart.applyOptions({ width: ref.current?.clientWidth ?? 600 })); observer.observe(ref.current);
    return () => { observer.disconnect(); chart.remove(); };
  }, [points]);
  return <div ref={ref} aria-label="Fiyat, SMA40 ve SMA200 grafiği" />;
}
