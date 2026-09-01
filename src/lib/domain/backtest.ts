import { annualizedVolatility } from "./indicators";
import { ASSET_CLASSES } from "./config";
import type { AssetClass, AssetClassRecord, PricePoint } from "./types";

interface BacktestInput {
  monthlyContribution: number;
  prices: PricePoint[];
}

export interface BacktestResult {
  totalInvested: number;
  units: number;
  finalValue: number;
  totalReturn: number;
  annualizedReturn: number;
  maximumDrawdown: number;
  volatility: number;
  series: Array<{ date: string; invested: number; value: number }>;
}

export function maxDrawdown(values: number[]): number {
  if (values.length === 0) return 0;
  let peak = values[0];
  let worst = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    worst = Math.min(worst, peak === 0 ? 0 : value / peak - 1);
  }
  return worst;
}

export function runDcaBacktest({ monthlyContribution, prices }: BacktestInput): BacktestResult {
  if (monthlyContribution <= 0) throw new Error("Aylık katkı sıfırdan büyük olmalı.");
  const ordered = [...prices].filter((point) => point.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  let units = 0;
  let invested = 0;
  const series = ordered.map((point) => {
    units += monthlyContribution / point.close;
    invested += monthlyContribution;
    return { date: point.date, invested, value: units * point.close };
  });
  const finalValue = series.at(-1)?.value ?? 0;
  const years = Math.max(1 / 12, ordered.length / 12);
  const totalReturn = invested > 0 ? finalValue / invested - 1 : 0;
  return {
    totalInvested: invested,
    units,
    finalValue,
    totalReturn,
    annualizedReturn: invested > 0 ? (finalValue / invested) ** (1 / years) - 1 : 0,
    maximumDrawdown: maxDrawdown(ordered.map((point) => point.close)),
    volatility: annualizedVolatility(ordered.map((point) => point.close), 12),
    series,
  };
}

interface AllocationBacktestInput {
  monthlyContribution: number;
  series: Record<AssetClass, PricePoint[]>;
  allocate: (history: Record<AssetClass, PricePoint[]>) => AssetClassRecord;
}

export function runAllocationBacktest({ monthlyContribution, series, allocate }: AllocationBacktestInput): BacktestResult {
  const length = Math.min(...ASSET_CLASSES.map((assetClass) => series[assetClass].length));
  const units = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, 0])) as AssetClassRecord;
  const output: BacktestResult["series"] = [];
  for (let index = 0; index < length; index += 1) {
    const history = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, series[assetClass].slice(0, index + 1)])) as Record<AssetClass, PricePoint[]>;
    const weights = allocate(history);
    ASSET_CLASSES.forEach((assetClass) => {
      const price = series[assetClass][index].close;
      if (price > 0) units[assetClass] += monthlyContribution * weights[assetClass] / price;
    });
    const value = ASSET_CLASSES.reduce((sum, assetClass) => sum + units[assetClass] * series[assetClass][index].close, 0);
    output.push({ date: series.foreignEquity[index].date, invested: monthlyContribution * (index + 1), value });
  }
  const totalInvested = monthlyContribution * length;
  const finalValue = output.at(-1)?.value ?? 0;
  const years = Math.max(1 / 12, length / 12);
  return {
    totalInvested,
    units: ASSET_CLASSES.reduce((sum, assetClass) => sum + units[assetClass], 0),
    finalValue,
    totalReturn: totalInvested ? finalValue / totalInvested - 1 : 0,
    annualizedReturn: totalInvested ? (finalValue / totalInvested) ** (1 / years) - 1 : 0,
    maximumDrawdown: maxDrawdown(output.map((point) => point.value)),
    volatility: annualizedVolatility(output.map((point) => point.value), 12),
    series: output,
  };
}
