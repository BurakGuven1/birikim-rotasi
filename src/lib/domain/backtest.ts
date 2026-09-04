import { annualizedVolatility } from "./indicators";
import { ASSET_CLASSES } from "./config";
import { averageAllocationWeights } from "./allocation";
import type { AssetClass, AssetClassRecord, PricePoint } from "./types";

interface BacktestInput {
  monthlyContribution: number;
  prices: PricePoint[];
  maxPeriods?: number;
  contributionForDate?: (date: string, index: number) => number;
}

export function buildAnnualContributionSchedule(
  monthlyContribution: number,
  annualContribution: number,
  annualContributionMonth: number,
): (date: string, index: number) => number {
  if (!Number.isFinite(monthlyContribution) || monthlyContribution <= 0) {
    throw new Error("Aylık katkı sıfırdan büyük olmalı.");
  }
  if (!Number.isFinite(annualContribution) || annualContribution < 0) {
    throw new Error("Yıllık ek katkı negatif olamaz.");
  }
  if (!Number.isInteger(annualContributionMonth) || annualContributionMonth < 1 || annualContributionMonth > 12) {
    throw new Error("Yıllık ek katkı ayı 1 ile 12 arasında olmalı.");
  }

  return (date: string) => {
    const month = new Date(date).getUTCMonth() + 1;
    return month === annualContributionMonth ? monthlyContribution + annualContribution : monthlyContribution;
  };
}

export interface BacktestResult {
  totalInvested: number;
  units: number;
  finalValue: number;
  totalReturn: number;
  annualizedReturn: number;
  maximumDrawdown: number;
  volatility: number;
  inflationAdjustedInvested?: number;
  realReturn?: number;
  series: Array<{ date: string; invested: number; value: number; inflationHurdle?: number }>;
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

function returnMetrics(returns: number[]) {
  if (returns.length === 0) return { annualizedReturn: 0, maximumDrawdown: 0, volatility: 0 };
  const wealth = returns.reduce<number[]>((values, value) => [...values, values.at(-1)! * (1 + value)], [1]);
  const annualizedReturn = wealth.at(-1)! ** (12 / returns.length) - 1;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.length < 2 ? 0 : returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return { annualizedReturn, maximumDrawdown: maxDrawdown(wealth), volatility: Math.sqrt(variance) * Math.sqrt(12) };
}

function contributionAt(monthlyContribution: number, contributionForDate: BacktestInput["contributionForDate"], date: string, index: number) {
  const amount = contributionForDate?.(date, index) ?? monthlyContribution;
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Aylık katkı sıfırdan büyük olmalı.");
  return amount;
}

export function runDcaBacktest({ monthlyContribution, prices, maxPeriods, contributionForDate }: BacktestInput): BacktestResult {
  if (monthlyContribution <= 0) throw new Error("Aylık katkı sıfırdan büyük olmalı.");
  const allOrdered = [...prices].filter((point) => point.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  const ordered = maxPeriods ? allOrdered.slice(-maxPeriods) : allOrdered;
  let units = 0;
  let invested = 0;
  const returns = ordered.slice(1).map((point, index) => point.close / ordered[index].close - 1);
  const series = ordered.map((point, index) => {
    const contribution = contributionAt(monthlyContribution, contributionForDate, point.date, index);
    units += contribution / point.close;
    invested += contribution;
    return { date: point.date, invested, value: units * point.close };
  });
  const finalValue = series.at(-1)?.value ?? 0;
  const totalReturn = invested > 0 ? finalValue / invested - 1 : 0;
  const metrics = returnMetrics(returns);
  return {
    totalInvested: invested,
    units,
    finalValue,
    totalReturn,
    ...metrics,
    series,
  };
}

interface AllocationBacktestInput {
  monthlyContribution: number;
  series: Record<AssetClass, PricePoint[]>;
  allocate: (history: Record<AssetClass, PricePoint[]>) => AssetClassRecord;
  maxPeriods?: number;
  contributionForDate?: (date: string, index: number) => number;
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

export function runAllocationBacktest({ monthlyContribution, series, allocate, maxPeriods, contributionForDate }: AllocationBacktestInput): BacktestResult {
  const aligned = alignMonthlySeries(series, maxPeriods);
  const length = aligned.foreignEquity.length;
  const units = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, 0])) as AssetClassRecord;
  const output: BacktestResult["series"] = [];
  const returns: number[] = [];
  let invested = 0;
  let previousValue = 0;
  for (let index = 0; index < length; index += 1) {
    const history = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, aligned[assetClass].slice(0, index + 1)])) as Record<AssetClass, PricePoint[]>;
    const weights = allocate(history);
    const valueBeforeContribution = ASSET_CLASSES.reduce((sum, assetClass) => sum + units[assetClass] * aligned[assetClass][index].close, 0);
    if (index > 0 && previousValue > 0) returns.push(valueBeforeContribution / previousValue - 1);
    const contribution = contributionAt(monthlyContribution, contributionForDate, aligned.foreignEquity[index].date, index);
    ASSET_CLASSES.forEach((assetClass) => {
      const price = aligned[assetClass][index].close;
      if (price > 0) units[assetClass] += contribution * weights[assetClass] / price;
    });
    const value = ASSET_CLASSES.reduce((sum, assetClass) => sum + units[assetClass] * aligned[assetClass][index].close, 0);
    invested += contribution;
    previousValue = value;
    output.push({ date: aligned.foreignEquity[index].date, invested, value });
  }
  const totalInvested = invested;
  const finalValue = output.at(-1)?.value ?? 0;
  const metrics = returnMetrics(returns);
  return {
    totalInvested,
    units: ASSET_CLASSES.reduce((sum, assetClass) => sum + units[assetClass], 0),
    finalValue,
    totalReturn: totalInvested ? finalValue / totalInvested - 1 : 0,
    ...metrics,
    series: output,
  };
}

