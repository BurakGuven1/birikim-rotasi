import { annualizedVolatility } from "./indicators";
import { ASSET_CLASSES } from "./config";
import type { AssetClass, AssetClassRecord, PricePoint } from "./types";

interface BacktestInput {
  monthlyContribution: number;
  prices: PricePoint[];
  maxPeriods?: number;
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

export function runDcaBacktest({ monthlyContribution, prices, maxPeriods }: BacktestInput): BacktestResult {
  if (monthlyContribution <= 0) throw new Error("Aylık katkı sıfırdan büyük olmalı.");
  const allOrdered = [...prices].filter((point) => point.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  const ordered = maxPeriods ? allOrdered.slice(-maxPeriods) : allOrdered;
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
  maxPeriods?: number;
}

export function alignMonthlySeries(series: Record<AssetClass, PricePoint[]>, maxPeriods?: number): Record<AssetClass, PricePoint[]> {
  const maps = Object.fromEntries(ASSET_CLASSES.map((assetClass) => {
    const byMonth = new Map<string, PricePoint>();
    series[assetClass].forEach((point) => { if (point.close > 0) byMonth.set(point.date.slice(0, 7), point); });
    return [assetClass, byMonth];
  })) as Record<AssetClass, Map<string, PricePoint>>;
  const commonMonths = [...maps.foreignEquity.keys()]
    .filter((month) => ASSET_CLASSES.every((assetClass) => maps[assetClass].has(month)))
    .sort()
    .slice(maxPeriods ? -maxPeriods : 0);
  return Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, commonMonths.map((month) => maps[assetClass].get(month)!) ])) as Record<AssetClass, PricePoint[]>;
}

export function runAllocationBacktest({ monthlyContribution, series, allocate, maxPeriods }: AllocationBacktestInput): BacktestResult {
  const aligned = alignMonthlySeries(series, maxPeriods);
  const length = aligned.foreignEquity.length;
  const units = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, 0])) as AssetClassRecord;
  const output: BacktestResult["series"] = [];
  for (let index = 0; index < length; index += 1) {
    const history = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, aligned[assetClass].slice(0, index + 1)])) as Record<AssetClass, PricePoint[]>;
    const weights = allocate(history);
    ASSET_CLASSES.forEach((assetClass) => {
      const price = aligned[assetClass][index].close;
      if (price > 0) units[assetClass] += monthlyContribution * weights[assetClass] / price;
    });
    const value = ASSET_CLASSES.reduce((sum, assetClass) => sum + units[assetClass] * aligned[assetClass][index].close, 0);
    output.push({ date: aligned.foreignEquity[index].date, invested: monthlyContribution * (index + 1), value });
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

interface StaticOptimizationInput {
  monthlyContribution: number;
  series: Record<AssetClass, PricePoint[]>;
  objective: "balanced" | "maximumReturn";
  maxPeriods?: number;
}

export interface OptimizedAllocationBacktest {
  weights: AssetClassRecord;
  result: BacktestResult;
  score: number;
}

function portfolioRiskScore(series: Record<AssetClass, PricePoint[]>, weights: AssetClassRecord) {
  const length = series.foreignEquity.length;
  if (length < 2) return 0;
  const returns = Array.from({ length: length - 1 }, (_, index) => ASSET_CLASSES.reduce((sum, assetClass) => {
    const previous = series[assetClass][index].close;
    const current = series[assetClass][index + 1].close;
    return sum + weights[assetClass] * (current / previous - 1);
  }, 0));
  const wealth = returns.reduce<number[]>((values, value) => [...values, values.at(-1)! * (1 + value)], [1]);
  const annualized = wealth.at(-1)! ** (12 / returns.length) - 1;
  const volatility = annualizedVolatility(wealth, 12);
  return annualized / (0.02 + volatility + Math.abs(maxDrawdown(wealth)));
}

