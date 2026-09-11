"use client";

import { DCA_LABELS } from "@/lib/domain/dca-policy";
import type { AssetClass } from "@/lib/domain/types";
import { useState } from "react";
import { Save, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui";
import { investmentProfileIssues, type InvestmentPolicy } from "@/lib/domain/investment-policy";
import { investmentRepository } from "@/lib/storage/investment-repository";

export function PolicyEditor({ policy, onSaved }: { policy: InvestmentPolicy; onSaved: (policy: InvestmentPolicy) => void }) {
  const [draft, setDraft] = useState(policy);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const update = <K extends keyof InvestmentPolicy>(key: K, value: InvestmentPolicy[K]) => { setDraft(current => ({ ...current, [key]: value })); setMessage(""); };
  const issues = investmentProfileIssues(draft);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage("");
    try { const result = await investmentRepository.savePolicy(draft); onSaved(result); setMessage("Profil kaydedildi. Aylık dağılım bu bilgilerle hesaplanır."); }
    catch { setMessage("Profil kaydedilemedi. Girdi aralıklarını ve tarayıcı depolama iznini kontrol et."); }
    finally { setSaving(false); }
  }
  return <Card className="policy-card"><div className="card-title"><div><h2>Yatırım profilin</h2><p>Ev hedefi · dolar alım gücü · 5–10 yıllık birikim</p></div><ShieldCheck size={21} /></div>
    <form onSubmit={event => void save(event)}>
      <div className="settings-grid">
        <div className="field"><label htmlFor="investment-start">İlk katkı tarihi</label><input className="input" id="investment-start" type="date" required value={draft.startDate} onChange={e => update("startDate", e.target.value)} /></div>
        <div className="field"><label htmlFor="investment-day">Sonraki aylarda katkı günü</label><input className="input" id="investment-day" type="number" min="1" max="28" required value={draft.contributionDay} onChange={e => update("contributionDay", Number(e.target.value))} /></div>
        <div className="field"><label htmlFor="investment-horizon">Ev alımına kalan yıl</label><input className="input" id="investment-horizon" type="number" min="1" max="40" value={draft.horizonYears ?? ""} placeholder="5–10" onChange={e => update("horizonYears", e.target.value === "" ? null : Number(e.target.value))} /></div>
        <div className="field"><label htmlFor="investment-drawdown">Geçici düşüş toleransı</label><select className="select" id="investment-drawdown" value={draft.maxDrawdown ?? ""} onChange={e => update("maxDrawdown", e.target.value ? Number(e.target.value) : null)}><option value="">Seçim gerekli</option><option value="0.1">%10 · çok sınırlı</option><option value="0.2">%20 · temkinli</option><option value="0.3">%30 · dengeli risk</option><option value="0.4">%40 · yüksek risk</option></select></div>
        <div className="field"><label htmlFor="investment-style">Dağılım yöntemi</label><select className="select" id="investment-style" value={draft.allocationMode} onChange={e => update("allocationMode", e.target.value as InvestmentPolicy["allocationMode"])}><option value="dca">Düzenli alım (DCA)</option></select></div>
        <div className="field"><label htmlFor="annual-extra">Yıllık ek katkı (USD)</label><input className="input" id="annual-extra" type="number" min="0" max="100000000" value={draft.annualContributionUsd} onChange={e=>update("annualContributionUsd",Number(e.target.value))}/></div>
        <div className="field"><label htmlFor="annual-extra-month">Ek katkı tahmini ayı</label><input className="input" id="annual-extra-month" type="number" min="1" max="12" value={draft.annualContributionMonth} onChange={e=>update("annualContributionMonth",Number(e.target.value))}/></div>
        <div className="field"><label htmlFor="annual-first-year">İlk ek katkı yılı</label><input className="input" id="annual-first-year" type="number" min="2026" max="2100" value={draft.firstAnnualYear} onChange={e=>update("firstAnnualYear",Number(e.target.value))}/></div>
        <div className="field"><label htmlFor="investment-emergency">Ayrı acil durum birikimi</label><select className="select" id="investment-emergency" value={draft.hasEmergencyFund === null ? "" : String(draft.hasEmergencyFund)} onChange={e => update("hasEmergencyFund", e.target.value === "" ? null : e.target.value === "true")}><option value="">Seçim gerekli</option><option value="true">Var · yatırım dışında</option><option value="false">Henüz yok</option></select></div>
        <div className="field"><label htmlFor="investment-debt">Yüksek faizli borç</label><select className="select" id="investment-debt" value={draft.highInterestDebt === null ? "" : String(draft.highInterestDebt)} onChange={e => update("highInterestDebt", e.target.value === "" ? null : e.target.value === "true")}><option value="">Seçim gerekli</option><option value="false">Yok</option><option value="true">Var</option></select></div>
        <div className="field"><label htmlFor="investment-cash">Mevcut yatırım nakdi (USD)</label><input className="input" id="investment-cash" type="number" min="0" max="1000000000" step="0.01" required value={draft.cashReserveUsd} onChange={e => update("cashReserveUsd", Number(e.target.value))} /></div>
        <div className="field"><label htmlFor="investment-fee">Alış maliyeti / makas (baz puan)</label><input className="input" id="investment-fee" type="number" min="0" max="500" required value={draft.feeBps} onChange={e => update("feeBps", Number(e.target.value))} /><small className="muted">30 baz puan = %0,30 · kurumuna göre değiştir</small></div>
        <div className="field"><label htmlFor="investment-minimum">En küçük alış tutarı (USD)</label><input className="input" id="investment-minimum" type="number" min="1" max="1000" required value={draft.minOrderUsd} onChange={e => update("minOrderUsd", Number(e.target.value))} /></div>
      </div>
      <label className="field section-gap">Yeni katkı yöntemi<select className="select" value={draft.dcaAllocation} onChange={e=>update("dcaAllocation",e.target.value as InvestmentPolicy["dcaAllocation"])}><option value="rebalance">Portföye göre değişen alım</option><option value="fixed">Her katkıda sabit yüzdeler</option></select></label><h3 className="section-gap">Hedef sepet</h3>
      <div className="settings-grid">{(Object.keys(DCA_LABELS) as AssetClass[]).map(key=><label className="field" key={key}>{DCA_LABELS[key]} (%)<input className="input" type="number" min="0" max={key==="bitcoin"?40:100} step="1" value={+(draft.dcaWeights[key]*100).toFixed(2)} onChange={e=>update("dcaWeights",{...draft.dcaWeights,[key]:Number(e.target.value)/100})}/></label>)}</div>
      <p className="small-copy">Toplam %{+(Object.values(draft.dcaWeights).reduce((a,b)=>a+b,0)*100).toFixed(2)} / %100. Değişken yöntemde katkı, hedefin gerisindeki varlıklara yönelir; mevcut varlıklar satılmaz. Ayrı USD nakdine Earn bakiyesini tekrar ekleme.</p>
      {issues.missing.length > 0 && <p className="muted small-copy">{issues.missing.join(" ")}</p>}
      {issues.blockers.length > 0 && <div className="notice danger section-gap"><p>{issues.blockers.join(" ")}</p></div>}
      <div className="policy-save"><button type="submit" className="button primary" disabled={saving}><Save size={16} />{saving ? "Kaydediliyor…" : "Profili kaydet"}</button><p role="status">{message}</p></div>
    </form>
  </Card>;
}
