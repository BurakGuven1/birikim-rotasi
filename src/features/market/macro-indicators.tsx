"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Landmark, TrendingUp } from "lucide-react";
import { Card, StatusBadge } from "@/components/ui";
import type { FredMacroIndicator } from "@/lib/data/fred";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/format";

const icons = { M2SL: Landmark, CPIAUCSL: TrendingUp, DFII10: Activity } as const;

export function MacroIndicators() {
  const [indicators, setIndicators] = useState<FredMacroIndicator[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/market/macro");
      const payload = await response.json() as FredMacroIndicator[] | { error?: string };
      if (!response.ok || !Array.isArray(payload)) throw new Error(!Array.isArray(payload) ? payload.error : "Makro veri alınamadı.");
      setIndicators(payload);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Makro veri alınamadı.");
    }
  }, []);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  return <section className="section-gap" aria-labelledby="macro-title">
    <div className="card-title">
      <div><h2 id="macro-title">FRED makro göstergeleri</h2><p>Para arzı, enflasyon seviyesi ve piyasa bazlı reel faiz</p></div>
    </div>
    {error ? <Card><p className="muted">{error}</p></Card> : indicators.length === 0 ? <div className="grid grid-3" aria-label="Makro göstergeler yükleniyor">
      {[0, 1, 2].map((item) => <Card className="metric-card" key={item}><p className="muted">FRED verisi alınıyor…</p></Card>)}
    </div> : <div className="grid grid-3">
      {indicators.map((indicator) => {
        const Icon = icons[indicator.id];
        const change = indicator.id === "DFII10" ? `${formatNumber(indicator.change, 2)} puan / 1 yıl` : `${formatPercent(indicator.change)} / 1 yıl`;
        return <Card className="metric-card" key={indicator.id}>
          <div className="card-title"><div><span className="pill"><Icon size={14} />{indicator.id}</span><h3>{indicator.label}</h3></div><StatusBadge status={indicator.status} /></div>
          <p className="metric-value">{formatNumber(indicator.value, 2)} <small>{indicator.unit}</small></p>
          <p className={indicator.change >= 0 ? "positive" : "negative"}>{change}</p>
          <div className="source-line"><span>{indicator.source}</span><span>{formatDateTime(indicator.asOf)}</span></div>
        </Card>;
      })}
    </div>}
    <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.</p>
  </section>;
}
