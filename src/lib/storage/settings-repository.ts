import { DEFAULT_MONTHLY_BUDGET } from "../domain/config";
import { investmentDb } from "./db";

export interface UserSettings {
  monthlyBudget: number;
  riskAnswersCompleted: boolean;
}

const defaults: UserSettings = { monthlyBudget: DEFAULT_MONTHLY_BUDGET, riskAnswersCompleted: false };

export const settingsRepository = {
  async get(): Promise<UserSettings> {
    if (!investmentDb) return defaults;
    const row = await investmentDb.settings.get("user");
    return { ...defaults, ...(row?.value as Partial<UserSettings> | undefined) };
  },
  async save(value: UserSettings): Promise<void> {
    if (!investmentDb) return;
    await investmentDb.settings.put({ key: "user", value });
  },
};
