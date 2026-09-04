import { maxDrawdown, type BacktestResult } from "./backtest";
import type { StrategyProfile } from "./strategy";
import { deriveTacticalSetup, type TacticalSetup } from "./tactical";
import type { PricePoint } from "./types";

interface TacticalSetupFactoryInput {
  symbol: string;
  name: string;
  prices: PricePoint[];
  portfolioValueUsd: number;
  profile: StrategyProfile;
}

export type TacticalSetupFactory = (input: TacticalSetupFactoryInput) => TacticalSetup;

interface CoreTacticalBacktestInput {
  monthlyContribution: number;
  annualContribution: number;
  annualContributionMonth: number;
  corePrices: PricePoint[];
  tacticalPrices: PricePoint[];
  profile: StrategyProfile;
  tacticalSymbol?: string;
  tacticalName?: string;
  setupFactory?: TacticalSetupFactory;
  spreadBps?: number;
  commissionUsd?: number;
  maxPeriods?: number;
}

export interface CoreTacticalBacktestResult extends BacktestResult {
  coreOnly: BacktestResult;
  tacticalOnly: {
    realizedPnlUsd: number;
    tradeCount: number;
    winRate: number;
    turnover: number;
    payoffRatio: number;
    profitFactor: number;
  };
  tacticalPnlUsd: number;
  tradeCount: number;
  winRate: number;
  benchmarkFinalValue: number;
  benchmarkDelta: number;
}

interface OpenTrade {
  units: number;
  entryCost: number;
  invalidation: number;
  target: number;
}

const monthKey = (date: string) => date.slice(0, 7);

