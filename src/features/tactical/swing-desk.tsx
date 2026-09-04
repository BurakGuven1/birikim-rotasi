"use client";

import { useCallback, useEffect, useState } from "react";
import { BookOpenCheck, Crosshair, ShieldAlert, Trash2 } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import type { StrategyProfile } from "@/lib/domain/strategy";
import type { TacticalSetup } from "@/lib/domain/tactical";
import type { TacticalTrade } from "@/lib/domain/types";
import { formatMoney, formatUnsignedPercent } from "@/lib/format";
import { closeTacticalTrade, createPlannedTrade, openTacticalTrade, tacticalTradeRepository } from "@/lib/storage/tactical-trade-repository";
import { useStrategyRoute } from "@/features/strategy/use-strategy-route";
import { SetupCard } from "./setup-card";

interface SwingDeskViewProps {
  profile: StrategyProfile;
  setups: TacticalSetup[];
  trades: TacticalTrade[];
  loading: boolean;
  errors: string[];
  onPlan: (setup: TacticalSetup) => void;
  onOpen: (trade: TacticalTrade, price: number) => void;
  onClose: (trade: TacticalTrade, price: number) => void;
  onRemove: (trade: TacticalTrade) => void;
}

const statusLabel = { planned: "Planlandı", open: "Açık", closed: "Kapandı" } as const;

function JournalAction({ trade, onOpen, onClose, onRemove }: Pick<SwingDeskViewProps, "onOpen" | "onClose" | "onRemove"> & { trade: TacticalTrade }) {
  if (trade.status === "planned") return <form className="journal-action" onSubmit={(event) => { event.preventDefault(); const price = Number(new FormData(event.currentTarget).get("entry")); onOpen(trade, price); }}><label>Gerçek giriş<input className="input" name="entry" type="number" min="0.0001" step="any" defaultValue={trade.plannedEntry} /></label><button className="button secondary" type="submit">İşlemi aç</button><button className="icon-button" type="button" aria-label={`${trade.symbol} planını sil`} onClick={() => onRemove(trade)}><Trash2 size={17} /></button></form>;
  if (trade.status === "open") return <form className="journal-action" onSubmit={(event) => { event.preventDefault(); const price = Number(new FormData(event.currentTarget).get("exit")); onClose(trade, price); }}><label>Gerçek çıkış<input className="input" name="exit" type="number" min="0.0001" step="any" defaultValue={trade.targets[0]} /></label><button className="button primary" type="submit">İşlemi kapat</button></form>;
  return <span className={(trade.realizedPnlUsd ?? 0) >= 0 ? "positive" : "negative"}>{formatMoney(trade.realizedPnlUsd ?? 0, "USD")}</span>;
}

export function SwingDeskView({ profile, setups, trades, loading, errors, onPlan, onOpen, onClose, onRemove }: SwingDeskViewProps) {
  return <div>
    <PageHeader eyebrow="KURALLI TAKTİK KATMAN" title="Swing masası" description="Yalnız trend, momentum, güven ve getiri/risk koşulları birlikte doğrulandığında işlem planı üretir." />
    <div className="risk-strip">
      <span><ShieldAlert size={16} />İşlem başına risk <strong>{formatUnsignedPercent(profile.perTradeRisk, 2)}</strong></span>
      <span>Taktik tavan <strong>{formatUnsignedPercent(Math.min(profile.tacticalShare, 0.25), 0)}</strong></span>
      <span>Minimum G/R <strong>{profile.minRiskReward.toFixed(1)}</strong></span>
      <span>Minimum güven <strong>{formatUnsignedPercent(profile.minConfidence, 0)}</strong></span>
    </div>
    {loading ? <Card className="section-gap"><div className="wait-state"><Crosshair size={24} /><strong>Kurulumlar hesaplanıyor</strong><p className="muted">10 yıllık fiyat geçmişi ve risk limitleri kontrol ediliyor.</p></div></Card> : <div className="setup-grid section-gap">{setups.map((setup) => <SetupCard key={setup.id} setup={setup} alreadyPlanned={trades.some((trade) => trade.setupId === setup.id && trade.status !== "closed")} onPlan={onPlan} />)}</div>}
    {errors.length ? <div className="notice danger section-gap"><p><strong>Veri notu:</strong> {errors.join(" · ")}</p></div> : null}
    <Card className="section-gap">
      <div className="card-title"><div><h2>İşlem günlüğü</h2><p>Plan anındaki sinyal dondurulur; gerçek giriş ve çıkış ayrıca kaydedilir</p></div><BookOpenCheck size={20} /></div>
      {trades.length ? <div className="journal-list">{trades.map((trade) => <div className="journal-row" key={trade.id}><div><span className="market-symbol">{trade.symbol}</span><strong>{trade.name}</strong><small>{formatMoney(trade.plannedSizeUsd, "USD")} planlanan boyut</small></div><span className={`status-badge ${trade.status === "closed" ? "fresh" : "delayed"}`}>{statusLabel[trade.status]}</span><JournalAction trade={trade} onOpen={onOpen} onClose={onClose} onRemove={onRemove} /></div>)}</div> : <div className="wait-state compact"><BookOpenCheck size={22} /><strong>Henüz işlem planı yok</strong><p className="muted">Geçerli bir kurulumu günlüğe eklediğinde burada takip edebilirsin.</p></div>}
    </Card>
    <div className="notice section-gap"><p>Kaldıraç, short ve otomatik emir kapalıdır. Geçersizleşme seviyesi zarar büyürken daha uzağa taşınmamalıdır.</p></div>
  </div>;
}

export function SwingDesk() {
  const route = useStrategyRoute();
  const [trades, setTrades] = useState<TacticalTrade[]>([]);
  const [journalError, setJournalError] = useState("");
  const reload = useCallback(async () => setTrades(await tacticalTradeRepository.list()), []);
  useEffect(() => { void Promise.resolve().then(reload); }, [reload]);
  const perform = async (operation: () => Promise<unknown>) => {
    try { setJournalError(""); await operation(); await reload(); }
    catch (error) { setJournalError(error instanceof Error ? error.message : "İşlem günlüğü güncellenemedi."); }
  };
  return <SwingDeskView
    profile={route.profile}
    setups={route.setups}
    trades={trades}
    loading={route.loading}
    errors={[...route.errors, ...(journalError ? [journalError] : [])]}
    onPlan={(setup) => void perform(() => tacticalTradeRepository.add(createPlannedTrade(setup)))}
    onOpen={(trade, price) => void perform(() => tacticalTradeRepository.update(openTacticalTrade(trade, price)))}
    onClose={(trade, price) => void perform(() => tacticalTradeRepository.update(closeTacticalTrade(trade, price)))}
    onRemove={(trade) => void perform(() => tacticalTradeRepository.remove(trade.id))}
  />;
}
