"use client";
import { useEffect, useMemo, useState } from "react";
import { Card, PageHeader } from "@/components/ui";
import { CandlestickChart } from "@/features/market/candlestick-chart";
import { derivePriceActionSetup, type PriceActionSetup } from "@/lib/domain/price-action";
import type { PricePoint } from "@/lib/domain/types";
import { readInvestmentCapital } from "@/lib/storage/investment-capital";
import { downloadInvestmentFile } from "@/lib/storage/investment-repository";
import { priceActionJournal, summarizeOpenSwingExposure, type SwingJournalEntry } from "@/lib/storage/price-action-journal";
import { fetchSwingHistory, type SwingHistoryPayload } from "./price-action-backtest-panel";
import { formatMoney } from "@/lib/format";
const money=(v:number)=>formatMoney(v,"USD");
type Capital=Awaited<ReturnType<typeof readInvestmentCapital>>;
function JournalFill({trade,busy,onFill,onRemove}:{trade:SwingJournalEntry;busy:boolean;onFill:(action:string,trade:SwingJournalEntry,price:number)=>void;onRemove:(id:string)=>void}) {
  const [price,setPrice]=useState(String(trade.status==="planned"?trade.entry:trade.status==="open"?trade.tp1:trade.tp2));
  if(trade.status==="closed")return <span>{money(trade.realizedPnlUsd)}</span>;
  return <div><input aria-label={`${trade.symbol} gerçekleşen simülasyon fiyatı`} className="input" type="number" min="0.000001" step="any" value={price} onChange={e=>setPrice(e.target.value)}/><div className="allocation-actions">
    {trade.status==="planned"?<><button className="button secondary small" disabled={busy} onClick={()=>onFill("open",trade,Number(price))}>Bu fiyatla aç</button><button className="button secondary small" disabled={busy} onClick={()=>onRemove(trade.id)}>Planı kaldır</button></>:<>{trade.status==="open"&&<button className="button secondary small" disabled={busy} onClick={()=>onFill("tp1",trade,Number(price))}>%50 kapat</button>}<button className="button secondary small" disabled={busy} onClick={()=>onFill("close",trade,Number(price))}>Tamamen kapat</button></>}
  </div></div>;
}
export function PriceActionDesk() {
  const [symbol,setSymbol]=useState("BTC"),[leverage,setLeverage]=useState<1|2>(2),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [capital,setCapital]=useState<Capital|null>(null),[journal,setJournal]=useState<SwingJournalEntry[]>([]),[setup,setSetup]=useState<PriceActionSetup|null>(null);
  const [bars,setBars]=useState<PricePoint[]>([]),[context,setContext]=useState<SwingHistoryPayload["context"]>(null),[dataNote,setDataNote]=useState("");
  const exposure=useMemo(()=>summarizeOpenSwingExposure(journal,true),[journal]);
  useEffect(()=>{let active=true;void Promise.all([readInvestmentCapital(),priceActionJournal.list()]).then(([c,j])=>{if(active){setCapital(c);setJournal(j);}}).catch(e=>{if(active)setError(e instanceof Error?e.message:"Yerel sermaye okunamadı.");});return()=>{active=false;};},[]);
  async function refresh() {
    setBusy(true);setError("");setSetup(null);
    try {
      const ticker=symbol.trim().toUpperCase(),[account,rows]=await Promise.all([readInvestmentCapital(),priceActionJournal.list()]);
      setCapital(account);setJournal(rows);
      const risk=summarizeOpenSwingExposure(rows,true);
      const [daily,four]=await Promise.all([fetchSwingHistory(ticker,"3y","1d"),fetchSwingHistory(ticker,"1y","4h",true)]);
      setBars(four.points);setContext(four.context);
      setDataNote(`${four.source} · ${four.coverage.actualFrom?.slice(0,10)} · ${four.coverage.actualTo?.slice(0,10)}. ${(four.warnings??[]).join(" ")}`);
      const value=derivePriceActionSetup({symbol:ticker,daily:daily.points,fourHour:four.points,now:new Date().toISOString(),equityUsd:account.equityUsd,availableUsd:Math.max(0,account.availableUsd-risk.marginUsd),openMarginUsd:risk.marginUsd,openRiskUsd:risk.riskUsd,btcExposureUsd:account.btcExposureUsd+risk.btcDerivativeExposureUsd,leverage,source:`${daily.source} / ${four.source}`});
      setSetup(value);
    }catch(e){setError(e instanceof Error?e.message:"Analiz tamamlanamadı.");}finally{setBusy(false);}
  }
  async function act(operation:()=>Promise<unknown>) {
    setBusy(true);setError("");
    try {await operation();setJournal(await priceActionJournal.list());setCapital(await readInvestmentCapital());setSetup(null);}
    catch(e){setError(e instanceof Error?e.message:"Günlük güncellenemedi.");}finally{setBusy(false);}
  }
  async function plan() {
    if(!setup)return;
    await act(async()=>{const c=await readInvestmentCapital();if(c.issues.length)throw new Error(c.issues.join(" "));return priceActionJournal.plan(setup,{...c,symbol:setup.symbol,leverage});});
  }
  async function fill(action:string,t:SwingJournalEntry,price:number) {
    await act(async()=>{
      if(action==="open"){const c=await readInvestmentCapital();if(c.issues.length)throw new Error(c.issues.join(" "));return priceActionJournal.open(t.id,price,{...c,symbol:t.symbol,leverage:t.leverage});}
      return action==="tp1"?priceActionJournal.takeTp1(t.id,price):priceActionJournal.close(t.id,price);
    });
  }
  const levels=setup?[...setup.levels.slice(-10).map(l=>({price:l.price,title:l.label})),...[{price:setup.entry,title:"Giriş"},{price:setup.stop,title:"Stop"},{price:setup.tp1,title:"TP1 ≤ %50"},{price:setup.tp2,title:"Tam hedef"}].flatMap(l=>l.price?[{price:l.price,title:l.title}]:[])]:[];
  return <div><PageHeader eyebrow="FİYAT YAPISI · SÜRÜMLÜ STRATEJİ" title="Swing işlem masası" description="Günlük / haftalık bağlam, 4 saatlik teyit ve açıklanabilir giriş seviyeleri." actions={<button className="button primary" disabled={busy} onClick={()=>void refresh()}>{busy?"Hesaplanıyor?":"Veriyi yenile"}</button>}/>
    <div className="risk-strip"><span>BTC brüt ≤ %40</span><span>Toplam teminat ≤ %10</span><span>İşlem riski ≤ %0,5</span><span>Açık toplam risk ≤ %1</span></div>
    <p className="small-copy muted">Yerel sanal işlem günlüğü. Emir gönderilmez. Binance futures referansı OKX işlem fiyatıyla aynı değildir; burada kaydedilen sanal işlemler gerçek portföy kayıtlarını değiştirmez.</p>
    <div className="settings-grid section-gap"><label className="field">BTC, ETH veya ABD hisse/ETF sembolü<input className="input" disabled={busy} value={symbol} onChange={e=>{setSymbol(e.target.value.toUpperCase());setSetup(null);}}/></label><label className="field">Kaldıraç<select className="select" disabled={busy} value={leverage} onChange={e=>{setLeverage(Number(e.target.value) as 1|2);setSetup(null);}}><option value="1">1x</option><option value="2">2x · yalnız BTC/ETH</option></select></label><div><span className="metric-label">Mevcut sermaye / kullanılabilir</span><p>{money(capital?.equityUsd??0)} / {money(Math.max(0,(capital?.availableUsd??0)-exposure.marginUsd))}</p></div></div>
    {error&&<div className="notice danger section-gap" role="alert"><p>{error}</p></div>}
    {capital?.issues.length?<p className="negative">{capital.issues.join(" ")}</p>:null}
    {setup&&<><div className="investment-main-grid section-gap"><Card><div className="card-title"><div><h2>{setup.symbol} · {setup.direction??"Yön bekleniyor"}</h2><p>{setup.model??"Yapı onayı yok"}</p></div><span className={`status-badge ${setup.action==="ready"?"fresh":"delayed"}`}>{setup.action==="ready"?"Koşullu kurulum":"Bekle"}</span></div><div className="setup-levels">{[{label:"Giriş",value:setup.entry},{label:"Stop",value:setup.stop},{label:"TP1 · yarısı",value:setup.tp1},{label:"Tam hedef",value:setup.tp2}].map(l=><div key={l.label}><span>{l.label}</span><strong>{l.value?.toLocaleString("tr-TR")??"—"}</strong></div>)}</div><p>Boyut {money(setup.sizing.notionalUsd)} · teminat {money(setup.sizing.marginUsd)} · maliyet dahil planlanan stop riski {money(setup.sizing.riskUsd)}</p><ul className="reason-list">{setup.reasons.map(r=><li key={r}>{r}</li>)}</ul><p className="small-copy">İşlem olasılığı değildir. Kurulum araştırma adayıdır; doğrulanmış başarı oranı değildir.</p><button className="button primary" disabled={busy||setup.action!=="ready"} onClick={()=>void plan()}>Sanal planı günlüğe ekle</button><p className="small-copy muted">{setup.version} · giriş planı son geçerlilik {setup.expiresAt.slice(0,16)}</p></Card>
    <Card><h2>Göstergeler ve akış</h2><p>EMA20 {setup.indicators.ema20?.toFixed(2)??"—"} · EMA50 {setup.indicators.ema50?.toFixed(2)??"—"}</p><p>RSI {setup.indicators.rsi?.toFixed(1)??"—"} · MACD histogram {setup.indicators.macdHistogram?.toFixed(2)??"—"} · ATR {setup.indicators.atr?.toFixed(2)??"—"}</p><p>Haftalık {setup.indicators.weeklyBias} / günlük {setup.indicators.dailyBias}</p>{context&&<><p>Mark {money(context.markPrice)} · funding %{(context.fundingRate*100).toFixed(4)}</p><p>Spread {context.book.spread.toFixed(2)} · son işlemlerde alıcı hacim oranı %{(context.flow.buyRatio*100).toFixed(1)}</p><small>{context.asOf}</small></>}<p className="muted small-copy">Akış yalnız güncel bağlamdır; tarihsel backteste taşınmaz. {dataNote}</p></Card></div><Card className="section-gap"><CandlestickChart points={bars} levels={levels} intraday/></Card></>}
    <Card className="section-gap"><div className="card-title"><div><h2>Sanal işlem defteri</h2><p>TP1 başlangıç miktarının yarısını kapatır ve stopu ücret dahil başabaşa taşır.</p></div><button className="button secondary" onClick={()=>{try{downloadInvestmentFile("swing-journal.json",priceActionJournal.export());}catch(e){setError(String(e));}}}>JSON indir</button></div>
      <p className="small-copy">Sanal açık teminat {money(exposure.marginUsd)} · risk {money(exposure.riskUsd)}. Manuel çıkış fiyatı ve %0,10 komisyon kullanılır; gerçekleşen funding ayrıca dahil değildir. Backtest funding hesabı ayrıdır.</p>
      {journal.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>Sembol / durum</th><th>Teminat / P&amp;L</th><th>Gerçekleşen sanal fiyat</th></tr></thead><tbody>{journal.map(t=><tr key={t.id}><td>{t.symbol} {t.direction}<br/>{t.status}</td><td>{money(t.sizeUsd*t.remainingFraction)}<br/>{money(t.realizedPnlUsd)}</td><td><JournalFill key={`${t.id}-${t.status}`} trade={t} busy={busy} onFill={(a,t,p)=>void fill(a,t,p)} onRemove={id=>void act(()=>priceActionJournal.removePlan(id))}/></td></tr>)}</tbody></table></div>:<p>Henüz kayıt yok. Açık risk kontrolü her planlama ve açılışta yeniden yapılır.</p>}
    </Card>
  </div>;
}