function addMonths(key: string, count: number) {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + count, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function metrics(returns: number[]) {
  if (!returns.length) return { annualizedReturn: 0, maximumDrawdown: 0, volatility: 0 };
  const wealth = returns.reduce<number[]>((values, value) => [...values, values.at(-1)! * (1 + value)], [1]);
  const annualizedReturn = wealth.at(-1)! ** (252 / returns.length) - 1;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.length < 2
    ? 0
    : returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return {
    annualizedReturn,
    maximumDrawdown: maxDrawdown(wealth),
    volatility: Math.sqrt(variance) * Math.sqrt(252),
  };
}

function validPrices(points: PricePoint[]) {
  return [...points]
    .filter((point) => Number.isFinite(point.close) && point.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function runCoreTacticalBacktest(input: CoreTacticalBacktestInput): CoreTacticalBacktestResult {
  if (!Number.isFinite(input.monthlyContribution) || input.monthlyContribution <= 0) {
    throw new Error("Aylık katkı sıfırdan büyük olmalı.");
  }
  if (!Number.isFinite(input.annualContribution) || input.annualContribution < 0) {
    throw new Error("Yıllık ek katkı negatif olamaz.");
  }
  if (!Number.isInteger(input.annualContributionMonth) || input.annualContributionMonth < 1 || input.annualContributionMonth > 12) {
    throw new Error("Yıllık ek katkı ayı 1 ile 12 arasında olmalı.");
  }

  const tactical = validPrices(input.tacticalPrices);
  const coreByDate = new Map(validPrices(input.corePrices).map((point) => [point.date.slice(0, 10), point]));
  const common = tactical.filter((point) => coreByDate.has(point.date.slice(0, 10)));
  const requestedMonths = input.maxPeriods;
  const selectedMonthKeys = requestedMonths
    ? [...new Set(common.map((point) => monthKey(point.date)))].slice(-requestedMonths)
    : undefined;
  const selected = selectedMonthKeys?.length
    ? common.filter((point) => monthKey(point.date) >= selectedMonthKeys[0])
    : common;
  const setupFactory = input.setupFactory ?? deriveTacticalSetup;
  const spreadHalf = Math.max(0, input.spreadBps ?? 8) / 20_000;
  const commission = Math.max(0, input.commissionUsd ?? 0.5);
  const symbol = input.tacticalSymbol ?? "BTC";
  const name = input.tacticalName ?? "Bitcoin";
  const stagedCore = new Map<string, number>();
  const monthlyOutput = new Map<string, BacktestResult["series"][number]>();
  const benchmarkOutput = new Map<string, BacktestResult["series"][number]>();
  const returns: number[] = [];
  const benchmarkReturns: number[] = [];

  let cash = 0;
  let coreUnits = 0;
  let tacticalUnits = 0;
  let benchmarkUnits = 0;
  let invested = 0;
  let previousValue = 0;
  let previousBenchmarkValue = 0;
  let previousMonth = "";
  let pending: TacticalSetup | undefined;
  let openTrade: OpenTrade | undefined;
  let tacticalPnlUsd = 0;
  let tradeCount = 0;
  let winningTrades = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let grossTradedNotional = 0;

  selected.forEach((tacticalPoint, index) => {
    const dateKey = tacticalPoint.date.slice(0, 10);
    const corePoint = coreByDate.get(dateKey)!;
    const currentMonth = monthKey(tacticalPoint.date);
    let externalContribution = 0;

    if (currentMonth !== previousMonth) {
      const calendarMonth = new Date(tacticalPoint.date).getUTCMonth() + 1;
      const annualDeposit = calendarMonth === input.annualContributionMonth ? input.annualContribution : 0;
      externalContribution = input.monthlyContribution + annualDeposit;
      cash += externalContribution;
      invested += externalContribution;
      benchmarkUnits += externalContribution / corePoint.close;

      let coreBudget = input.monthlyContribution * input.profile.coreShare + (stagedCore.get(currentMonth) ?? 0);
      if (annualDeposit > 0) {
        coreBudget += annualDeposit / 2 + annualDeposit / 6;
        stagedCore.set(addMonths(currentMonth, 1), (stagedCore.get(addMonths(currentMonth, 1)) ?? 0) + annualDeposit / 6);
        stagedCore.set(addMonths(currentMonth, 2), (stagedCore.get(addMonths(currentMonth, 2)) ?? 0) + annualDeposit / 6);
      }
      const coreSpend = Math.min(cash, coreBudget);
      coreUnits += coreSpend / corePoint.close;
      cash -= coreSpend;
      previousMonth = currentMonth;
    }

    if (pending && !openTrade) {
      const low = tacticalPoint.low ?? tacticalPoint.close;
      const high = tacticalPoint.high ?? tacticalPoint.close;
      const [entryLow, entryHigh] = pending.entryZone;
      const active = tacticalPoint.date <= pending.expiresAt;
      const touched = low <= entryHigh && high >= entryLow;
      if (active && touched && cash > commission) {
        const reference = tacticalPoint.open ?? tacticalPoint.close;
        const rawEntry = Math.max(entryLow, Math.min(entryHigh, reference));
        const entryPrice = rawEntry * (1 + spreadHalf);
        const notional = Math.min(pending.positionSizeUsd, cash - commission);
        if (notional > 0 && entryPrice > pending.invalidation) {
          tacticalUnits = notional / entryPrice;
          cash -= notional + commission;
          openTrade = {
            units: tacticalUnits,
            entryCost: notional + commission,
            invalidation: pending.invalidation,
            target: pending.targetZones[0],
          };
          grossTradedNotional += notional;
        }
        pending = undefined;
      } else if (!active) {
        pending = undefined;
      }
    }

    if (openTrade) {
      const low = tacticalPoint.low ?? tacticalPoint.close;
      const high = tacticalPoint.high ?? tacticalPoint.close;
      const stopTouched = low <= openTrade.invalidation;
      const targetTouched = high >= openTrade.target;
      if (stopTouched || targetTouched) {
        const rawExit = stopTouched ? openTrade.invalidation : openTrade.target;
        const proceeds = openTrade.units * rawExit * (1 - spreadHalf) - commission;
        const pnl = proceeds - openTrade.entryCost;
        cash += proceeds;
        tacticalPnlUsd += pnl;
        tradeCount += 1;
        if (pnl > 0) winningTrades += 1;
        if (pnl > 0) grossProfit += pnl;
        if (pnl < 0) grossLoss += Math.abs(pnl);
        grossTradedNotional += Math.max(0, proceeds);
        tacticalUnits = 0;
        openTrade = undefined;
      }
    }

    const endValue = cash + coreUnits * corePoint.close + tacticalUnits * tacticalPoint.close;
    const benchmarkValue = benchmarkUnits * corePoint.close;
    if (index > 0 && previousValue > 0) {
      returns.push((endValue - externalContribution) / previousValue - 1);
    }
    if (index > 0 && previousBenchmarkValue > 0) {
      benchmarkReturns.push((benchmarkValue - externalContribution) / previousBenchmarkValue - 1);
    }

    monthlyOutput.set(currentMonth, { date: tacticalPoint.date, invested, value: endValue });
    benchmarkOutput.set(currentMonth, { date: tacticalPoint.date, invested, value: benchmarkValue });
    previousValue = endValue;
    previousBenchmarkValue = benchmarkValue;

    if (!openTrade && !pending) {
      const throughToday = tactical.filter((point) => point.date <= tacticalPoint.date);
      const setup = setupFactory({
        symbol,
        name,
        prices: throughToday,
        portfolioValueUsd: endValue,
        profile: input.profile,
      });
      if (setup.action === "long") pending = setup;
    }
  });

  const series = [...monthlyOutput.values()];
  const finalValue = series.at(-1)?.value ?? 0;
  const lastCore = selected.length ? coreByDate.get(selected.at(-1)!.date.slice(0, 10))!.close : 0;
  const benchmarkFinalValue = benchmarkUnits * lastCore;
  const coreOnlySeries = [...benchmarkOutput.values()];
  const coreOnly: BacktestResult = {
    totalInvested: invested,
    units: benchmarkUnits,
    finalValue: benchmarkFinalValue,
    totalReturn: invested > 0 ? benchmarkFinalValue / invested - 1 : 0,
    ...metrics(benchmarkReturns),
    series: coreOnlySeries,
  };
  const losingTrades = tradeCount - winningTrades;
  const averageWin = winningTrades ? grossProfit / winningTrades : 0;
  const averageLoss = losingTrades ? grossLoss / losingTrades : 0;
  const tacticalOnly = {
    realizedPnlUsd: tacticalPnlUsd,
    tradeCount,
    winRate: tradeCount ? winningTrades / tradeCount : 0,
    turnover: invested > 0 ? grossTradedNotional / invested : 0,
    payoffRatio: averageLoss > 0 ? averageWin / averageLoss : averageWin > 0 ? Number.POSITIVE_INFINITY : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0,
  };
  return {
    totalInvested: invested,
    units: coreUnits + tacticalUnits,
    finalValue,
    totalReturn: invested > 0 ? finalValue / invested - 1 : 0,
    ...metrics(returns),
    series,
    coreOnly,
    tacticalOnly,
    tacticalPnlUsd,
    tradeCount,
    winRate: tradeCount ? winningTrades / tradeCount : 0,
    benchmarkFinalValue,
    benchmarkDelta: benchmarkFinalValue > 0 ? finalValue / benchmarkFinalValue - 1 : 0,
  };
}
