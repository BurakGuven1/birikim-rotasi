import type { Time } from "lightweight-charts";
import { simpleMovingAverage } from "@/lib/domain/indicators";
import type { PricePoint } from "@/lib/domain/types";

export function prepareChartData(points: PricePoint[], intraday: boolean) {
  const unique = new Map<number, PricePoint & { time: Time }>();
  for (const point of points) {
    const stamp = Date.parse(point.date);
    if (!Number.isFinite(stamp) || !Number.isFinite(point.close) || point.close <= 0) continue;
    const key = intraday ? Math.floor(stamp / 1000) : Math.floor(stamp / 86_400_000);
    unique.set(key, { ...point, time: (intraday ? key : new Date(stamp).toISOString().slice(0, 10)) as Time });
  }
  const bars = [...unique.entries()].sort(([a], [b]) => a - b).map(([, point]) => point);
  const average = (period: number) => simpleMovingAverage(bars.map(p => p.close), period).flatMap((value, index) => value === null ? [] : [{ time: bars[index].time, value }]);
  return { bars, sma40: average(40), sma200: average(200), hasOhlc: bars.length > 0 && bars.every(p => [p.open, p.high, p.low].every(v => v != null && Number.isFinite(v) && v > 0) && p.high! >= Math.max(p.open!, p.close) && p.low! <= Math.min(p.open!, p.close)) };
}
