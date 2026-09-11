import { z } from "zod";

export const earnReserveSchema = z.object({
  version: z.literal(1),
  entries: z.array(z.object({ id: z.string().min(1), date: z.iso.date(), kind: z.enum(["deposit", "withdraw", "reward"]), amountUsdt: z.number().positive().max(1e9), note: z.string().max(200).optional() })),
  unavailableUsdt: z.number().nonnegative().max(1e9),
  usdPerUsdt: z.number().positive().max(100),
  rateAsOf: z.union([z.iso.date(), z.literal("")]),
  conversionFeeBps: z.number().min(0).max(1000),
  aprAsOf: z.union([z.iso.date(), z.literal("")]),
  aprTiers: z.array(z.object({ upToUsdt: z.number().positive().nullable(), apr: z.number().min(0).max(1) })).max(10),
});
export type EarnReserveState = z.infer<typeof earnReserveSchema>;
export const EMPTY_EARN_RESERVE: EarnReserveState = { version: 1, entries: [], unavailableUsdt: 0, usdPerUsdt: 1, rateAsOf: "", conversionFeeBps: 0, aprAsOf: "", aprTiers: [] };

export function reserveSummary(raw: EarnReserveState, now = new Date()) {
  const state = earnReserveSchema.parse(raw);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const entries = state.entries.filter(e => e.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  let balanceUsdt = 0, rewardsUsdt = 0, capitalDays = 0;
  const issues: string[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (ids.has(entry.id)) throw new Error("Aynı rezerv kaydı iki kez kullanılamaz.");
    ids.add(entry.id);
    balanceUsdt += entry.kind === "withdraw" ? -entry.amountUsdt : entry.amountUsdt;
    if (balanceUsdt < -0.000001) throw new Error("Rezervden çıkan tutar o günkü bakiyeyi aşıyor.");
    if (entry.kind === "reward") rewardsUsdt += entry.amountUsdt;
    const next = entries[i + 1]?.date ?? today;
    capitalDays += Math.max(0, balanceUsdt) * Math.max(0, (Date.parse(next) - Date.parse(entry.date)) / 86400000);
  }
  const ageDays = (Date.parse(today) - Date.parse(state.rateAsOf)) / 86400000;
  const valuationFresh = balanceUsdt === 0 || (Number.isFinite(ageDays) && ageDays >= 0 && ageDays <= 2);
  if (!valuationFresh) issues.push("USDT/USD değerleme tarihi eski veya eksik; kullanılabilir dolar bütçesini güncelle.");
  if (state.unavailableUsdt > balanceUsdt + 1e-6) issues.push("Kullanılamayan bakiye toplam rezervi aşıyor.");
  const availableUsdt = Math.max(0, balanceUsdt - state.unavailableUsdt);
  estimatedDailyReward(balanceUsdt,state.aprTiers);
  const valueUsd = balanceUsdt * state.usdPerUsdt;
  return { balanceUsdt, availableUsdt, valueUsd, availableUsd: valuationFresh ? availableUsdt * state.usdPerUsdt * (1 - state.conversionFeeBps / 10000) : 0, rewardsUsdt, observedApr: capitalDays > 0 ? rewardsUsdt / capitalDays * 365 : null, valuationFresh, issues };
}

export function estimatedDailyReward(balance: number, tiers: EarnReserveState["aprTiers"]) {
  let prior = 0, daily = 0;
  for (const tier of tiers) {
    const upper = tier.upToUsdt ?? Infinity;
    if (upper <= prior) throw new Error("APR kademeleri artan üst limitler kullanmalı.");
    daily += Math.max(0, Math.min(balance, upper) - prior) * tier.apr / 365;
    prior = upper;
  }
  return daily;
}
