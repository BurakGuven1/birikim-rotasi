"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InvestmentSnapshot } from "@/lib/data/investment-service";
import { DEFAULT_INVESTMENT_POLICY, type InvestmentPolicy } from "@/lib/domain/investment-policy";
import { buildMonthlyInvestment, EMPTY_INVESTMENT_VALUES, valueInvestmentHoldings } from "@/lib/domain/monthly-investment";
import type { MarketSnapshot, Transaction } from "@/lib/domain/types";
import { investmentRepository, type InvestmentDecision } from "@/lib/storage/investment-repository";
import { portfolioRepository } from "@/lib/storage/portfolio-repository";
import { settingsRepository } from "@/lib/storage/settings-repository";
import { EMPTY_EARN_RESERVE, reserveSummary, type EarnReserveState } from "@/lib/domain/earn-reserve";
import { earnRepository } from "@/lib/storage/earn-repository";
import { priceActionJournal, summarizeOpenSwingExposure } from "@/lib/storage/price-action-journal";

async function readJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Piyasa servisine ulaşılamadı; yeniden dene.");
  return response.json() as Promise<T>;
}

export function useInvestment() {
  const [policy, setPolicy] = useState<InvestmentPolicy>({ ...DEFAULT_INVESTMENT_POLICY });
  const [budget, setBudget] = useState("1000");
  const [earn, setEarn] = useState<EarnReserveState>(EMPTY_EARN_RESERVE);
  const [reserveOnly, setReserveOnly] = useState(false);
  const [swingExposure,setSwingExposure] = useState({marginUsd:0,riskUsd:0,btcDerivativeExposureUsd:0});
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [quotes, setQuotes] = useState<Record<string, MarketSnapshot>>({});
  const [snapshot, setSnapshot] = useState<InvestmentSnapshot>({ market: {}, fxHistory: [], fetchedAt: "", errors: [] });
  const [decisions, setDecisions] = useState<InvestmentDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [localReady, setLocalReady] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState<Date | null>(null);
  const request = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timer = setTimeout(() => controller.abort(), 180_000);
    setLoading(true); setError("");
    try {
      const tx = await portfolioRepository.list();
      if (controller.signal.aborted) return;
      setTransactions(tx);
      setSwingExposure(summarizeOpenSwingExposure(await priceActionJournal.list(),true));
      const symbols = [...new Set(tx.map(t => t.symbol))];
      const [market, extra] = await Promise.all([
        readJson<InvestmentSnapshot>("/api/market/investment?dca=true", controller.signal),
        symbols.length ? readJson<Record<string, { ok: boolean; data?: MarketSnapshot }>>(`/api/market/quotes?symbols=${encodeURIComponent(symbols.join(","))}`, controller.signal) : Promise.resolve({} as Record<string, { ok: boolean; data?: MarketSnapshot }>),
      ]);
      if (controller.signal.aborted) return;
      if (!market.market || !Array.isArray(market.fxHistory)) throw new Error("Piyasa yanıtı geçersiz.");
      setSnapshot(market);
      setQuotes(Object.fromEntries(Object.entries(extra).flatMap(([key, result]) => result.ok && result.data ? [[key, result.data]] : [])));
      setNow(new Date());
    } catch {
      if (request.current === controller) { setError("Veriler yenilenemedi. Bağlantıyı kontrol et; eski hesapla işlem yapma."); setSnapshot({ market: {}, fxHistory: [], fetchedAt: "", errors: [] }); setQuotes({}); }
    } finally {
      clearTimeout(timer);
      if (request.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([investmentRepository.getPolicy(), settingsRepository.get(), investmentRepository.decisions(), earnRepository.get()]).then(([savedPolicy, settings, savedDecisions, savedEarn]) => {
      if (!active) return;
      setPolicy(savedPolicy); setBudget(String(settings.monthlyBudgetUsd)); setDecisions(savedDecisions); setEarn(savedEarn); setLocalReady(true);
    }).catch(() => { if (active) setError("Yerel kayıtlar okunamadı; kayıtlı portföyün boş kabul edilmedi. Tarayıcı izinlerini kontrol et."); }).finally(() => {
      if (!active) return;
      setInitialized(true); setNow(new Date());
    });
    return () => { active = false; request.current?.abort(); };
  }, []);
  useEffect(() => { if (initialized && localReady) void Promise.resolve().then(refresh); }, [initialized, localReady, refresh]);
  // Re-evaluate freshness even when the user leaves the dashboard open.
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(timer); }, []);

  const fx = snapshot.fx;
  const age = now && fx ? now.getTime() - Date.parse(fx.asOf) : Infinity;
  const usdTry = fx && Number.isFinite(fx.price) && fx.price > 0 && fx.status !== "stale" && fx.status !== "unavailable" && age >= -300000 && age < 96 * 3600000 ? fx.price : undefined;
  const reserve = useMemo(() => reserveSummary(earn, now ?? new Date()), [earn,now]);
  const valuation = useMemo(() => {
    const value = now ? valueInvestmentHoldings(transactions, quotes, usdTry, policy.cashReserveUsd + reserve.valueUsd, now) : { values: { ...EMPTY_INVESTMENT_VALUES }, complete: false, missing: [] as string[] };
    return { ...value, complete:value.complete && reserve.valuationFresh, missing:[...value.missing,...reserve.issues] };
  }, [transactions, quotes, usdTry, policy.cashReserveUsd, now,reserve]);
  const numericBudget = Number(budget);
  const validBudget = budget.trim() !== "" && Number.isFinite(numericBudget) && numericBudget >= .01 && numericBudget <= 1e8;
  const plan = useMemo(() => now && validBudget ? buildMonthlyInvestment({ budgetUsd: reserveOnly ? 0 : numericBudget, policy, market: snapshot.market, fxHistory: snapshot.fxHistory, currentValues: valuation.values, valuationComplete: valuation.complete && localReady, reserveAvailableUsd:Math.max(0,policy.cashReserveUsd + reserve.availableUsd-swingExposure.marginUsd), btcDerivativeExposureUsd:swingExposure.btcDerivativeExposureUsd, now }) : null, [now, validBudget, numericBudget, policy, snapshot, valuation, localReady,reserveOnly,reserve,swingExposure]);
  return { policy, setPolicy, budget, setBudget, earn, setEarn, reserve, reserveOnly, setReserveOnly, plan, snapshot, usdTry, valuation, loading: loading && localReady, initialized, localReady, error, now, decisions, setDecisions, refresh };
}
