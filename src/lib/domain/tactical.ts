import type { StrategyProfile } from "./strategy";
import type { PricePoint } from "./types";

export interface TacticalSetup {
  id: string;
  symbol: string;
  name: string;
  action: "long" | "wait";
  generatedAt: string;
  expiresAt: string;
  entryZone: [number, number];
  invalidation: number;
  targetZones: [number, number];
  riskReward: number;
  confidence: number;
  positionSizeUsd: number;
  portfolioRiskUsd: number;
  reasons: string[];
}

interface DeriveTacticalSetupInput {
  symbol: string;
  name: string;
  prices: PricePoint[];
  portfolioValueUsd: number;
  profile: StrategyProfile;
}

interface PositionSizeInput {
  portfolioValueUsd: number;
  entry: number;
  invalidation: number;
  perTradeRisk: number;
  tacticalCapShare: number;
}

interface TacticalBudgetReviewInput {
  baseShare: number;
  completedTrades: number;
  monthsObserved: number;
  benchmarkDelta: number;
  maximumDrawdown: number;
  consecutiveFailedReviews: number;
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const roundMoney = (value: number) => Math.round(value * 100) / 100;
const roundPrice = (value: number) => Math.round(value * 10_000) / 10_000;

function movingAverage(points: PricePoint[], periods: number) {
  return average(points.slice(-periods).map((point) => point.close));
}

function averageTrueRange(points: PricePoint[], periods = 14) {
  const start = Math.max(1, points.length - periods);
  const ranges = points.slice(start).map((point, index) => {
    const previousClose = points[start + index - 1].close;
    const high = point.high ?? Math.max(point.close, previousClose);
    const low = point.low ?? Math.min(point.close, previousClose);
    return Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
  });
  return average(ranges);
}

function addDays(date: string, days: number) {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString();
}

export function calculatePositionSize(input: PositionSizeInput): number {
  if (input.portfolioValueUsd <= 0 || input.entry <= 0 || input.invalidation >= input.entry) return 0;
  const distanceFraction = (input.entry - input.invalidation) / input.entry;
  if (distanceFraction <= 0) return 0;
  const riskSized = input.portfolioValueUsd * clamp(input.perTradeRisk, 0, 0.02) / distanceFraction;
  const sleeveCap = input.portfolioValueUsd * clamp(input.tacticalCapShare, 0, 0.25);
  return roundMoney(Math.max(0, Math.min(riskSized, sleeveCap)));
}

function waitSetup(input: DeriveTacticalSetupInput, latest: PricePoint | undefined, reasons: string[]): TacticalSetup {
  const price = latest?.close ?? 0;
  const generatedAt = latest?.date ?? new Date(0).toISOString();
  return {
    id: `${input.symbol.toUpperCase()}-${generatedAt.slice(0, 10)}`,
    symbol: input.symbol.toUpperCase(),
    name: input.name,
    action: "wait",
    generatedAt,
    expiresAt: addDays(generatedAt, 7),
    entryZone: [price, price],
    invalidation: price,
    targetZones: [price, price],
    riskReward: 0,
    confidence: 0,
    positionSizeUsd: 0,
    portfolioRiskUsd: 0,
    reasons,
  };
}

export function deriveTacticalSetup(input: DeriveTacticalSetupInput): TacticalSetup {
  const points = [...input.prices]
    .filter((point) => Number.isFinite(point.close) && point.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = points.at(-1);
  if (points.length < 200) return waitSetup(input, latest, ["En az 200 işlem günü geçmişi gerekiyor."]);

  const current = latest!.close;
  const sma50 = movingAverage(points, 50);
  const sma200 = movingAverage(points, 200);
  const oneMonthAgo = points.at(-22)!.close;
  const sixMonthsAgo = points.at(-127)?.close ?? points[0].close;
  const twelveMonthsAgo = points.at(-253)?.close ?? points[0].close;
  const momentumSixToOne = oneMonthAgo / sixMonthsAgo - 1;
  const momentumTwelveToOne = oneMonthAgo / twelveMonthsAgo - 1;
  const atr = Math.max(averageTrueRange(points), current * 0.005);
  const aboveLongTrend = current > sma200;
  const alignedTrend = sma50 > sma200;
  const positiveMomentum = momentumSixToOne > 0 && momentumTwelveToOne > 0;
  const notExtended = current <= sma50 + atr * 4;
  const confidence = clamp(
    0.2
      + (aboveLongTrend ? 0.2 : 0)
      + (alignedTrend ? 0.2 : 0)
      + (momentumSixToOne > 0 ? 0.15 : 0)
      + (momentumTwelveToOne > 0 ? 0.15 : 0)
      + (notExtended ? 0.1 : 0),
  );
  const entryZone: [number, number] = [roundPrice(current - atr * 0.25), roundPrice(current + atr * 0.1)];
  const entry = current;
  const invalidation = roundPrice(current - atr * 2);
  const targetZones: [number, number] = [roundPrice(current + atr * 4), roundPrice(current + atr * 6)];
  const riskReward = (targetZones[0] - entry) / (entry - invalidation);
  const eligible = aboveLongTrend
    && alignedTrend
    && positiveMomentum
    && confidence >= input.profile.minConfidence
    && riskReward >= input.profile.minRiskReward;
  const reasons = [
    `Fiyat 200 günlük ortalamanın %${((current / sma200 - 1) * 100).toFixed(1)} üzerinde.`,
    `50 günlük ortalama uzun trendin %${((sma50 / sma200 - 1) * 100).toFixed(1)} üzerinde.`,
    `12–1 aylık momentum %${(momentumTwelveToOne * 100).toFixed(1)}, 6–1 aylık momentum %${(momentumSixToOne * 100).toFixed(1)}.`,
  ];
  if (!notExtended) reasons.push("Fiyat kısa trendden fazla uzak; yeni giriş yerine geri çekilme bekleniyor.");
  if (!eligible) reasons.push("Trend, momentum, güven ve getiri/risk koşullarının tamamı aynı anda sağlanmadı.");
  if (!eligible) return { ...waitSetup(input, latest, reasons), confidence, entryZone, invalidation, targetZones, riskReward };

  const positionSizeUsd = calculatePositionSize({
    portfolioValueUsd: input.portfolioValueUsd,
    entry,
    invalidation,
    perTradeRisk: input.profile.perTradeRisk,
    tacticalCapShare: Math.min(0.25, input.profile.tacticalShare),
  });
  const portfolioRiskUsd = roundMoney(positionSizeUsd * ((entry - invalidation) / entry));
  return {
    id: `${input.symbol.toUpperCase()}-${latest!.date.slice(0, 10)}`,
    symbol: input.symbol.toUpperCase(),
    name: input.name,
    action: "long",
    generatedAt: latest!.date,
    expiresAt: addDays(latest!.date, 7),
    entryZone,
    invalidation,
    targetZones,
    riskReward,
    confidence,
    positionSizeUsd,
    portfolioRiskUsd,
    reasons,
  };
}

export function reviewTacticalBudget(input: TacticalBudgetReviewInput): number {
  const base = clamp(input.baseShare, 0, 0.25);
  if (input.completedTrades < 12 || input.monthsObserved < 12) return base;
  if (input.consecutiveFailedReviews >= 2) return 0;
  if (input.benchmarkDelta < 0 || input.maximumDrawdown < -0.12) return Math.min(base, 0.1);
  return base;
}
