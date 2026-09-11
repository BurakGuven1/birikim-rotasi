"use client";
import { useState } from "react";
import { Card } from "@/components/ui";
import { runPriceActionBacktest, type PriceActionBacktestResult, type FundingPoint } from "@/lib/domain/price-action-backtest";
import type { PricePoint } from "@/lib/domain/types";
import { downloadInvestmentFile } from "@/lib/storage/investment-repository";
import { formatMoney, formatUnsignedPercent } from "@/lib/format";
export interface SwingHistoryPayload {
  points:PricePoint[]; source:string; coverage:{complete:boolean;coveredMonths:number;requestedMonths:number;actualFrom?:string;actualTo?:string};
  funding?:FundingPoint[]; warnings?:string[]; error?:string;
  context?:{markPrice:number;fundingRate:number;book:{spread:number};flow:{buyRatio:number};asOf:string}|null;
}
export async function fetchSwingHistory(symbol:string,range:string,interval:string,context=false,funding=false):Promise<SwingHistoryPayload> {
  const market=["BTC","ETH"].includes(symbol)?"futures":"spot";
  const query=new URLSearchParams({symbol,range,interval,market,context:String(context),funding:String(funding)});
  const response=await fetch(`/api/market/swing?${query}`,{signal:AbortSignal.timeout(180000)});
  const payload=await response.json();if(!response.ok)throw new Error(payload.error??"Veri alınamadı.");return payload;
}
export function PriceActionBacktestPanel({initialSymbol="BTC"}:{initialSymbol?:string}) {
  const [symbol,setSymbol]=useState(initialSymbol),[years,setYears]=useState("3y"),[capital,setCapital]=useState(10000),[leverage,setLeverage]=useState<1|2>(2);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[result,setResult]=useState<PriceActionBacktestResult|null>(null),[coverage,setCoverage]=useState("");
  async function run() {
    setBusy(true);setError("");setResult(null);
    try {
      const ticker=symbol.trim().toUpperCase();
      const [daily,four]=await Promise.all([fetchSwingHistory(ticker,years,"1d"),fetchSwingHistory(ticker,years,"4h",false,true)]);
      setCoverage(`${four.source} · ${four.coverage.actualFrom?.slice(0,10)??"—"} · ${four.coverage.actualTo?.slice(0,10)??"—"} · ${four.coverage.complete?"İstenen dönem tam":"İstenen dönem kısmi"}. ${(four.warnings??[]).join(" ")}`);
      await new Promise(resolve=>setTimeout(resolve,0));
      setResult(runPriceActionBacktest({symbol:ticker,daily:daily.points,fourHour:four.points,equityUsd:capital,leverage,source:`${daily.source} / ${four.source}`,fundingHistory:four.funding,commissionBps:10,spreadBps:5,slippageBps:5}));
    }catch(e){setError(e instanceof Error?e.message:"Backtest tamamlanamadı.");}finally{setBusy(false);}
  }
  return <Card className="section-gap"><div className="card-title"><div><h2>Swing kanıtı · örneklem dışı backtest</h2><p>Canlı kurulumla aynı motor; sabit başlangıç sermayesi, katkı yok. Aylık yatırım karşılaştırmasından ayrıdır.</p></div></div>
    <div className="settings-grid"><label className="field">Sembol<input className="input" value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())}/></label><label className="field">İstenen dönem<select className="select" value={years} onChange={e=>setYears(e.target.value)}><option value="3y">3 yıl</option><option value="5y">5 yıl</option><option value="10y">10 yıl</option></select></label><label className="field">Sanal başlangıç USD<input className="input" type="number" min="1" value={capital} onChange={e=>setCapital(Number(e.target.value))}/></label><label className="field">Kaldıraç<select className="select" value={leverage} onChange={e=>setLeverage(Number(e.target.value) as 1|2)}><option value="1">1x</option><option value="2">2x · yalnız BTC/ETH</option></select></label></div>
    <button className="button primary section-gap" disabled={busy} onClick={()=>void run()}>{busy?"Veri ve işlemler hesaplanıyor?":"Backtesti çalıştır"}</button>
    {error&&<p className="negative" role="alert">{error}</p>}
    {result&&<><p className="small-copy muted">{coverage}</p><div className="transparency-grid"><div><span>Kapanmış / net kazanan</span><p className="metric-value">{result.metrics.closedTrades} / {result.trades.filter(t=>t.netPnlUsd>0).length}</p></div><div><span>Net kazanma oranı</span><p className="metric-value">{formatUnsignedPercent(result.metrics.netWinRate,1)}</p></div><div><span>Net sonuç / maksimum düşüş</span><p className="metric-value">{formatMoney(result.metrics.netPnlUsd,"USD")}</p><small>%{result.metrics.maxDrawdownPercent.toFixed(2)}</small></div></div>
    <p>TP1: {formatUnsignedPercent(result.metrics.tp1Rate,1)} · Tam hedef: {formatUnsignedPercent(result.metrics.tp2Rate,1)} · Ortalama R: {result.metrics.averageR.toFixed(2)} · Kâr faktörü: {result.metrics.profitFactor?.toFixed(2)??"Kayıp örneği yok / tanımsız"}</p>
    <p className={`status-badge ${result.eligibility.eligible?"fresh":"delayed"}`}>{result.eligibility.eligible?"örneklem dışı koşulları geçti":"Araştırma adayı"}</p><p className="small-copy">{result.eligibility.reasons.join(" ")} {result.metrics.closedTrades<30?"Sınırlı örneklem. ":""}Kazanma oranı gelecekteki işlem olasılığı değildir.</p>
    <div className="table-wrap"><table className="data-table"><thead><tr><th>Bölüm</th><th>Dönem</th><th>İşlem</th><th>Net beklenti / işlem</th></tr></thead><tbody>{result.partitions.map(p=><tr key={p.name}><td>{{train:"İlk %60",validation:"Doğrulama %20",test:"örneklem dışı %20"}[p.name]}</td><td>{p.from.slice(0,10)} · {p.to.slice(0,10)}</td><td>{p.metrics.closedTrades}</td><td>{formatMoney(p.metrics.netExpectancyUsd,"USD")}</td></tr>)}</tbody></table></div>
    <p className="small-copy muted">{result.metadata.version} · {result.metadata.fundingStatus}. Komisyon 10, spread 5, kayma 5 baz puan. {result.metadata.barConvention}</p>
    {result.openPosition&&<p>Açık işlem başarı sayısına dahil değil; kapanış değerlemesi: {formatMoney(result.openPosition.unrealizedPnlUsd,"USD")}.</p>}
    <details className="method-details"><summary>İşlem kanıt defteri · son 100</summary><div className="table-wrap"><table className="data-table"><thead><tr><th>Giriş</th><th>Yön / model</th><th>Çıkış</th><th>Net USD</th><th>R</th></tr></thead><tbody>{result.trades.slice(-100).map(t=><tr key={t.id}><td>{t.entryAt.slice(0,16)}</td><td>{t.direction} / {t.model}</td><td>{t.exitReason}</td><td>{t.netPnlUsd.toFixed(2)}</td><td>{t.rMultiple.toFixed(2)}</td></tr>)}</tbody></table></div></details><button className="button secondary" onClick={()=>downloadInvestmentFile("swing-backtest.json",result)}>Tüm kanıtı JSON indir</button></>}
  </Card>;
}
