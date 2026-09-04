import { DEFAULT_ANNUAL_CONTRIBUTION_MONTH, DEFAULT_ANNUAL_CONTRIBUTION_USD, DEFAULT_MONTHLY_BUDGET_USD, DEFAULT_TARGET_USD } from "../domain/config";
import { DEFAULT_STRATEGY_PROFILE } from "../domain/strategy";
import { investmentDb } from "./db";

export interface UserSettings {
  monthlyBudgetUsd: number;
  targetUsd: number;
  riskAnswersCompleted: boolean;
  annualContributionUsd: number;
  annualContributionMonth: number;
  tacticalShare: number;
  perTradeRisk: number;
  minRiskReward: number;
  minConfidence: number;
}

type StoredSettings = Partial<UserSettings> & { monthlyBudget?: number };

const defaults: UserSettings = {
  monthlyBudgetUsd: DEFAULT_MONTHLY_BUDGET_USD,
  targetUsd: DEFAULT_TARGET_USD,
  riskAnswersCompleted: false,
  annualContributionUsd: DEFAULT_ANNUAL_CONTRIBUTION_USD,
  annualContributionMonth: DEFAULT_ANNUAL_CONTRIBUTION_MONTH,
  tacticalShare: DEFAULT_STRATEGY_PROFILE.tacticalShare,
  perTradeRisk: DEFAULT_STRATEGY_PROFILE.perTradeRisk,
  minRiskReward: DEFAULT_STRATEGY_PROFILE.minRiskReward,
  minConfidence: DEFAULT_STRATEGY_PROFILE.minConfidence,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function normalizeUserSettings(value?: StoredSettings): UserSettings {
  return {
    monthlyBudgetUsd: value?.monthlyBudgetUsd && value.monthlyBudgetUsd > 0 ? value.monthlyBudgetUsd : defaults.monthlyBudgetUsd,
    targetUsd: value?.targetUsd && value.targetUsd > 0 ? value.targetUsd : defaults.targetUsd,
    riskAnswersCompleted: value?.riskAnswersCompleted ?? false,
    annualContributionUsd: value?.annualContributionUsd != null && value.annualContributionUsd >= 0 ? value.annualContributionUsd : defaults.annualContributionUsd,
    annualContributionMonth: Number.isInteger(value?.annualContributionMonth) && value!.annualContributionMonth! >= 1 && value!.annualContributionMonth! <= 12 ? value!.annualContributionMonth! : defaults.annualContributionMonth,
    tacticalShare: clamp(value?.tacticalShare ?? defaults.tacticalShare, 0, 0.25),
    perTradeRisk: clamp(value?.perTradeRisk ?? defaults.perTradeRisk, 0.001, 0.01),
    minRiskReward: clamp(value?.minRiskReward ?? defaults.minRiskReward, 2, 4),
    minConfidence: clamp(value?.minConfidence ?? defaults.minConfidence, 0.6, 0.9),
  };
}

export const settingsRepository = {
  async get(): Promise<UserSettings> {
    if (!investmentDb) return { ...defaults };
    const row = await investmentDb.settings.get("user");
    return normalizeUserSettings(row?.value as StoredSettings | undefined);
  },
  async save(value: UserSettings): Promise<void> {
    if (!investmentDb) return;
    await investmentDb.settings.put({ key: "user", value });
  },
};