export function runWalkForwardAllocationBacktest({ monthlyContribution, series, allocate, maxPeriods, contributionForDate }: AllocationBacktestInput): BacktestResult {
  const aligned = alignMonthlySeries(series);
  const length = aligned.foreignEquity.length;
  const startIndex = maxPeriods ? Math.max(0, length - maxPeriods) : 0;
  const units = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, 0])) as AssetClassRecord;
  const output: BacktestResult["series"] = [];
  const returns: number[] = [];
  let invested = 0;
  let previousValue = 0;

  for (let index = startIndex; index < length; index += 1) {
    const history = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, aligned[assetClass].slice(0, index)])) as Record<AssetClass, PricePoint[]>;
    const weights = allocate(history);
    const valueBeforeContribution = ASSET_CLASSES.reduce((sum, assetClass) => sum + units[assetClass] * aligned[assetClass][index].close, 0);
    if (index > startIndex && previousValue > 0) returns.push(valueBeforeContribution / previousValue - 1);
    const contribution = contributionAt(monthlyContribution, contributionForDate, aligned.foreignEquity[index].date, index - startIndex);
    ASSET_CLASSES.forEach((assetClass) => {
      const price = aligned[assetClass][index].close;
      if (price > 0) units[assetClass] += contribution * weights[assetClass] / price;
    });
    const value = ASSET_CLASSES.reduce((sum, assetClass) => sum + units[assetClass] * aligned[assetClass][index].close, 0);
    invested += contribution;
    previousValue = value;
    output.push({ date: aligned.foreignEquity[index].date, invested, value });
  }

  const finalValue = output.at(-1)?.value ?? 0;
  return {
    totalInvested: invested,
    units: ASSET_CLASSES.reduce((sum, assetClass) => sum + units[assetClass], 0),
    finalValue,
    totalReturn: invested ? finalValue / invested - 1 : 0,
    ...returnMetrics(returns),
    series: output,
  };
}

interface StaticOptimizationInput {
  monthlyContribution: number;
  series: Record<AssetClass, PricePoint[]>;
  objective: "balanced" | "maximumReturn";
  maxPeriods?: number;
  contributionForDate?: (date: string, index: number) => number;
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
  const finalPrice = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, aligned[assetClass].at(-1)?.close ?? 0])) as AssetClassRecord;
  const dcaFinalValues = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, aligned[assetClass].reduce(
    (value, point, index) => value + (point.close > 0 ? contributionAt(input.monthlyContribution, input.contributionForDate, point.date, index) * finalPrice[assetClass] / point.close : 0),
    0,
  )])) as AssetClassRecord;
  let bestWeights: AssetClassRecord | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let foreign = minimum; foreign <= maximum; foreign += 1) {
    for (let commodity = minimum; commodity <= maximum; commodity += 1) {
      for (let bitcoin = minimum; bitcoin <= maximum; bitcoin += 1) {
        const turkish = totalUnits - foreign - commodity - bitcoin;
        if (turkish < minimum || turkish > maximum) continue;
        const weights: AssetClassRecord = { foreignEquity: foreign / totalUnits, commodity: commodity / totalUnits, bitcoin: bitcoin / totalUnits, turkishEquity: turkish / totalUnits };
        const score = input.objective === "maximumReturn"
          ? ASSET_CLASSES.reduce((sum, assetClass) => sum + weights[assetClass] * dcaFinalValues[assetClass], 0)
          : portfolioRiskScore(aligned, weights);
        if (!bestWeights || score > bestScore + 1e-12) {
          bestWeights = weights;
          bestScore = score;
        }
      }
    }
  }
  if (!bestWeights) throw new Error("Optimum dağılım hesaplanamadı.");
  return {
    weights: bestWeights,
    result: runAllocationBacktest({ monthlyContribution: input.monthlyContribution, contributionForDate: input.contributionForDate, series: aligned, allocate: () => bestWeights! }),
    score: bestScore,
  };
}

