"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MarketSnapshot } from "../domain/types";

type QuoteResponse = Record<string, { ok: true; data: MarketSnapshot } | { ok: false; error: string }>;

export function useMarketQuotes(symbols: string[]) {
  const key = symbols.join(",");
  const requestedSymbols = useMemo(() => key.split(",").filter(Boolean), [key]);
  const [quotes, setQuotes] = useState<Record<string, MarketSnapshot>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/market/quotes?symbols=${encodeURIComponent(key)}`);
      const data = await response.json() as QuoteResponse;
      const nextQuotes: Record<string, MarketSnapshot> = {};
      const nextErrors: Record<string, string> = {};
      Object.entries(data).forEach(([symbol, result]) => {
        if (result.ok) nextQuotes[symbol] = result.data;
        else nextErrors[symbol] = result.error;
      });
      setQuotes(nextQuotes);
      setErrors(nextErrors);
    } catch (error) {
      setErrors(Object.fromEntries(requestedSymbols.map((symbol) => [symbol, error instanceof Error ? error.message : "Bağlantı hatası"])));
    } finally { setLoading(false); }
  }, [key, requestedSymbols]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { quotes, errors, loading, refresh };
}
