import { opportunityXirr } from "./opportunity-backtest";
import { DEFAULT_INVESTMENT_POLICY, type InvestmentPolicy } from "./investment-policy";
import { describeDcaBasket } from "./dca-policy";
import type { PricePoint } from "./types";
const DAY=86400000;
export const BIST_DCA_SYMBOLS=["THYAO.IS","HALKB.IS","KCHOL.IS","PETKM.IS","ASELS.IS"] as const;
export const DCA_SYMBOLS=["BTC","VTI","QQQ","IAU","BIST100",...BIST_DCA_SYMBOLS] as const;
export type DcaSymbol=typeof DCA_SYMBOLS[number];
export interface DcaHistory {points:PricePoint[];source:string}
export interface DcaResultRow {name:string;basket:string;complete:boolean;contributedUsd:number;endingUsd:number;gainUsd:number;cashUsd:number;costsUsd:number;xirr:number|null;realXirr:number|null;maxDrawdown:number;orders:number;curve:{date:string;value:number;contributed:number}[]}
export interface DcaResult {start:string;end:string;rows:DcaResultRow[];contributionRule:string;warnings:string[];coverage:{symbol:string;source:string;first:string|null;last:string|null;complete:boolean}[];feeBps:number}
export function runDcaBacktest(input:{histories:Partial<Record<DcaSymbol,DcaHistory>>;fxHistory?:PricePoint[];cpiHistory?:PricePoint[];years:3|5|10;monthlyUsd?:number;policy?:InvestmentPolicy;endDate?:string}):DcaResult {
 const policy=input.policy??DEFAULT_INVESTMENT_POLICY,monthly=input.monthlyUsd??1000,end=Date.parse(input.endDate??new Date().toISOString()),startDate=new Date(end);
 startDate.setUTCFullYear(startDate.getUTCFullYear()-input.years);const start=+startDate;
 if(!Number.isFinite(end)||!Number.isFinite(monthly)||monthly<=0||monthly>1e8)throw new Error("Geçersiz tarih veya aylık katkı.");
 const clean=(points:PricePoint[])=>[...new Map(points.filter(p=>Number.isFinite(p.close)&&p.close>0&&Date.parse(p.date)+DAY<=end).map(p=>[p.date,p])).values()].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
 const fx=clean(input.fxHistory??[]);
 const at=(points:PricePoint[],time:number,offset=0)=>{let lo=0,hi=points.length;while(lo<hi){const m=(lo+hi)>>>1;if(Date.parse(points[m].date)+offset<=time)lo=m+1;else hi=m;}return points[lo-1];};
 const history=Object.fromEntries(DCA_SYMBOLS.map(symbol=>[symbol,clean(input.histories[symbol]?.points??[]).flatMap(p=>{
  if(symbol!=="BIST100"&&!symbol.endsWith(".IS"))return [p];const rate=at(fx,Date.parse(p.date),DAY);if(!rate||Date.parse(p.date)-Date.parse(rate.date)>8*DAY)return [];
  return [{...p,close:p.close/rate.close,open:p.open===undefined?undefined:p.open/rate.close}];
 })])) as Record<DcaSymbol,PricePoint[]>;
 const coverage=DCA_SYMBOLS.map(symbol=>{const points=history[symbol],during=points.filter(p=>Date.parse(p.date)>=start-8*DAY);const complete=!!points.length&&Date.parse(points[0].date)<=start+(symbol==="BTC"?1:4)*DAY&&Date.parse(points.at(-1)!.date)+5*DAY>=end&&during.every((p,i)=>p.open!==undefined&&p.open>0&&(!i||Date.parse(p.date)-Date.parse(during[i-1].date)<=8*DAY))&&during.length>=(end-start)/DAY*(symbol==="BTC"?.8:.5);
  return {symbol,source:input.histories[symbol]?.source??"Veri yok",first:points[0]?.date??null,last:points.at(-1)?.date??null,complete};});
 const weights:Partial<Record<DcaSymbol,number>>={BTC:policy.dcaWeights.bitcoin,VTI:policy.dcaWeights.foreignEquity,IAU:policy.dcaWeights.commodity,BIST100:policy.dcaWeights.turkishEquity};
 const strategies:{name:string;weights:Partial<Record<DcaSymbol,number>>;basket:string}[]=[{name:"BTC DCA",weights:{BTC:1},basket:"%100 BTC"},{name:"VTI DCA",weights:{VTI:1},basket:"%100 VTI"},{name:"Nasdaq DCA",weights:{QQQ:1},basket:"%100 QQQ · Nasdaq-100"},{name:"Altın DCA",weights:{IAU:1},basket:"%100 IAU · XAU için altın fonu vekili"},{name:"Sabit sepet DCA",weights,basket:describeDcaBasket(policy.dcaWeights)},{name:"BIST 5’li DCA",weights:Object.fromEntries(BIST_DCA_SYMBOLS.map(s=>[s,.2])),basket:"%20 THYAO · %20 HALKB · %20 KCHOL · %20 PETKM · %20 ASELS"}];
 const flows=new Map<number,number>();for(let year=startDate.getUTCFullYear();year<=new Date(end).getUTCFullYear();year++)for(let month=0;month<12;month++){const t=Date.UTC(year,month,policy.contributionDay);if(t>=start&&t<=end)flows.set(t,monthly+(month===policy.annualContributionMonth-1?policy.annualContributionUsd:0));}
 const events=new Set([start,end,...flows.keys()]);for(const points of Object.values(history))for(const p of points){const t=Date.parse(p.date);if(t>=start&&t<=end)events.add(t);if(t+DAY>=start&&t+DAY<=end)events.add(t+DAY);}
 const times=[...events].sort((a,b)=>a-b),total=[...flows.values()].reduce((a,b)=>a+b,0),cpi=clean(input.cpiHistory??[]);
 const cpiAt=(time:number)=>{const p=at(cpi,time);return p&&time-Date.parse(p.date)<100*DAY?p.close:null;};
 const initialCpi=cpiAt(start),finalCpi=cpiAt(end),realCovered=!!initialCpi&&!!finalCpi&&[...flows.keys()].every(t=>cpiAt(t)!==null);
 const rows:DcaResultRow[]=strategies.map(strategy=>{
  const entries=Object.entries(strategy.weights).filter(([,w])=>w>0) as [DcaSymbol,number][];
  const cash=Object.fromEntries(entries.map(([s])=>[s,0])) as Record<DcaSymbol,number>,units={...cash};let costs=0,orders=0,previous=0,twr=1,peak=1,drawdown=0,contributed=0;
  const curve:DcaResultRow["curve"]=[];
  for(const time of times){const flow=flows.get(time)??0;contributed+=flow;
   for(const [symbol,weight] of entries){cash[symbol]+=flow*weight;const p=at(history[symbol],time);if(p&&Date.parse(p.date)===time&&p.open&&p.open>0){const amount=Math.floor(cash[symbol]/(1+policy.feeBps/10000)*100)/100,fee=Math.ceil(amount*policy.feeBps/100-1e-8)/100;if(amount>=policy.minOrderUsd&&amount+fee<=cash[symbol]+1e-8){units[symbol]+=amount/p.open;cash[symbol]-=amount+fee;costs+=fee;orders++;}}}
   const value=entries.reduce((sum,[symbol])=>{const p=at(history[symbol],time),closed=at(history[symbol],time,DAY),price=p&&Date.parse(p.date)+DAY>time?(p.open??closed?.close??0):(closed?.close??0);return sum+cash[symbol]+units[symbol]*price;},0);
   if(previous>0)twr*=Math.max(0,(value-flow)/previous);else if(flow>0)twr*=Math.max(0,value/flow);
   peak=Math.max(peak,twr);drawdown=Math.max(drawdown,1-twr/peak);previous=value;
   curve.push({date:new Date(time).toISOString(),value,contributed});
  }
  const dated=[...flows].map(([t,n])=>({date:new Date(t).toISOString(),amount:-n}));
  const realFlows=realCovered?dated.map(f=>({...f,amount:f.amount*initialCpi!/cpiAt(Date.parse(f.date))!})):[];
  return {name:strategy.name,basket:strategy.basket,complete:entries.every(([s])=>coverage.find(c=>c.symbol===s)!.complete),contributedUsd:total,endingUsd:previous,gainUsd:previous-total,cashUsd:Object.values(cash).reduce((a,b)=>a+b,0),costsUsd:costs,xirr:opportunityXirr([...dated,{date:new Date(end).toISOString(),amount:previous}]),realXirr:realCovered?opportunityXirr([...realFlows,{date:new Date(end).toISOString(),amount:previous*initialCpi!/finalCpi!}]):null,maxDrawdown:drawdown,orders,curve};
 });
 return {start:new Date(start).toISOString(),end:new Date(end).toISOString(),rows,coverage,feeBps:policy.feeBps,contributionRule:`Her ayın ${policy.contributionDay}’inde ${monthly.toLocaleString("tr-TR")} USD + her yıl ${policy.annualContributionMonth}. ayda ${policy.annualContributionUsd.toLocaleString("tr-TR")} USD. Aynı varsayımsal katkı takvimi geçmişe uygulanır.`,warnings:["Alım, katkı günü veya sonraki mevcut açılışta yapılır. Kesirli adet; satış, kaldıraç ve teknik sinyal yok. Her katkı sabit oranlarla bölünür, mevcut portföy yeniden dengelenmez.","Fiyat getirisi kullanılır; nakit temettüler ve vergi dahil değildir. Altın, doğrudan XAU spot yerine IAU ile temsil edilir. BIST 5’li sepeti hisselerden oluşur; BIST100 ayrı endeks vekilidir. TRY fiyatları o anda bilinen tarihsel USD/TRY ile dolara çevrilir. Temettüler dahil değildir; seçilen bugünkü hisseleri geçmişe taşımak seçim yanlılığı içerir.","Eksik kapsamlı sonuçlar geçicidir; tam dönemle kıyaslanmamalı. Eksik alım günlerinde ilgili pay kendi nakit bakiyesinde bekler.","Azami düşüş günlük fiyat noktalarında, katkı etkisi arındırılarak ölçülür; gün içi düşüşleri kapsamaz.",...(!realCovered?["CPI kapsamı eksik; reel yıllık getiri hesaplanmadı."]:[])]};
}
