import { investmentPolicySchema, normalizeInvestmentPolicy, type InvestmentPolicy } from "../domain/investment-policy";
import type { MonthlyInvestment } from "../domain/monthly-investment";
import { investmentDb } from "./db";

export interface InvestmentDecision {
  id: string;
  month: string;
  savedAt: string;
  policy: InvestmentPolicy;
  plan: MonthlyInvestment;
}

export const investmentRepository = {
  async getPolicy() {
    if (!investmentDb) return normalizeInvestmentPolicy({});
    return normalizeInvestmentPolicy((await investmentDb.settings.get("investment-policy"))?.value ?? {});
  },
  async savePolicy(value: InvestmentPolicy) {
    const policy = investmentPolicySchema.parse(value);
    if (!investmentDb) throw new Error("Bu tarayıcıda yerel kayıt kullanılamıyor.");
    await investmentDb.settings.put({ key: "investment-policy", value: policy });
    return policy;
  },
  async decisions(): Promise<InvestmentDecision[]> {
    if (!investmentDb) return [];
    return (await investmentDb.settings.toArray()).filter(row => row.key.startsWith("decision:")).map(row => row.value as InvestmentDecision).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  },
  async saveDecision(month: string, policy: InvestmentPolicy, plan: MonthlyInvestment) {
    if (!investmentDb) throw new Error("Bu tarayıcıda yerel kayıt kullanılamıyor.");
    const decision: InvestmentDecision = { id: crypto.randomUUID(), month, savedAt: new Date().toISOString(), policy: investmentPolicySchema.parse(policy), plan };
    await investmentDb.settings.put({ key: `decision:${decision.id}`, value: decision });
    return decision;
  },
};

export function downloadInvestmentFile(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