export function optimizeStaticAllocation(input: StaticOptimizationInput): OptimizedAllocationBacktest {
  const aligned = alignMonthlySeries(input.series, input.maxPeriods);
  const totalUnits = 20;
  const minimum = input.objective === "balanced" ? 2 : 0;
  const maximum = input.objective === "balanced" ? 10 : totalUnits;
  let best: OptimizedAllocationBacktest | undefined;
  for (let foreign = minimum; foreign <= maximum; foreign += 1) {
    for (let commodity = minimum; commodity <= maximum; commodity += 1) {
      for (let bitcoin = minimum; bitcoin <= maximum; bitcoin += 1) {
        const turkish = totalUnits - foreign - commodity - bitcoin;
        if (turkish < minimum || turkish > maximum) continue;
        const weights: AssetClassRecord = { foreignEquity: foreign / totalUnits, commodity: commodity / totalUnits, bitcoin: bitcoin / totalUnits, turkishEquity: turkish / totalUnits };
        const result = runAllocationBacktest({ monthlyContribution: input.monthlyContribution, series: aligned, allocate: () => weights });
        const score = input.objective === "maximumReturn" ? result.finalValue : portfolioRiskScore(aligned, weights);
        if (!best || score > best.score + 1e-12) best = { weights, result, score };
      }
    }
  }
  if (!best) throw new Error("Optimum dağılım hesaplanamadı.");
  return best;
}

interface PerfectForesightInput {
  monthlyContribution: number;
  series: Record<AssetClass, PricePoint[]>;
  maxPeriods?: number;
}

export function runPerfectForesightBacktest(input: PerfectForesightInput) {
  const aligned = alignMonthlySeries(input.series, input.maxPeriods);
  const length = aligned.foreignEquity.length;
  const units = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, 0])) as AssetClassRecord;
  const counts = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, 0])) as AssetClassRecord;
  const fullGrowth = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, aligned[assetClass].at(-1)!.close / aligned[assetClass][0].close])) as AssetClassRecord;
  const monthlyChoices: Array<{ date: string; assetClass: AssetClass }> = [];
  const output: BacktestResult["series"] = [];
  for (let index = 0; index < length; index += 1) {
    const choice = ASSET_CLASSES.reduce((best, assetClass) => {
      const finalRatio = aligned[assetClass].at(-1)!.close / aligned[assetClass][index].close;
      const bestRatio = aligned[best].at(-1)!.close / aligned[best][index].close;
      return finalRatio > bestRatio + 1e-12 || (Math.abs(finalRatio - bestRatio) <= 1e-12 && fullGrowth[assetClass] > fullGrowth[best]) ? assetClass : best;
    }, ASSET_CLASSES[0]);
    units[choice] += input.monthlyContribution / aligned[choice][index].close;
    counts[choice] += 1;
    monthlyChoices.push({ date: aligned.foreignEquity[index].date, assetClass: choice });
    const value = ASSET_CLASSES.reduce((sum, assetClass) => sum + units[assetClass] * aligned[assetClass][index].close, 0);
    output.push({ date: aligned.foreignEquity[index].date, invested: input.monthlyContribution * (index + 1), value });
  }
  const totalInvested = input.monthlyContribution * length;
  const finalValue = output.at(-1)?.value ?? 0;
  const years = Math.max(1 / 12, length / 12);
  const result: BacktestResult = {
    totalInvested,
    units: ASSET_CLASSES.reduce((sum, assetClass) => sum + units[assetClass], 0),
    finalValue,
    totalReturn: totalInvested ? finalValue / totalInvested - 1 : 0,
    annualizedReturn: totalInvested ? (finalValue / totalInvested) ** (1 / years) - 1 : 0,
    maximumDrawdown: maxDrawdown(output.map((point) => point.value)),
    volatility: annualizedVolatility(output.map((point) => point.value), 12),
    series: output,
  };
  const weights = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, length ? counts[assetClass] / length : 0])) as AssetClassRecord;
  return { result, weights, monthlyChoices };
}
