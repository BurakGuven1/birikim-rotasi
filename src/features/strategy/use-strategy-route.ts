"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { assessInvestmentData, cleanInvestmentHistory, valueInvestmentHoldings } from "@/lib/domain/monthly-investment";
import { investmentProfileIssues } from "@/lib/domain/investment-policy";
import { investmentRepository } from "@/lib/storage/investment-repository";
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

async function portfolioRiskBase(usdTry?: number) {
  const policy = await investmentRepository.getPolicy();
  const issues = investmentProfileIssues(policy);
  if (issues.missing.length || issues.blockers.length) return { value: 0, estimated: true };
  const transactions = await portfolioRepository.list();
  const symbols = [...new Set([...transactions.map((transaction) => transaction.symbol), "USDTRY"])];
  const quotes = await fetchQuoteMap(symbols);
  const summary = valueInvestmentHoldings(transactions, quotes, usdTry, policy.cashReserveUsd, new Date());
  return summary.complete ? { value: Object.values(summary.values).reduce((a, b) => a + b, 0), estimated: false } : { value: 0, estimated: true };
}

export function useStrategyRoute(): StrategyRouteState {
  const generation = useRef(0);
  const initialSettings = normalizeUserSettings();
  const initialProfile = profileFromSettings(initialSettings);
  const [state, setState] = useState<Omit<StrategyRouteState, "refresh">>({
    plan: buildContributionPlan(initialProfile, new Date().getMonth() + 1, { hasEligibleSetup: false }),
    profile: initialProfile,
    setups: [],
    portfolioValueUsd: 0,
    portfolioValueEstimated: true,
    loading: true,
    errors: [],
  });

  const refresh = useCallback(async () => {
    const requestId = ++generation.current;
    setState((current) => ({ ...current, loading: true, errors: [] }));
    const settings = await settingsRepository.get().catch(() => normalizeUserSettings());
    const profile = profileFromSettings(settings);
    const errors: string[] = [];
    let usdTry: number | undefined;
    try {
      const quotes = await fetchQuoteMap(["USDTRY"]);
      const fx = quotes.USDTRY;
      const age = fx ? Date.now() - Date.parse(fx.asOf) : Infinity;
      usdTry = fx && fx.status !== "stale" && age >= -300000 && age < 96 * 3600000 ? fx.price : undefined;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "USD/TRY alınamadı.");
    }
    const riskBase = await portfolioRiskBase(usdTry).catch(() => ({ value: 0, estimated: true }));
    if (!riskBase.value) errors.push("Gerçek sermaye veya tamamlanmış risk profili yok; yeni swing pozisyonu kapalı.");
    const results = await Promise.all(tacticalUniverse.map(async (asset) => {
      try {
        const response = await fetch(`/api/market/history?symbol=${asset.symbol}&range=1y`);
        const payload = await response.json() as { points?: PricePoint[]; error?: string };
        if (!response.ok || !payload.points) throw new Error(payload.error ?? "geçmiş veri yok");
        const quotes = await fetchQuoteMap([asset.symbol]);
        const now = new Date();
        const points = cleanInvestmentHistory(payload.points, now);
        const quality = assessInvestmentData({ quote: quotes[asset.symbol], history: points, source: "Piyasa" }, asset.symbol === "BTC" ? "bitcoin" : "foreignEquity", now);
        const setup = deriveTacticalSetup({ ...asset, prices: points, portfolioValueUsd: riskBase.value, profile });
        if (!quality.usable || !riskBase.value) return { ...setup, action: "wait" as const, positionSizeUsd: 0, portfolioRiskUsd: 0, reasons: [...setup.reasons, !quality.usable ? quality.reason : "Gerçek sermaye veya risk profili eksik."] };
        const quoteExpires = Date.parse(quotes[asset.symbol].asOf) + (asset.symbol === "BTC" ? 45 * 60000 : 96 * 3600000);
        // A capital valuation is valid for this short decision window, not indefinitely.
        return { ...setup, expiresAt: new Date(Math.min(quoteExpires, now.getTime() + 15 * 60000, Date.parse(setup.expiresAt))).toISOString() };
      } catch (error) {
        errors.push(`${asset.name}: ${error instanceof Error ? error.message : "veri alınamadı"}`);
        return undefined;
      }
    }));
    const setups = results.filter((setup): setup is TacticalSetup => Boolean(setup)).sort((a, b) => b.confidence - a.confidence);
    const plan = buildContributionPlan(profile, new Date().getMonth() + 1, { hasEligibleSetup: setups.some((setup) => setup.action === "long") });
    if (requestId === generation.current) setState({ plan, profile, setups, usdTry, portfolioValueUsd: riskBase.value, portfolioValueEstimated: riskBase.estimated, loading: false, errors });
  }, []);

  useEffect(() => {
    const pending = generation;
    void Promise.resolve().then(refresh);
    const invalidate = () => setState(current => {
      if (!current.setups.some(setup => setup.action === "long" && Date.parse(setup.expiresAt) <= Date.now())) return current;
      const setups = current.setups.map(setup => Date.parse(setup.expiresAt) <= Date.now() ? { ...setup, action: "wait" as const, positionSizeUsd: 0, portfolioRiskUsd: 0, reasons: [...setup.reasons, "Karar süresi doldu; güncel veriyle yeniden hesapla."] } : setup);
      return { ...current, setups, plan: buildContributionPlan(current.profile, new Date().getMonth() + 1, { hasEligibleSetup: setups.some(setup => setup.action === "long") }) };
    });
    const timer = setInterval(invalidate, 30000);
    window.addEventListener("focus", invalidate);
    return () => { pending.current++; clearInterval(timer); window.removeEventListener("focus", invalidate); };
  }, [refresh]);
  return { ...state, refresh };
}
