interface GoalProjectionInput {
  monthlyContribution: number;
  targetToday: number;
  annualReturn: number;
  annualInflation: number;
  maxYears?: number;
}

interface RequiredContributionInput {
  targetToday: number;
  years: number;
  annualReturn: number;
  annualInflation: number;
}

function assertInputs(...values: number[]) {
  if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error("Hedef girdileri negatif olamaz.");
}

export function inflationAdjustedTarget(targetToday: number, annualInflation: number, years: number) {
  assertInputs(targetToday, annualInflation, years);
  return targetToday * (1 + annualInflation) ** years;
}

export function monthsToInflationAdjustedGoal(input: GoalProjectionInput): number | null {
  assertInputs(input.monthlyContribution, input.targetToday, input.annualReturn, input.annualInflation);
  if (input.monthlyContribution <= 0 || input.targetToday <= 0) return null;
  const monthlyReturn = (1 + input.annualReturn) ** (1 / 12) - 1;
  const maxMonths = Math.round((input.maxYears ?? 100) * 12);
  let balance = 0;
  for (let month = 1; month <= maxMonths; month += 1) {
    balance = balance * (1 + monthlyReturn) + input.monthlyContribution;
    const movingTarget = inflationAdjustedTarget(input.targetToday, input.annualInflation, month / 12);
    if (balance >= movingTarget) return month;
  }
  return null;
}

export function requiredMonthlyContributionForHorizon(input: RequiredContributionInput) {
  assertInputs(input.targetToday, input.years, input.annualReturn, input.annualInflation);
  if (input.years <= 0 || input.targetToday <= 0) return 0;
  const months = Math.round(input.years * 12);
  const targetAtHorizon = inflationAdjustedTarget(input.targetToday, input.annualInflation, input.years);
  const monthlyReturn = (1 + input.annualReturn) ** (1 / 12) - 1;
  if (monthlyReturn === 0) return targetAtHorizon / months;
  return targetAtHorizon * monthlyReturn / ((1 + monthlyReturn) ** months - 1);
}

export function trailingYearInflation(points: PricePoint[]): number | undefined {
  const ordered = [...points].filter((point) => point.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  const latest = ordered.at(-1);
  if (!latest) return undefined;
  const comparisonDate = new Date(latest.date);
  comparisonDate.setUTCFullYear(comparisonDate.getUTCFullYear() - 1);
  const previous = ordered.filter((point) => new Date(point.date) <= comparisonDate).at(-1);
  return previous ? latest.close / previous.close - 1 : undefined;
}
import type { PricePoint } from "./types";
