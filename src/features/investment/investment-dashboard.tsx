"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, PageHeader } from "@/components/ui";
import { istanbulDate, nextContributionDate } from "@/lib/domain/monthly-investment";
import { formatMoney, formatUnsignedPercent } from "@/lib/format";
import { downloadInvestmentFile, investmentRepository, type InvestmentDecision } from "@/lib/storage/investment-repository";
import { settingsRepository } from "@/lib/storage/settings-repository";
import { PolicyEditor } from "./policy-editor";
import { ProjectionPanel } from "./projection-panel";
import { useInvestment } from "./use-investment";
import { EarnReservePanel } from "./earn-reserve-panel";
import { describeDcaBasket } from "@/lib/domain/dca-policy";

const dateLabel = (date: string) => new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" }).format(new Date(`${date.slice(0, 10)}T12:00:00+03:00`));
const statusLabel = { ready: "Plan hesaplandı", draft: "Profil eksik · taslak", blocked: "Yeni alım bekliyor" };

export function InvestmentDashboard() {
  const state = useInvestment();
  const { policy, plan, now, snapshot, loading } = state;
  const [showProfile, setShowProfile] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedDecision, setSelectedDecision] = useState<InvestmentDecision | null>(null);
  const nextDate = now ? nextContributionDate(policy.startDate, policy.contributionDay, now) : policy.startDate;
  const today = now ? istanbulDate(now) : "";
  const beforeStart = !!today && today < policy.startDate;
  const cash = plan?.rows.find(row => row.key === "cash")?.amountUsd ?? 0;
  const totalBudget = plan?.totalDeployableUsd ?? plan?.budgetUsd ?? 0;
  const invested = plan ? totalBudget - cash - plan.costUsd : 0;
  const saveDisabled = !plan || loading || !state.initialized || !state.localReady || !!state.error || saving;

  async function saveDecision() {
    if (!plan || saveDisabled) return;
    setSaving(true); setMessage("");
    try {
      const result = await investmentRepository.saveDecision(nextDate.slice(0, 7), policy, plan);
      state.setDecisions(current => [result, ...current]);
      setMessage("Karar anı kaydedildi. Alım veya para yatırma kaydı oluşturulmadı.");
    } catch { setMessage("Karar kaydedilemedi. Tarayıcının yerel depolama iznini kontrol et."); }
    finally { setSaving(false); }
  }

  async function saveBudget() {
    if (!plan) return;
    try { const settings = await settingsRepository.get(); await settingsRepository.save({ ...settings, monthlyBudgetUsd: Number(state.budget) }); setMessage("Aylık katkı tutarı kaydedildi."); }
    catch { setMessage("Katkı tutarı kaydedilemedi."); }
  }

  return <div className="investment-dashboard">
    <PageHeader eyebrow="DÜZENLİ BİRİKİM" title="Bu ayki yatırımın" description="Her ay aynı gün, sepetine düzenli alım." actions={<button className="button secondary" onClick={()=>setShowProfile(v=>!v)}>Sepet ve takvim</button>}/>
    {showProfile&&<PolicyEditor policy={policy} onSaved={p=>{state.setPolicy(p);setShowProfile(false);}}/>}
    {state.error&&<p className="notice danger" role="alert">{state.error}</p>}
    {message&&<p role="status">{message}</p>}
    <div className="investment-main-grid section-gap">
      <Card><div className="card-title"><div><h2>{dateLabel(nextDate)}</h2><p>{beforeStart?"İlk düzenli alımın. Bugün hazırlık planı.":"Aylık alım günü"}</p></div></div>
      <div className="field"><label htmlFor="contribution-budget">Bu ay ayıracağım tutar (USD)</label><input className="input" id="contribution-budget" type="number" min="0.01" max="100000000" step="0.01" value={state.budget} onChange={e=>state.setBudget(e.target.value)}/></div>
      <p className="small-copy">Her ayın {policy.contributionDay}’inde · yıllık ek {formatMoney(policy.annualContributionUsd,"USD")} ({policy.annualContributionMonth}. ay, tahmini)</p>
      <details className="method-details"><summary>Mevcut nakdi kullanıyorum</summary><label className="check-field"><input type="checkbox" checked={state.reserveOnly} onChange={e=>state.setReserveOnly(e.target.checked)}/><span>Bu katkı zaten nakit / rezerv kaydında; tekrar ekleme.</span></label><p className="small-copy">Kayıtlı kullanılabilir nakit de alım bütçesine dahildir. Gelecekteki katkı bugün mevcut sermaye sayılmaz.</p></details>
      <button className="button secondary section-gap" disabled={!state.localReady} onClick={()=>void saveBudget()}>Aylık tutarı kaydet</button></Card>
      <Card><div className="card-title"><div><h2>Hedef sepetin</h2><p>{describeDcaBasket(policy.dcaWeights)}</p></div><Link className="text-link" href="/backtest">DCA’ları karşılaştır →</Link></div>
      <p>{policy.dcaAllocation === "rebalance" ? "Bunlar hedef portföy payları. Bu ayın alım yüzdeleri, mevcut portföyde hangi varlığın hedefin gerisinde kaldığına göre değişir." : "Her katkı bu oranlarla alınır."} Düzenli USDT payı ayrılmaz.</p>
      <div className="overview-line"><span>Alımlara ayrılan</span><strong>{formatMoney(invested,"USD")}</strong></div><div className="overview-line"><span>Alış maliyeti</span><strong>{formatMoney(plan?.costUsd??0,"USD")}</strong></div>{cash>.1&&<div className="overview-line"><span>Bekleyen / kalan</span><strong>{formatMoney(cash,"USD")}</strong></div>}
      <p className="small-copy muted">BTC brüt sınırı %40’a ulaşırsa aşan yeni pay diğer varlıklara yönelir. Portföy kaydı yoksa ilk alımda hedef oranlar kullanılır. Bunlar doğrulanmış optimum değil; Backtest’te sepet taraması var.</p></Card>
    </div>
    {!!plan?.warnings.length&&<div className="plan-notice section-gap"><div>{plan.warnings.map(w=><p key={w}>{w}</p>)}{plan.status==="draft"&&<button className="text-link" onClick={()=>setShowProfile(true)}>Profili tamamla</button>}</div></div>}
    <Card className="section-gap"><div className="card-title"><div><h2>Bu ay ne kadar alacağım?</h2><p>{plan?statusLabel[plan.status]:"Plan hazırlanıyor"}</p></div><button className="button secondary small" disabled={loading} onClick={()=>void state.refresh()}>{loading?"Fiyatlar yükleniyor…":"Fiyatları yenile"}</button></div>
    <div className="investment-rows">{plan?.rows.filter(r=>r.key!=="cash"||r.amountUsd>.1).map(row=><div className="investment-row" key={row.key}><div className="investment-row-main"><span className="asset-color" style={{background:row.color}}/><div><strong>{row.symbol??row.label}</strong><small>{row.label}</small></div><div className="investment-amount"><strong>{formatMoney(row.amountUsd,"USD")}</strong><span>{formatUnsignedPercent(row.contributionWeight,1)}</span></div></div><details className="allocation-reason"><summary>Alım detayı</summary><p>{row.reason}</p>{row.asOf&&<p>{row.source} · {new Date(row.asOf).toLocaleString("tr-TR")}</p>}</details></div>)}</div>
    <div className="allocation-total"><span>Toplam bütçe (maliyet dahil)</span><strong>{formatMoney(totalBudget,"USD")}</strong></div><div className="allocation-actions"><Link href="/portfoyum" className="button primary">Alımımı kaydet →</Link><button className="button secondary" disabled={saveDisabled} onClick={()=>void saveDecision()}>{saving?"Kaydediliyor…":"Planı sakla"}</button></div><p className="small-copy muted">Tutar planıdır; otomatik emir göndermez. Gerçek adet, fiyat ve komisyonu alımdan sonra kaydet.</p></Card>
    <details className="method-details section-gap"><summary>3–10 yıllık hedef hesabı</summary>{plan&&<ProjectionPanel monthlyUsd={Number(state.budget)} initialUsd={state.valuation.complete?plan.portfolioUsd:0} usdTry={state.usdTry} policy={policy}/>}</details>
    <details className="method-details section-gap"><summary>Nakit / USDT kayıtları</summary><EarnReservePanel state={state.earn} onSaved={value=>{state.setEarn(value);state.setReserveOnly(true);}}/></details>
    <details className="method-details section-gap"><summary>Kaydedilen planlar ({state.decisions.length})</summary>{state.decisions.map(d=><button className="decision-item" key={d.id} onClick={()=>setSelectedDecision(d)}>{d.month} · {formatMoney(d.plan.totalDeployableUsd??d.plan.budgetUsd,"USD")}</button>)}{selectedDecision&&<button className="button secondary" onClick={()=>downloadInvestmentFile(`yatirim-karari-${selectedDecision.id}.json`,selectedDecision)}>Seçilen planı indir</button>}<button className="button secondary" disabled={!state.decisions.length} onClick={()=>downloadInvestmentFile("birikim-karar-arsivi.json",{version:1,decisions:state.decisions})}>Arşivi indir</button></details>
    <details className="method-details section-gap"><summary>Veri ve yöntem</summary><p>Dağılım için teknik sinyal veya uzun fiyat geçmişi aranmaz. Güncel fiyat yoksa tutar planı gösterilir; alımdan önce fiyat doğrulanmalıdır. Mevcut portföy değerlenemiyorsa veya profilde alımı engelleyen durum varsa para bekler.</p><p>Nasdaq ve altın karşılaştırmaları QQQ ve IAU üzerinden yapılır. Temettü ve vergi dahil değildir. %10 reel yıllık getiri yalnız hedef senaryosudur.</p>{snapshot.errors.map(e=><p key={e}>{e}</p>)}<Link href="/arastirma">Yöntem ve kaynaklar →</Link></details>
  </div>;
}
