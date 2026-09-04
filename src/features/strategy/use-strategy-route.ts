"use client";

import { useCallback, useEffect, useState } from "react";
import { calculatePortfolio } from "@/lib/domain/portfolio";
import { buildContributionPlan, DEFAULT_STRATEGY_PROFILE, type ContributionPlan, type StrategyProfile } from "@/lib/domain/strategy";
import { deriveTacticalSetup, type TacticalSetup } from "@/lib/domain/tactical";
import type { MarketSnapshot, PricePoint } from "@/lib/domain/types";
import { portfolioRepository } from "@/lib/storage/portfolio-repository";
import { normalizeUserSettings, settingsRepository, type UserSettings } from "@/lib/storage/settings-repository";

const tacticalUniverse = [
  { symbol: "SP500", name: "S&P 500" },
  { symbol: "QQQM", name: "Nasdaq 100" },
  { symbol: "BTC", name: "Bitcoin" },
  { symbol: "GOLD", name: "Altın" },
  { symbol: "BIST100", name: "BIST 100" },
] as const;

export interface StrategyRouteState {
  plan: ContributionPlan;
  profile: StrategyProfile;
  setups: TacticalSetup[];
  usdTry?: number;
  portfolioValueUsd: number;
  portfolioValueEstimated: boolean;
  loading: boolean;
  errors: string[];
  refresh: () => Promise<void>;
}

function profileFromSettings(settings: UserSettings): StrategyProfile {
  return {
    ...DEFAULT_STRATEGY_PROFILE,
    monthlyContributionUsd: settings.monthlyBudgetUsd,
    annualContributionUsd: settings.annualContributionUsd,
    annualContributionMonth: settings.annualContributionMonth,
    tacticalShare: settings.tacticalShare,
    reserveShare: 0.3 - settings.tacticalShare,
    perTradeRisk: settings.perTradeRisk,
    minRiskReward: settings.minRiskReward,
    minConfidence: settings.minConfidence,
  };
}

async function fetchQuoteMap(symbols: string[]) {
  const response = await fetch(`/api/market/quotes?symbols=${encodeURIComponent(symbols.join(","))}`);
  const payload = await response.json() as Record<string, { ok?: boolean; data?: MarketSnapshot }>;
  if (!response.ok) throw new Error("Portföy fiyatları alınamadı.");
  return Object.fromEntries(Object.entries(payload).flatMap(([symbol, result]) => result.ok && result.data ? [[symbol, result.data]] : [])) as Record<string, MarketSnapshot>;
}

async function portfolioRiskBase(settings: UserSettings, usdTry?: number) {
  const fallback = settings.monthlyBudgetUsd * 12 + settings.annualContributionUsd;
  if (!usdTry) return { value: fallback, estimated: true };
  const transactions = await portfolioRepository.list().catch(() => []);
  if (!transactions.length) return { value: fallback, estimated: true };
  const symbols = [...new Set([...transactions.map((transaction) => transaction.symbol), "USDTRY"])];
  const quotes = await fetchQuoteMap(symbols);
  const summary = calculatePortfolio(transactions, quotes, { TRY: 1, USD: usdTry });
  const currentUsd = summary.currentValue / usdTry;
  return currentUsd > 0 ? { value: currentUsd, estimated: false } : { value: fallback, estimated: true };
}

export function useStrategyRoute(): StrategyRouteState {
  const initialSettings = normalizeUserSettings();
  const initialProfile = profileFromSettings(initialSettings);
  const [state, setState] = useState<Omit<StrategyRouteState, "refresh">>({
    plan: buildContributionPlan(initialProfile, new Date().getMonth() + 1, { hasEligibleSetup: false }),
    profile: initialProfile,
    setups: [],
    portfolioValueUsd: initialProfile.monthlyContributionUsd * 12 + initialProfile.annualContributionUsd,
    portfolioValueEstimated: true,
    loading: true,
    errors: [],
  });

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, errors: [] }));
    const settings = await settingsRepository.get();
    const profile = profileFromSettings(settings);
    const errors: string[] = [];
    let usdTry: number | undefined;
    try {
      const quotes = await fetchQuoteMap(["USDTRY"]);
      usdTry = quotes.USDTRY?.price;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "USD/TRY alınamadı.");
    }
    const riskBase = await portfolioRiskBase(settings, usdTry).catch(() => ({ value: settings.monthlyBudgetUsd * 12 + settings.annualContributionUsd, estimated: true }));
    const results = await Promise.all(tacticalUniverse.map(async (asset) => {
      try {
        const response = await fetch(`/api/market/history?symbol=${asset.symbol}&range=10y`);
        const payload = await response.json() as { points?: PricePoint[]; error?: string };
        if (!response.ok || !payload.points) throw new Error(payload.error ?? "geçmiş veri yok");
        return deriveTacticalSetup({ ...asset, prices: payload.points, portfolioValueUsd: riskBase.value, profile });
      } catch (error) {
        errors.push(`${asset.name}: ${error instanceof Error ? error.message : "veri alınamadı"}`);
        return undefined;
      }
    }));
    const setups = results.filter((setup): setup is TacticalSetup => Boolean(setup)).sort((a, b) => b.confidence - a.confidence);
    const plan = buildContributionPlan(profile, new Date().getMonth() + 1, { hasEligibleSetup: setups.some((setup) => setup.action === "long") });
    setState({ plan, profile, setups, usdTry, portfolioValueUsd: riskBase.value, portfolioValueEstimated: riskBase.estimated, loading: false, errors });
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  return { ...state, refresh };
}
