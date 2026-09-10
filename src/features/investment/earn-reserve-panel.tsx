"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import { earnReserveSchema, estimatedDailyReward, reserveSummary, type EarnReserveState } from "@/lib/domain/earn-reserve";
import { earnRepository } from "@/lib/storage/earn-repository";
import { downloadInvestmentFile } from "@/lib/storage/investment-repository";
import { formatMoney, formatUnsignedPercent } from "@/lib/format";
import { istanbulDate } from "@/lib/domain/monthly-investment";

export function EarnReservePanel({ state, onSaved }: { state: EarnReserveState; onSaved: (state: EarnReserveState) => void }) {
  const [draft,setDraft] = useState(state);
  const [message,setMessage] = useState("");
  const [saving,setSaving] = useState(false);
  const today = istanbulDate(new Date());
  const summary = reserveSummary(state);
  async function save(next:EarnReserveState) {
    setSaving(true);setMessage("");
    try { const result=await earnRepository.save(next); setDraft(result);onSaved(result);setMessage("Rezerv kaydedildi. OKX'te işlem yapılmadı."); }
    catch(error) { setMessage(error instanceof Error ? error.message : "Rezerv kaydedilemedi."); }
    finally { setSaving(false); }
  }
  return <Card><div className="card-title"><div><h2>OKX Simple Earn · USDT rezervi</h2><p>Fırsat beklerken gerçekleşen ödül ve kullanılabilir bakiye</p></div><span className="status-badge delayed">Manuel kayıt</span></div>
    <div className="transparency-grid"><div><span className="metric-label">Toplam rezerv</span><p className="metric-value">{summary.balanceUsdt.toLocaleString("tr-TR",{maximumFractionDigits:2})} USDT</p><small>{formatMoney(summary.valueUsd,"USD")} · değerleme {state.rateAsOf || "girilmedi"}</small></div><div><span className="metric-label">Kullanılabilir</span><p className="metric-value">{formatMoney(summary.availableUsd,"USD")}</p><small>Kullanılamayan tutar ve dönüşüm maliyeti çıkarıldı</small></div><div><span className="metric-label">Gerçekleşen ödül</span><p className="metric-value">{summary.rewardsUsdt.toLocaleString("tr-TR",{maximumFractionDigits:4})} USDT</p><small>{summary.observedApr === null ? "APR için tarihli bakiye geçmişi gerekli" : `${formatUnsignedPercent(summary.observedApr,2)} basit yıllık gerçekleşme`}</small></div></div>
    <p className="small-copy muted">1.000 USDT için günlük 0,28 USDT örneğin yaklaşık %10,22 basit yıllık getiriye karşılık gelir. Bu oran bakiye kademelerine ve tarihe göre değişir; on yıllık sabit getiri değildir. USDT banka doları değildir; ürün anapara korumalı değildir. Hesaplar vergi öncesidir.</p>
    <form className="settings-grid section-gap" onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);const entry={id:crypto.randomUUID(),date:String(form.get("date")),kind:String(form.get("kind")) as "deposit"|"withdraw"|"reward",amountUsdt:Number(form.get("amount")),note:String(form.get("note")??"")};void save({...draft,entries:[...state.entries,entry]});}}>
      <label className="field">Kayıt türü<select className="select" name="kind"><option value="deposit">Gerçekleşen katkı / rezerv girişi</option><option value="reward">Gerçekleşen Earn ödülü</option><option value="withdraw">Alım / rezervden çıkış</option></select></label>
      <label className="field">Gerçek tarih<input className="input" name="date" type="date" required max={today} defaultValue={today}/></label>
      <label className="field">Tutar (USDT)<input className="input" name="amount" type="number" required min="0.000001" step="any"/></label>
      <label className="field">Açıklama<input className="input" name="note" maxLength={200} placeholder="Aylık katkı / nisan ek ödeme"/></label>
      <button className="button primary" disabled={saving}>Gerçek kaydı ekle</button>
    </form>
    <details className="method-details"><summary>Değerleme, kullanılabilirlik ve APR kademeleri</summary><form onSubmit={e=>{e.preventDefault();void save({...draft,entries:state.entries});}}><div className="settings-grid section-gap">
      <label className="field">Kullanılamayan / çözülmeyi bekleyen USDT<input className="input" type="number" min="0" step="any" value={draft.unavailableUsdt} onChange={e=>setDraft({...draft,unavailableUsdt:Number(e.target.value)})}/></label>
      <label className="field">1 USDT = USD<input className="input" type="number" min="0.000001" step="any" value={draft.usdPerUsdt} onChange={e=>setDraft({...draft,usdPerUsdt:Number(e.target.value)})}/></label>
      <label className="field">Kur kontrol tarihi<input className="input" type="date" required max={today} value={draft.rateAsOf} onChange={e=>setDraft({...draft,rateAsOf:e.target.value})}/></label>
      <label className="field">Dönüşüm maliyeti (baz puan)<input className="input" type="number" min="0" max="1000" value={draft.conversionFeeBps} onChange={e=>setDraft({...draft,conversionFeeBps:Number(e.target.value)})}/></label>
      <label className="field">APR gözlem tarihi<input className="input" type="date" max={today} value={draft.aprAsOf} onChange={e=>setDraft({...draft,aprAsOf:e.target.value})}/></label>
    </div><p className="small-copy">Kademelerin üst limitini artan gir. Son kademede boş limit kalan bakiyeyi kapsar. Yüzde, platform ücretleri sonrası ödül oranıdır; bilinmeyen kademeye getiri eklenmez.</p>
    {draft.aprTiers.map((tier,i)=><div className="settings-grid" key={i}><label className="field">{i+1}. kademe üst limit USDT<input className="input" type="number" min="1" value={tier.upToUsdt??""} onChange={e=>setDraft({...draft,aprTiers:draft.aprTiers.map((t,j)=>j===i?{...t,upToUsdt:e.target.value===""?null:Number(e.target.value)}:t)})}/></label><label className="field">Net ödül APR (%)<input className="input" type="number" min="0" max="100" step=".01" value={tier.apr*100} onChange={e=>setDraft({...draft,aprTiers:draft.aprTiers.map((t,j)=>j===i?{...t,apr:Number(e.target.value)/100}:t)})}/></label><button className="button secondary" type="button" onClick={()=>setDraft({...draft,aprTiers:draft.aprTiers.filter((_,j)=>j!==i)})}>Kademeyi kaldır</button></div>)}
    <div className="allocation-actions"><button className="button secondary" type="button" disabled={draft.aprTiers.length>=10} onClick={()=>setDraft({...draft,aprTiers:[...draft.aprTiers,{upToUsdt:null,apr:0}]})}>Kademe ekle</button><button className="button primary" disabled={saving}>Rezerv ayarlarını kaydet</button></div></form></details>
    {state.aprTiers.length>0&&state.aprAsOf&&<p className="small-copy">{state.aprAsOf} tarihli kademelerle günlük gösterge: {estimatedDailyReward(summary.balanceUsdt,state.aprTiers).toFixed(4)} USDT. Gerçek ödül yerine deftere eklenmez.</p>}
    {summary.issues.map(issue=><p className="negative small-copy" key={issue}>{issue}</p>)}
    <details className="method-details"><summary>Rezerv defteri ve yedek</summary><div className="table-wrap"><table className="data-table"><thead><tr><th>Tarih</th><th>Tür</th><th>USDT</th><th>Açıklama</th></tr></thead><tbody>{[...state.entries].reverse().map(entry=><tr key={entry.id}><td>{entry.date}</td><td>{{deposit:"Giriş",withdraw:"Çıkış",reward:"Ödül"}[entry.kind]}</td><td>{entry.amountUsdt}</td><td>{entry.note}</td></tr>)}</tbody></table></div><div className="allocation-actions"><button className="button secondary" onClick={()=>downloadInvestmentFile("okx-rezerv.json",state)}>Rezerv yedeğini indir</button><label className="button secondary">Yedeği geri yükle<input type="file" accept="application/json" hidden onChange={e=>{const file=e.target.files?.[0];if(file)void file.text().then(text=>save(earnReserveSchema.parse(JSON.parse(text)))).catch(()=>setMessage("Geçersiz rezerv yedeği."));}}/></label></div></details>
    <p className="small-copy muted">Bu defterdeki bakiyeyi profildeki ayrı USD nakdine tekrar yazma. Varlık alımından sonra ilgili rezerv çıkışını da kaydet. <a href="https://www.okx.com/en-gb/help/introduction-to-okx-simple-earn-flexible" target="_blank" rel="noreferrer">OKX ürün koşulları ↗</a></p><p role="status">{message}</p>
  </Card>;
}
