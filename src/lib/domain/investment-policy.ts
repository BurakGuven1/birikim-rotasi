import { z } from "zod";
import { DCA_WEIGHTS } from "./dca-policy";

export const investmentPolicySchema = z.object({
  version: z.literal(3).default(3),
  allocationMode: z.enum(["dca", "opportunity", "legacy"]).default("dca"),
  dcaAllocation: z.enum(["rebalance", "fixed"]).default("rebalance"),
  dcaWeights: z.object({bitcoin:z.number().min(0).max(.4),foreignEquity:z.number().min(0).max(1),commodity:z.number().min(0).max(1),turkishEquity:z.number().min(0).max(1)}).refine(w=>Math.abs(Object.values(w).reduce((a,b)=>a+b,0)-1)<1e-8,"Sepet yüzdeleri toplamı %100 olmalı; BTC en çok %40.").default(DCA_WEIGHTS),
  annualContributionUsd: z.number().min(0).max(1e8).default(3500),
  annualContributionMonth: z.number().int().min(1).max(12).default(4),
  firstAnnualYear: z.number().int().min(2026).max(2100).default(2027),
  annualDateEstimated: z.boolean().default(true),
  startDate: z.iso.date().default("2026-12-05"),
  contributionDay: z.number().int().min(1).max(28).default(5),
  riskLevel: z.enum(["cautious", "balanced", "growth"]).default("balanced"),
  horizonYears: z.number().int().min(1).max(40).nullable().default(10),
  maxDrawdown: z.number().min(0.05).max(0.6).nullable().default(null),
  hasEmergencyFund: z.boolean().nullable().default(true),
  emergencyMonths: z.number().min(0).max(120).nullable().default(null),
  highInterestDebt: z.boolean().nullable().default(null),
  feeBps: z.number().min(0).max(500).default(30),
  minOrderUsd: z.number().min(1).max(1000).default(25),
  cashReserveUsd: z.number().min(0).max(1e9).default(0),
  leverageIdeas: z.boolean().default(true),
});

export type InvestmentPolicy = z.infer<typeof investmentPolicySchema>;
export const DEFAULT_INVESTMENT_POLICY = investmentPolicySchema.parse({});
export function normalizeInvestmentPolicy(value: unknown): InvestmentPolicy {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const fields = Object.entries(investmentPolicySchema.shape).map(([key, schema]) => {
    const parsed = schema.safeParse(source[key]);
    return [key, parsed.success ? parsed.data : ["horizonYears", "maxDrawdown", "hasEmergencyFund", "emergencyMonths", "highInterestDebt"].includes(key) ? null : DEFAULT_INVESTMENT_POLICY[key as keyof InvestmentPolicy]];
  });
  const normalized = Object.fromEntries(fields);
  if (source.version !== 3) normalized.allocationMode = "dca";
  // Adopt the explicitly approved December schedule for the former shipped default only.
  if (source.version !== 2 && source.version !== 3 && source.startDate === "2026-10-05") normalized.startDate = "2026-12-05";
  return investmentPolicySchema.parse(normalized);
}

export function investmentProfileIssues(policy: InvestmentPolicy) {
  const missing: string[] = [];
  const blockers: string[] = [];
  if (policy.horizonYears === null) missing.push("Yatırım vadesini belirt.");
  if (policy.maxDrawdown === null && policy.allocationMode === "legacy") missing.push("Geçici düşüş toleransını seç.");
  if (policy.hasEmergencyFund === null) missing.push("Acil durum birikimini belirt.");
  if (policy.highInterestDebt === null) missing.push("Yüksek faizli borç durumunu belirt.");
  if (policy.hasEmergencyFund === false || (policy.emergencyMonths !== null && policy.emergencyMonths < 3)) blockers.push("Önce portföyden ayrı acil durum birikimini tamamla.");
  if (policy.highInterestDebt === true) blockers.push("Yüksek faizli borcun maliyetini azaltmadan yeni risk alma.");
  if (policy.horizonYears !== null && policy.horizonYears < 5) blockers.push("Ev hedefine beş yıldan az kaldı: bu büyüme sepeti yerine vadeye uygun likit araçları değerlendir.");
  if (policy.maxDrawdown !== null && policy.maxDrawdown < 0.2) blockers.push("%20 altı düşüş toleransı bu riskli sepetle uyumlu değil; sermaye koruma planı gerekli.");
  return { missing, blockers };
}
