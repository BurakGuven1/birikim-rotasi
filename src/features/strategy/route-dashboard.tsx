"use client";

import Link from "next/link";
import { ArrowRight, Crosshair, RefreshCw, ShieldCheck, Sparkles, Target, Vault } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import type { ContributionPlan, StrategyProfile } from "@/lib/domain/strategy";
import type { TacticalSetup } from "@/lib/domain/tactical";
import { formatMoney, formatUnsignedPercent } from "@/lib/format";
import { LayerCard } from "./layer-card";
import { useStrategyRoute } from "./use-strategy-route";

interface RouteDashboardViewProps {
  plan: ContributionPlan;
  profile: StrategyProfile;
  setups: TacticalSetup[];
  usdTry?: number;
  portfolioValueUsd: number;
  portfolioValueEstimated: boolean;
  loading: boolean;
  errors: string[];
  onRefresh?: () => void;
}

const monthLabel = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(new Date()).toLocaleUpperCase("tr-TR");

export function RouteDashboardView({ plan, profile, setups, usdTry, portfolioValueUsd, portfolioValueEstimated, loading, errors, onRefresh }: RouteDashboardViewProps) {
  const eligible = setups.filter((setup) => setup.action === "long");
  const leadSetup = eligible[0];
  const coreParts = [
    { label: "Küresel / ABD hisseleri", share: 45 / 70, amount: plan.core * 45 / 70 },
    { label: "Bitcoin", share: 15 / 70, amount: plan.core * 15 / 70 },
    { label: "Altın / reel varlık", share: 10 / 70, amount: plan.core * 10 / 70 },
  ];
  return <div>
    <PageHeader
      eyebrow={monthLabel}
      title="Bu ayın yatırım rotası"
      description="Uzun vadeli çekirdeği koru, yalnız doğrulanan swing fırsatlarına risk bütçesi ayır ve boşta kalan tutarı fırsat rezervinde tut."
      actions={<button className="button secondary" type="button" onClick={onRefresh} disabled={loading}><RefreshCw size={17} />{loading ? "Veriler hesaplanıyor" : "Rotayı yenile"}</button>}
    />
    <Card className="route-hero">
      <div><span className="pill"><ShieldCheck size={14} />Risk bütçeli plan</span><p className="hero-amount">{formatMoney(plan.total, "USD")}</p><p className="metric-meta">{usdTry ? formatMoney(plan.total * usdTry, "TRY") : "TL karşılığı bekleniyor"} · bu ay ayrılacak toplam</p></div>
      <div className="target-band"><span>Reel USD hedefi</span><strong>%10–11</strong><small>Hedef, garanti değil · gerçekleşen sonuç Backtest ve Portföy ekranında ölçülür</small></div>
    </Card>
    <div className="route-layer-grid section-gap">
      <LayerCard icon={ShieldCheck} label="Çekirdek" share={profile.coreShare} amount={plan.core} tone="core" description="Satış yapmadan uzun vadeli büyüme ve enflasyon koruması." />
      <LayerCard icon={Crosshair} label="Taktik / swing" share={plan.tacticalShareApplied} amount={plan.tactical} tone="tactical" description={leadSetup ? `${leadSetup.name} öne çıkıyor · güven ${formatUnsignedPercent(leadSetup.confidence, 0)}` : "Koşullar tamamlanmadı; zorunlu işlem yok."} />
      <LayerCard icon={Vault} label="Fırsat rezervi" share={plan.reserve / plan.total} amount={plan.reserve} tone="reserve" description="Uygun kurulum yoksa bekleyen ve sonraki fırsatı finanse eden bölüm." />
    </div>
    <div className="route-main-grid section-gap">
      <Card>
        <div className="card-title"><div><h2>Çekirdek alış listesi</h2><p>{formatMoney(plan.core, "USD")} uzun vadeli katmana yönlendirilecek</p></div><span className="status-badge fresh"><ShieldCheck size={13} />Korunan katman</span></div>
        <div className="core-purchase-list">{coreParts.map((part) => <div className="core-purchase" key={part.label}><div><strong>{part.label}</strong><span>Çekirdek içinde {formatUnsignedPercent(part.share, 0)}</span></div><strong>{formatMoney(part.amount, "USD")}</strong></div>)}</div>
        {plan.annualImmediateCore > 0 ? <div className="notice section-gap"><p>Yıllık ek katkının {formatMoney(plan.annualImmediateCore, "USD")} tutarı çekirdeğe hemen eklendi.</p></div> : null}
      </Card>
      <Card>
        <div className="card-title"><div><h2>Swing masası</h2><p>{eligible.length ? `${eligible.length} doğrulanmış long kurulumu` : "Yeni işlem için bütün koşullar bekleniyor"}</p></div><Crosshair size={20} /></div>
        {leadSetup ? <div className="lead-setup"><div className="setup-symbol"><span>{leadSetup.symbol}</span><strong>{leadSetup.name}</strong></div><div className="setup-metrics"><span>Giriş <strong>{leadSetup.entryZone[0].toLocaleString("tr-TR")}–{leadSetup.entryZone[1].toLocaleString("tr-TR")}</strong></span><span>Geçersizleşme <strong>{leadSetup.invalidation.toLocaleString("tr-TR")}</strong></span><span>Getiri / risk <strong>{leadSetup.riskReward.toFixed(1)}</strong></span></div><Link className="button primary" href="/swing">Kurulumu incele <ArrowRight size={16} /></Link></div> : <div className="wait-state"><Sparkles size={24} /><strong>Bekle modu</strong><p className="muted">Kullanılmayan taktik bütçe rezerve aktarıldı. Sırf nakit var diye işlem açılmıyor.</p><Link className="button secondary" href="/swing">Tüm sinyalleri gör</Link></div>}
      </Card>
    </div>
    <div className="grid grid-2 section-gap">
      <Card><div className="card-title"><div><h3>Risk tabanı</h3><p>İşlem büyüklükleri bu değer üzerinden hesaplanır</p></div><Target size={19} /></div><p className="metric-value">{formatMoney(portfolioValueUsd, "USD")}</p><p className="muted">{portfolioValueEstimated ? "Portföy kaydı bulunmadığı için ilk 12 ay katkısı + yıllık ekleme ile tahmini taban." : "Portföyüm ekranındaki güncel kayıtlardan hesaplandı."} İşlem başına en fazla {formatUnsignedPercent(profile.perTradeRisk, 2)} risk.</p></Card>
      <Card><div className="card-title"><div><h3>Yıllık ek katkı</h3><p>Tek güne bağımlı kalmayan dağıtım</p></div><Vault size={19} /></div><p className="metric-value">{formatMoney(profile.annualContributionUsd, "USD")}</p><p className="muted">Yarısı seçilen ay çekirdeğe, yarısı üç aya bölünerek rezerv ve uygun fırsatlara gider.</p></Card>
    </div>
    {errors.length ? <div className="notice danger section-gap"><p><strong>Veri notu:</strong> {errors.join(" · ")}</p></div> : null}
  </div>;
}

export function RouteDashboard() {
  const state = useStrategyRoute();
  return <RouteDashboardView {...state} onRefresh={() => void state.refresh()} />;
}
