import {
  DEFAULT_ANNUAL_CONTRIBUTION_MONTH,
  DEFAULT_ANNUAL_CONTRIBUTION_USD,
  DEFAULT_MONTHLY_BUDGET_USD,
} from "./config";

export interface StrategyProfile {
  monthlyContributionUsd: number;
  annualContributionUsd: number;
  annualContributionMonth: number;
  coreShare: number;
  tacticalShare: number;
  reserveShare: number;
  perTradeRisk: number;
  minRiskReward: number;
  minConfidence: number;
  targetRealReturnMin: number;
  targetRealReturnMax: number;
}

export interface ContributionPlan {
  total: number;
  core: number;
  tactical: number;
  reserve: number;
  annualImmediateCore: number;
  annualStaged: number;
  tacticalShareApplied: number;
}

export const DEFAULT_STRATEGY_PROFILE: Readonly<StrategyProfile> = Object.freeze({
  monthlyContributionUsd: DEFAULT_MONTHLY_BUDGET_USD,
  annualContributionUsd: DEFAULT_ANNUAL_CONTRIBUTION_USD,
  annualContributionMonth: DEFAULT_ANNUAL_CONTRIBUTION_MONTH,
  coreShare: 0.7,
  tacticalShare: 0.2,
  reserveShare: 0.1,
  perTradeRisk: 0.005,
  minRiskReward: 2,
  minConfidence: 0.6,
  targetRealReturnMin: 0.1,
  targetRealReturnMax: 0.11,
});

const roundMoney = (value: number) => Math.round(value * 100) / 100;

function assertProfile(profile: StrategyProfile, month: number) {
  const shares = profile.coreShare + profile.tacticalShare + profile.reserveShare;
  if (Math.abs(shares - 1) > 1e-9) throw new Error("Katman oranları toplam yüzde 100 olmalı.");
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error("Ay 1 ile 12 arasında olmalı.");
  if (!Number.isFinite(profile.monthlyContributionUsd) || profile.monthlyContributionUsd <= 0) throw new Error("Aylık katkı sıfırdan büyük olmalı.");
  if (!Number.isFinite(profile.annualContributionUsd) || profile.annualContributionUsd < 0) throw new Error("Yıllık katkı negatif olamaz.");
  if (!Number.isInteger(profile.annualContributionMonth) || profile.annualContributionMonth < 1 || profile.annualContributionMonth > 12) throw new Error("Yıllık katkı ayı 1 ile 12 arasında olmalı.");
}

export function tacticalShareForDrawdown(baseShare: number, drawdown: number): number {
  const boundedBase = Math.min(0.25, Math.max(0, baseShare));
  if (drawdown <= -0.18) return 0;
  if (drawdown <= -0.12) return boundedBase / 2;
  return boundedBase;
}

function stagedMonths(annualMonth: number) {
  return [annualMonth, annualMonth % 12 + 1, (annualMonth + 1) % 12 + 1];
}

export function buildContributionPlan(
  profile: StrategyProfile,
  month: number,
  options: { hasEligibleSetup: boolean; tacticalDrawdown?: number },
): ContributionPlan {
  assertProfile(profile, month);
  const annualImmediateCore = month === profile.annualContributionMonth
    ? roundMoney(profile.annualContributionUsd / 2)
    : 0;
  const annualStaged = stagedMonths(profile.annualContributionMonth).includes(month)
    ? roundMoney(profile.annualContributionUsd / 6)
    : 0;
  const tacticalShareApplied = options.hasEligibleSetup
    ? tacticalShareForDrawdown(profile.tacticalShare, options.tacticalDrawdown ?? 0)
    : 0;
  const core = roundMoney(profile.monthlyContributionUsd * profile.coreShare + annualImmediateCore);
  const tactical = roundMoney(profile.monthlyContributionUsd * tacticalShareApplied);
  const total = roundMoney(profile.monthlyContributionUsd + annualImmediateCore + annualStaged);
  const reserve = roundMoney(total - core - tactical);
  return { total, core, tactical, reserve, annualImmediateCore, annualStaged, tacticalShareApplied };
}
