import { DEFAULT_MONTHLY_BUDGET_USD, DEFAULT_TARGET_USD } from "../domain/config";
import { investmentDb } from "./db";

export interface UserSettings {
  monthlyBudgetUsd: number;
  targetUsd: number;
  riskAnswersCompleted: boolean;
}

type StoredSettings = Partial<UserSettings> & { monthlyBudget?: number };

const defaults: UserSettings = { monthlyBudgetUsd: DEFAULT_MONTHLY_BUDGET_USD, targetUsd: DEFAULT_TARGET_USD, riskAnswersCompleted: false };

export function normalizeUserSettings(value?: StoredSettings): UserSettings {
  return {
    monthlyBudgetUsd: value?.monthlyBudgetUsd && value.monthlyBudgetUsd > 0 ? value.monthlyBudgetUsd : defaults.monthlyBudgetUsd,
    targetUsd: value?.targetUsd && value.targetUsd > 0 ? value.targetUsd : defaults.targetUsd,
    riskAnswersCompleted: value?.riskAnswersCompleted ?? false,
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
