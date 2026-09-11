import { assessOpportunity, allocateOpportunities, OPPORTUNITY_CAPS, OPPORTUNITY_VERSION } from "./opportunity-investment";
import { DEFAULT_INVESTMENT_POLICY } from "./investment-policy";
import type { InvestmentMarket } from "./monthly-investment";
import type { AssetClass, PricePoint } from "./types";
const DAY=86400000,YEAR=365.2425*DAY;
const keys:AssetClass[]=["foreignEquity","commodity","bitcoin","turkishEquity"];
export interface DatedFlow {date:string;amount:number}
export function opportunityXirr(flows:DatedFlow[]):number|null {
 if(!flows.some(f=>f.amount<0)||!flows.some(f=>f.amount>0))return null;
 const first=Date.parse(flows[0].date),npv=(rate:number)=>flows.reduce((s,f)=>s+f.amount/Math.pow(1+rate,(Date.parse(f.date)-first)/YEAR),0);
 let low=-.9999,high=1;while(npv(low)*npv(high)>0&&high<1e6)high=high*2+1;
 if(npv(low)*npv(high)>0)return null;
 for(let i=0;i<160;i++){const mid=(low+high)/2;if(npv(low)*npv(mid)<=0)high=mid;else low=mid;}
 return (low+high)/2;
}
export interface OpportunityBacktestInput {market:InvestmentMarket;fxHistory:PricePoint[];cpiHistory?:PricePoint[];years:3|5|10;endDate?:string;reserveApr?:number;feeBps?:number}
export interface OpportunityBacktestRow {name:string;contributedUsd:number;endingUsd:number;reserveUsd:number;costsUsd:number;nominalXirr:number|null;realXirr:number|null;realEndingUsd:number|null;annualTwr:number|null;maxDrawdown:number;orders:number;curve:{date:string;value:number;contributed:number}[]}
export interface OpportunityBacktestResult {startDate:string;endDate:string;rows:OpportunityBacktestRow[];warnings:string[];metadata:{version:string;method:string;flows:string;costs:string;sources:string[];reserveApr:number};coverage:{asset:string;start:string|null;end:string|null}[]}
function clean(points:PricePoint[]){return [...new Map(points.filter(p=>Number.isFinite(p.close)&&p.close>0&&Number.isFinite(Date.parse(p.date))).map(p=>[p.date,p])).values()].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));}
function lastIndex(points:PricePoint[],time:number,offset=0){let lo=0,hi=points.length;while(lo<hi){const mid=(lo+hi)>>>1;if(Date.parse(points[mid].date)+offset<=time)lo=mid+1;else hi=mid;}return lo-1;}
interface Order {key:AssetClass;amount:number;fee:number;time:number;price:number}
interface Portfolio {name:string;cash:number;units:Record<AssetClass,number>;pending:Order[];costs:number;orders:number;twr:number;peak:number;drawdown:number;previous:number;curve:OpportunityBacktestRow["curve"];apr:number}
export function runOpportunityBacktest(input:OpportunityBacktestInput):OpportunityBacktestResult {
 const end=Date.parse(input.endDate??new Date().toISOString()),startDate=new Date(end);startDate.setUTCFullYear(startDate.getUTCFullYear()-input.years);const start=+startDate;
 const feeBps=input.feeBps??DEFAULT_INVESTMENT_POLICY.feeBps,apr=input.reserveApr??0;
 if(!Number.isFinite(end)||!Number.isFinite(feeBps)||feeBps<0||feeBps>500||!Number.isFinite(apr)||apr<0||apr>1)throw new Error("Geçersiz tarih / maliyet / rezerv oranı.");
 const fx=clean(input.fxHistory),cpi=clean(input.cpiHistory??[]),histories={} as Record<AssetClass,PricePoint[]>;
 for(const key of keys)histories[key]=clean(input.market[key]?.history??[]).flatMap(p=>{if(key!=="turkishEquity")return [p];const index=lastIndex(fx,Date.parse(p.date),DAY),rate=fx[index]?.close;if(!rate||Date.parse(p.date)-(Date.parse(fx[index].date)+DAY)>7*DAY)return [];return [{...p,open:p.open===undefined?undefined:p.open/rate,high:p.high===undefined?undefined:p.high/rate,low:p.low===undefined?undefined:p.low/rate,close:p.close/rate}];});
 const coverage=keys.map(key=>({asset:key,start:histories[key][0]?.date??null,end:histories[key].at(-1)?.date??null}));
 const warnings=["Fiyat getirisi: temettü, vergi ve enflasyona göre endekslenmiş ücret yok. BIST100 yatırım yapılabilir fon değil; gösterge karşılaştırmasıdır.","BIST USD dönüşümü o tarihte bilinen son USD/TRY kapanışını kullanır; gün içi kur hareketi modellenmez.","Fırsat modeli en az 251 tamamlanmış hafta ister. Isınma verisi yoksa rezervde bekler; sıfır işlem başarı anlamına gelmez.","CPI gerçekleşmiş (revize edilebilir) seriyle yalnız performans deflatörü; sinyal girdisi değildir."];
 for(const item of coverage){if(!item.start||Date.parse(item.start)>start)warnings.push(`${item.asset}: başlangıç kapsamı eksik; fiyat bulunana kadar nakit.`);if(!item.end||Date.parse(item.end)+7*DAY<end)warnings.push(`${item.asset}: bitiş fiyatı eksik/eski; son bilinen kapanışla değerleme.`);if(!histories[item.asset as AssetClass].some(p=>Number.isFinite(p.open)&&p.open!>0))warnings.push(`${item.asset}: gerçek açılış fiyatı yok; alım yapılamadı.`);}
 const flowMap=new Map<number,number>();for(let year=startDate.getUTCFullYear();year<=new Date(end).getUTCFullYear();year++)for(let month=0;month<12;month++){const time=Date.UTC(year,month,DEFAULT_INVESTMENT_POLICY.contributionDay);if(time>=start&&time<=end)flowMap.set(time,1000+(month===DEFAULT_INVESTMENT_POLICY.annualContributionMonth-1?DEFAULT_INVESTMENT_POLICY.annualContributionUsd:0));}
 const dates=new Set<number>([start,end,...flowMap.keys()]),weekly=new Set<number>();const monday=new Date(start);monday.setUTCHours(0,0,0,0);monday.setUTCDate(monday.getUTCDate()+(8-monday.getUTCDay())%7);for(let time=+monday;time<=end;time+=7*DAY){if(time>=start){dates.add(time);weekly.add(time);}}
 const portfolios:Portfolio[]=["Fırsat · rezerv %0","BTC DCA","VTI DCA","Sabit sepet",...(apr>0?[`Fırsat · rezerv %${(apr*100).toFixed(1)} senaryosu`]:[])].map((name,index)=>({name,cash:0,units:{foreignEquity:0,commodity:0,bitcoin:0,turkishEquity:0},pending:[],costs:0,orders:0,twr:1,peak:1,drawdown:0,previous:0,curve:[],apr:index===4?apr:0}));
 const queue=[...dates].sort((a,b)=>a-b);const enqueue=(time:number)=>{if(!dates.has(time)){dates.add(time);let index=0;while(index<queue.length&&queue[index]<time)index++;queue.splice(index,0,time);}};
 const priceAt=(key:AssetClass,time:number)=>{const history=histories[key],index=lastIndex(history,time),bar=history[index];if(!bar)return 0;return Date.parse(bar.date)+DAY<=time?bar.close:bar.open??history[index-1]?.close??0;};
 const value=(p:Portfolio,time:number)=>p.cash+p.pending.reduce((s,o)=>s+o.amount+o.fee,0)+keys.reduce((s,key)=>s+p.units[key]*priceAt(key,time),0);
 const order=(p:Portfolio,key:AssetClass,amount:number,time:number)=>{const history=histories[key];let index=lastIndex(history,time)+1;while(index<history.length&&(!history[index].open||history[index].open!<=0))index++;const point=history[index],fillTime=point?Date.parse(point.date):Infinity;const fee=Math.ceil(amount*feeBps/100)/100;if(!point||fillTime>end||fillTime-time>7*DAY||amount<DEFAULT_INVESTMENT_POLICY.minOrderUsd||amount+fee>p.cash+.000001)return;p.cash-=amount+fee;p.pending.push({key,amount,fee,time:fillTime,price:point.open!});enqueue(fillTime);};
 let contributed=0,previousTime=start;
 while(queue.length){const time=queue.shift()!,flow=flowMap.get(time)??0;contributed+=flow;
  for(let pi=0;pi<portfolios.length;pi++){const p=portfolios[pi];p.cash*=Math.pow(1+p.apr/365.2425,(time-previousTime)/DAY);p.cash+=flow;
   for(const fill of p.pending.filter(o=>o.time===time)){p.units[fill.key]+=fill.amount/fill.price;p.costs+=fill.fee;p.orders++;}p.pending=p.pending.filter(o=>o.time!==time);
   const current=value(p,time);if(p.previous>0)p.twr*=Math.max(0,(current-flow)/p.previous);p.peak=Math.max(p.peak,p.twr);p.drawdown=Math.max(p.drawdown,1-p.twr/p.peak);
   if((pi===0||pi===4)&&weekly.has(time)&&p.cash>=DEFAULT_INVESTMENT_POLICY.minOrderUsd){const candidates=keys.map(key=>{const history=histories[key].slice(0,lastIndex(histories[key],time,DAY)+1),assessment=assessOpportunity(history,new Date(time));return {key,score:assessment.score,stage:assessment.stage,currentUsd:p.units[key]*(history.at(-1)?.close??0)+p.pending.filter(o=>o.key===key).reduce((s,o)=>s+o.amount,0),cap:OPPORTUNITY_CAPS[key]};});const allocation=allocateOpportunities({budgetUsd:0,reserveUsd:p.cash,portfolioUsd:current,feeBps,minOrderUsd:DEFAULT_INVESTMENT_POLICY.minOrderUsd,candidates});for(const key of keys)order(p,key,allocation.amounts[key]??0,time);}
   else if(pi>0&&pi<4&&flow>0){const budget=p.cash,weights:Partial<Record<AssetClass,number>>=pi===1?{bitcoin:1}:pi===2?{foreignEquity:1}:{foreignEquity:.35,commodity:.25,bitcoin:.2,turkishEquity:.2};for(const key of keys)order(p,key,Math.floor(budget*(weights[key]??0)/(1+feeBps/10000)*100)/100,time);}
   p.previous=value(p,time);p.curve.push({date:new Date(time).toISOString(),value:p.previous,contributed});
  }previousTime=time;
 }
 const flows=[...flowMap].map(([time,amount])=>({date:new Date(time).toISOString(),amount:-amount}));const cpiStart=cpi[lastIndex(cpi,start)]?.close,cpiEndPoint=cpi[lastIndex(cpi,end)],cpiEnd=cpiEndPoint?.close;
 const cpiCovered=!!cpiStart&&!!cpiEnd&&start-Date.parse(cpi[lastIndex(cpi,start)].date)<100*DAY&&end-Date.parse(cpiEndPoint.date)<100*DAY&&flows.every(f=>{const point=cpi[lastIndex(cpi,Date.parse(f.date))];return point&&Date.parse(f.date)-Date.parse(point.date)<100*DAY;});
 if(!cpiCovered)warnings.push("CPI kapsamı eksik: reel sonuç hesaplanmadı.");
 const rows=portfolios.map(p=>{const ending=value(p,end),realFlows=cpiCovered?flows.map(f=>({...f,amount:f.amount*cpiStart!/cpi[lastIndex(cpi,Date.parse(f.date))].close})):[],realEnding=cpiCovered?ending*cpiStart!/cpiEnd!:null;return {name:p.name,contributedUsd:contributed,endingUsd:ending,reserveUsd:p.cash,costsUsd:p.costs,nominalXirr:opportunityXirr([...flows,{date:new Date(end).toISOString(),amount:ending}]),realXirr:realEnding===null?null:opportunityXirr([...realFlows,{date:new Date(end).toISOString(),amount:realEnding}]),realEndingUsd:realEnding,annualTwr:Math.pow(p.twr,YEAR/(end-start))-1,maxDrawdown:p.drawdown,orders:p.orders,curve:p.curve};});
 return {startDate:new Date(start).toISOString(),endDate:new Date(end).toISOString(),rows,warnings,coverage,metadata:{version:OPPORTUNITY_VERSION,method:"Haftalık UTC kontrolü; kapanmış veride karar, sonraki mevcut açılışta alım (en fazla 7 gün). Gerçek rezerv yeniden kullanılır; kaldıraç yok. XIRR para ağırlıklı, TWR katkılardan arındırılmış; 365,2425 günlük yıl.",flows:"Her ayın 5'i 1.000 USD + her Nisan 5'i 3.500 USD; tüm kollarda aynı akış.",costs:`Her alım ${feeBps} baz puan; rezerv ana kol %0, tarihsel Earn getirisi varsayılmadı.`,sources:keys.map(key=>`${key}: ${input.market[key]?.source??"veri yok"}`),reserveApr:apr}};
}