export function optimizeBalancedConsensus(input: Omit<StaticOptimizationInput, "objective" | "maxPeriods"> & { periods?: number[] }) {
  const aligned = alignMonthlySeries(input.series);
  const requested = input.periods ?? [12, 36, 60, 120];
  const periods = requested.filter((period) => period > 1 && period <= aligned.foreignEquity.length);
  if (periods.length === 0) throw new Error("Çok dönemli dengeli optimum için yeterli ortak geçmiş yok.");
  const optimizations = periods.map((maxPeriods) => optimizeStaticAllocation({
    monthlyContribution: input.monthlyContribution,
    contributionForDate: input.contributionForDate,
    series: aligned,
    objective: "balanced",
    maxPeriods,
  }));
  return { periods, optimizations, weights: averageAllocationWeights(optimizations.map((item) => item.weights)) };
}

interface PerfectForesightInput {
  monthlyContribution: number;
  series: Record<AssetClass, PricePoint[]>;
  maxPeriods?: number;
  contributionForDate?: (date: string, index: number) => number;
}

export function runPerfectForesightBacktest(input: PerfectForesightInput) {
  const aligned = alignMonthlySeries(input.series, input.maxPeriods);
  const length = aligned.foreignEquity.length;
  const units = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, 0])) as AssetClassRecord;
  const contributed = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, 0])) as AssetClassRecord;
  const fullGrowth = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, aligned[assetClass].at(-1)!.close / aligned[assetClass][0].close])) as AssetClassRecord;
  const monthlyChoices: Array<{ date: string; assetClass: AssetClass; contribution: number }> = [];
  const output: BacktestResult["series"] = [];
  let invested = 0;
  let previousValue = 0;
  const returns: number[] = [];
  for (let index = 0; index < length; index += 1) {
    const choice = ASSET_CLASSES.reduce((best, assetClass) => {
      const finalRatio = aligned[assetClass].at(-1)!.close / aligned[assetClass][index].close;
      const bestRatio = aligned[best].at(-1)!.close / aligned[best][index].close;
      return finalRatio > bestRatio + 1e-12 || (Math.abs(finalRatio - bestRatio) <= 1e-12 && fullGrowth[assetClass] > fullGrowth[best]) ? assetClass : best;
    }, ASSET_CLASSES[0]);
    const valueBeforeContribution = ASSET_CLASSES.reduce((sum, assetClass) => sum + units[assetClass] * aligned[assetClass][index].close, 0);
    if (index > 0 && previousValue > 0) returns.push(valueBeforeContribution / previousValue - 1);
    const contribution = contributionAt(input.monthlyContribution, input.contributionForDate, aligned.foreignEquity[index].date, index);
    units[choice] += contribution / aligned[choice][index].close;
    contributed[choice] += contribution;
    monthlyChoices.push({ date: aligned.foreignEquity[index].date, assetClass: choice, contribution });
    const value = ASSET_CLASSES.reduce((sum, assetClass) => sum + units[assetClass] * aligned[assetClass][index].close, 0);
    invested += contribution;
    previousValue = value;
    output.push({ date: aligned.foreignEquity[index].date, invested, value });
  }
  const totalInvested = invested;
  const finalValue = output.at(-1)?.value ?? 0;
  const metrics = returnMetrics(returns);
  const result: BacktestResult = {
    totalInvested,
    units: ASSET_CLASSES.reduce((sum, assetClass) => sum + units[assetClass], 0),
    finalValue,
    totalReturn: totalInvested ? finalValue / totalInvested - 1 : 0,
    ...metrics,
    series: output,
  };
  const weights = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, invested ? contributed[assetClass] / invested : 0])) as AssetClassRecord;
  return { result, weights, monthlyChoices };
}

export function valueAtOrBefore(points: PricePoint[], date: string): number | undefined {
  return [...points]
    .filter((point) => point.close > 0 && point.date <= date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1)?.close;
}

export function convertTrySeriesToUsd(points: PricePoint[], usdTry: PricePoint[]): PricePoint[] {
  return [...points].sort((a, b) => a.date.localeCompare(b.date)).flatMap((point) => {
    const rate = valueAtOrBefore(usdTry, point.date);
    if (!rate) return [];
    return [{
      ...point,
      close: point.close / rate,
      open: point.open == null ? undefined : point.open / rate,
      high: point.high == null ? undefined : point.high / rate,
      low: point.low == null ? undefined : point.low / rate,
    }];
  });
}

export function applyUsdInflation(result: BacktestResult, cpi: PricePoint[]): BacktestResult {
  let priorInvested = 0;
  let basketUnits = 0;
  const series = result.series.map((point) => {
    const cpiValue = valueAtOrBefore(cpi, point.date);
    if (!cpiValue) throw new Error(`${point.date.slice(0, 7)} için ABD TÜFE verisi bulunamadı.`);
    const contribution = point.invested - priorInvested;
    priorInvested = point.invested;
    basketUnits += contribution / cpiValue;
    return { ...point, inflationHurdle: basketUnits * cpiValue };
  });
  const inflationAdjustedInvested = series.at(-1)?.inflationHurdle ?? 0;
  return {
    ...result,
    series,
    inflationAdjustedInvested,
    realReturn: inflationAdjustedInvested > 0 ? result.finalValue / inflationAdjustedInvested - 1 : 0,
  };
}
