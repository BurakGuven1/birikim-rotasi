import type { PricePoint } from "./types";
import { averageTrueRange, exponentialMovingAverage, relativeStrengthIndex, movingAverageConvergenceDivergence } from "./indicators";
export const PRICE_ACTION_VERSION = "price-action-v1.0.0";
export const DAY = 86_400_000;
export type OhlcBar = PricePoint & {open:number;high:number;low:number};
export interface PriceActionAccount { symbol:string; equityUsd:number; availableUsd:number; openMarginUsd?:number; openRiskUsd?:number; btcExposureUsd?:number; leverage:1|2 }
export interface PriceActionInput extends PriceActionAccount {daily:PricePoint[];fourHour:PricePoint[];now:string;source?:string}
export interface PriceActionLevel {price:number;label:string}
export interface PriceActionSizing {quantity:number;notionalUsd:number;marginUsd:number;riskUsd:number;leverage:1|2}
export interface PriceActionSetup {
 version:string;symbol:string;action:"ready"|"wait";direction:"long"|"short"|null;model:"breakout-retest"|"sweep-reclaim"|null;
 entry:number|null;stop:number|null;tp1:number|null;tp2:number|null;levels:PriceActionLevel[];reasons:string[];
 indicators:{ema20:number|null;ema50:number|null;rsi:number|null;macdHistogram:number|null;atr:number|null;weeklyBias:"up"|"down"|"neutral";dailyBias:"up"|"down"|"neutral"};
 sizing:PriceActionSizing;generatedAt:string;expiresAt:string;source:string;
}
export function closedOhlc(bars:PricePoint[],now:string,durationMs:number):OhlcBar[]{
 return bars.filter((b):b is OhlcBar=>Date.parse(b.date)+durationMs<=Date.parse(now)&&[b.open,b.high,b.low,b.close].every(v=>typeof v==="number"&&Number.isFinite(v)&&v>0)&&b.high!>=Math.max(b.open!,b.close)&&b.low!<=Math.min(b.open!,b.close)).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)).filter((b,i,all)=>!i||b.date!==all[i-1].date);
}
export function confirmedPivots(bars:PricePoint[]):PriceActionLevel[]{
 const levels:PriceActionLevel[]=[];
 for(let i=2;i<bars.length-2;i++){
  const b=bars[i],other=[bars[i-2],bars[i-1],bars[i+1],bars[i+2]];
  if(b.high!==undefined&&other.every(o=>o.high!==undefined&&o.high<b.high!))levels.push({price:b.high,label:`Onaylı tepe ${b.date}`});
  if(b.low!==undefined&&other.every(o=>o.low!==undefined&&o.low>b.low!))levels.push({price:b.low,label:`Onaylı dip ${b.date}`});
 }
 return levels;
}
export function isCrypto(symbol:string){return /^(BTC|ETH)(-?USD|USDT)?$/i.test(symbol);}
export function sizePriceActionTrade(account:PriceActionAccount,entry:number,stop:number,costs={commissionBps:10,impactBps:7.5}):PriceActionSizing{
 const leverage:1|2=isCrypto(account.symbol)&&account.leverage===2?2:1;
 if (![account.equityUsd,account.availableUsd,account.openMarginUsd??0,account.openRiskUsd??0,account.btcExposureUsd??0,entry,stop].every(Number.isFinite)) return {quantity:0,notionalUsd:0,marginUsd:0,riskUsd:0,leverage};
 const equity=Math.max(0,account.equityUsd), risk=Math.max(0,Math.min(equity*.005,equity*.01-(account.openRiskUsd??0)));
 const margin=Math.max(0,Math.min(account.availableUsd,equity*.1-Math.max(0,account.openMarginUsd??0)));
 const exposure=/^BTC/i.test(account.symbol)?Math.max(0,equity*.4-Math.abs(account.btcExposureUsd??0)):Infinity;
 const riskPerUnit=Math.abs(entry-stop)+(entry+stop)*(Math.max(0,costs.commissionBps)+Math.max(0,costs.impactBps))/10000;
 const quantity=entry>0&&Math.abs(entry-stop)>0&&Number.isFinite(riskPerUnit)?Math.max(0,Math.min(risk/riskPerUnit,margin*leverage/entry,exposure/entry)):0;
 return {quantity,notionalUsd:quantity*entry,marginUsd:quantity*entry/leverage,riskUsd:quantity*riskPerUnit,leverage};
}
function calendarLevels(daily:OhlcBar[],now:string):PriceActionLevel[]{
 const date=new Date(now), year=date.getUTCFullYear(),month=date.getUTCMonth();
 const monday=new Date(Date.UTC(year,month,date.getUTCDate()));monday.setUTCDate(monday.getUTCDate()-(monday.getUTCDay()+6)%7);
 const periods:[string,number,number][]=[["Hafta",+monday,+monday-7*DAY],["Ay",Date.UTC(year,month,1),Date.UTC(year,month-1,1)],["Yıl",Date.UTC(year,0,1),Date.UTC(year-1,0,1)]];
 return periods.flatMap(([label,start,prior])=>{
  const current=daily.find(b=>Date.parse(b.date)>=start),prev=daily.filter(b=>Date.parse(b.date)>=prior&&Date.parse(b.date)<start);
  return [...(current?[{price:current.open,label:`${label} açılışı`}]:[]),...(prev.length?[{price:Math.max(...prev.map(b=>b.high)),label:`Önceki ${label} tepesi`},{price:Math.min(...prev.map(b=>b.low)),label:`Önceki ${label} dibi`}]:[])];
 });
}
export function derivePriceActionSetup(input:PriceActionInput):PriceActionSetup{
 const daily=closedOhlc(input.daily,input.now,DAY),bars=closedOhlc(input.fourHour,input.now,DAY/6),closes=daily.map(b=>b.close);
 const ema20=exponentialMovingAverage(closes,20).at(-1)??null,ema50=exponentialMovingAverage(closes,50).at(-1)??null;
 const atr=averageTrueRange(bars,14).at(-1)??null,last=bars.at(-1),previous=bars.at(-2);
 // Only fully completed UTC weeks contribute to weekly context.
 const weeks=new Map<number,OhlcBar[]>();for(const b of daily){const d=new Date(b.date);const key=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(d.getUTCDay()+6)%7);if(key+7*DAY<=Date.parse(input.now))weeks.set(key,[...(weeks.get(key)??[]),b]);}
 const weekly=[...weeks.values()].map(w=>w.at(-1)!.close);
 const weeklyBias=weekly.length<2?"neutral":weekly.at(-1)!>weekly.at(-2)!?"up":weekly.at(-1)!<weekly.at(-2)!?"down":"neutral";
 const dailyBias=ema20===null||ema50===null?"neutral":ema20>ema50?"up":ema20<ema50?"down":"neutral";
 const levels=[...calendarLevels(daily,input.now),...confirmedPivots(daily.slice(-180)),...confirmedPivots(bars.slice(0,-1).slice(-180))];
 const setup:PriceActionSetup={version:PRICE_ACTION_VERSION,symbol:input.symbol,action:"wait",direction:null,model:null,entry:last?.close??null,stop:null,tp1:null,tp2:null,levels,reasons:[],indicators:{ema20,ema50,rsi:relativeStrengthIndex(closes).at(-1)??null,macdHistogram:movingAverageConvergenceDivergence(closes).histogram.at(-1)??null,atr,weeklyBias,dailyBias},sizing:{quantity:0,notionalUsd:0,marginUsd:0,riskUsd:0,leverage:isCrypto(input.symbol)?input.leverage:1},generatedAt:input.now,expiresAt:new Date(Date.parse(input.now)+7*DAY).toISOString(),source:input.source??"provided OHLC"};
 if(!last||!previous||!atr||daily.length<50||bars.length<30){setup.reasons.push("Yeterli kapanmış günlük / 4 saatlik OHLC yok.");return setup;}
 if(Date.parse(input.now)-(Date.parse(daily.at(-1)!.date)+DAY)>(isCrypto(input.symbol)?2*DAY:4*DAY)){setup.reasons.push("Son kapanmış günlük mum güncel değil.");return setup;}
 if(Date.parse(input.now)-(Date.parse(last.date)+DAY/6)> (isCrypto(input.symbol)?DAY/2:4*DAY)){setup.reasons.push("Son kapanmış mum güncel değil.");return setup;}
 const direction=dailyBias==="up"&&weeklyBias==="up"?"long":dailyBias==="down"&&weeklyBias==="down"&&isCrypto(input.symbol)?"short":null;
 if(!direction){setup.reasons.push("Haftalık ve günlük yön uyumu yok.");return setup;}
 const sign=direction==="long"?1:-1;
 const candidate=levels.find(level=>direction==="long"?last.low<level.price&&last.close>level.price&&previous.close>=level.price:last.high>level.price&&last.close<level.price&&previous.close<=level.price);
 const retest=levels.find(level=>direction==="long"?previous.open<level.price&&previous.close>level.price&&last.low<=level.price+atr*.15&&last.close>level.price:previous.open>level.price&&previous.close<level.price&&last.high>=level.price-atr*.15&&last.close<level.price);
 const level=retest??candidate;
 if(!level){setup.reasons.push("Kırılım-tekrar test veya süpürme-geri kazanım kapanışı bekleniyor.");return setup;}
 const entry=last.close,stop=direction==="long"?Math.min(level.price,last.low)-.25*atr:Math.max(level.price,last.high)+.25*atr,risk=Math.abs(entry-stop);
 const opposing=[...new Set(levels.map(l=>l.price))].filter(p=>(p-entry)*sign>=risk).sort((a,b)=>(a-b)*sign);
 const tp1=opposing[0],tp2=opposing.find(p=>(p-entry)*sign>=2*risk&&(p-tp1)*sign>0);
 Object.assign(setup,{direction,model:retest?"breakout-retest":"sweep-reclaim",entry,stop,tp1:tp1??null,tp2:tp2??null});
 if(tp1===undefined||tp2===undefined){setup.reasons.push("En az 1R / 2R mesafede iki gerçek karşı seviye yok.");return setup;}
 setup.sizing=sizePriceActionTrade(input,entry,stop);
 if(setup.sizing.quantity<=0){setup.reasons.push("Marjin, toplam risk veya BTC maruziyet sınırı dolu.");return setup;}
 setup.action="ready";setup.reasons.push(`${level.label}: kapanış teyidi; işlem emri gönderilmez.`);return setup;
}
