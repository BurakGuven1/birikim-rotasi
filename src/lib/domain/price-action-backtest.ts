import type {PricePoint} from "./types";
import {closedOhlc,DAY,derivePriceActionSetup,isCrypto,PRICE_ACTION_VERSION,sizePriceActionTrade,type PriceActionSetup} from "./price-action";
export interface FundingPoint {date:string;rate:number}
export interface PriceActionBacktestInput {symbol:string;daily:PricePoint[];fourHour:PricePoint[];equityUsd:number;leverage:1|2;source?:string;commissionBps?:number;spreadBps?:number;slippageBps?:number;fundingHistory?:FundingPoint[];now?:string}
export interface PriceActionTrade {id:string;direction:"long"|"short";model:string;entryAt:string;exitAt:string;entry:number;exit:number;stop:number;tp1:number;tp2:number;quantity:number;grossPnlUsd:number;costsUsd:number;fundingUsd:number;netPnlUsd:number;rMultiple:number;tp1Hit:boolean;tp2Hit:boolean;exitReason:"stop"|"tp2"|"expiry";partition:"train"|"validation"|"test"}
export interface PriceActionMetrics {closedTrades:number;netPnlUsd:number;netWinRate:number;tp1Rate:number;tp2Rate:number;averageR:number;profitFactor:number|null;maxDrawdownPercent:number;netExpectancyUsd:number;returnPercent:number;elapsedDays:number}
export interface PriceActionBacktestResult {trades:PriceActionTrade[];metrics:PriceActionMetrics;partitions:{name:"train"|"validation"|"test";from:string;to:string;metrics:PriceActionMetrics}[];eligibility:{eligible:boolean;reasons:string[]};openPosition:{direction:string;entry:number;quantity:number;unrealizedPnlUsd:number;openedAt:string}|null;metadata:{version:string;source:string;parameters:{commissionBps:number;spreadBps:number;slippageBps:number;leverage:number};fundingStatus:string;barConvention:string};equityCurve:{date:string;equityUsd:number}[]}
interface Position {setup:PriceActionSetup;entry:number;quantity:number;remaining:number;stop:number;initialStop:number;risk:number;entryAt:string;lastFundingAt:number;gross:number;costs:number;funding:number;tp1Hit:boolean;partition:PriceActionTrade["partition"]}
export function summarizePriceActionTrades(trades:PriceActionTrade[],initial:number,curve:{equityUsd:number}[],days:number):PriceActionMetrics{
 const net=trades.reduce((s,t)=>s+t.netPnlUsd,0),wins=trades.filter(t=>t.netPnlUsd>0),loss=-trades.filter(t=>t.netPnlUsd<0).reduce((s,t)=>s+t.netPnlUsd,0);
 let peak=initial,drawdown=0;for(const p of curve){peak=Math.max(peak,p.equityUsd);if(peak>0)drawdown=Math.max(drawdown,(peak-p.equityUsd)/peak*100);}
 return {closedTrades:trades.length,netPnlUsd:net,netWinRate:trades.length?wins.length/trades.length:0,tp1Rate:trades.length?trades.filter(t=>t.tp1Hit).length/trades.length:0,tp2Rate:trades.length?trades.filter(t=>t.tp2Hit).length/trades.length:0,averageR:trades.length?trades.reduce((s,t)=>s+t.rMultiple,0)/trades.length:0,profitFactor:loss?wins.reduce((s,t)=>s+t.netPnlUsd,0)/loss:null,maxDrawdownPercent:drawdown,netExpectancyUsd:trades.length?net/trades.length:0,returnPercent:initial?((curve.at(-1)?.equityUsd??initial)/initial-1)*100:0,elapsedDays:days};
}
// Candle dates denote opening timestamps. A decision consumes only bars whose end <= decision time.
export function runPriceActionBacktest(input:PriceActionBacktestInput):PriceActionBacktestResult{
 const commissionBps=input.commissionBps??10,spreadBps=input.spreadBps??5,slippageBps=input.slippageBps??5;
 if([commissionBps,spreadBps,slippageBps].some(v=>!Number.isFinite(v)||v<0)||!Number.isFinite(input.equityUsd)||input.equityUsd<=0)throw new Error("Pozitif sermaye ve geçerli maliyetler gerekli.");
 const commission=commissionBps/10000,impact=(spreadBps/2+slippageBps)/10000;
 const bars=closedOhlc(input.fourHour,input.now??new Date().toISOString(),DAY/6),daily=closedOhlc(input.daily,input.now??new Date().toISOString(),DAY);
 const start=Date.parse(bars[0]?.date??input.now??new Date().toISOString()),end=bars.length?Date.parse(bars.at(-1)!.date)+DAY/6:start,span=end-start;
 const bounds=[start,start+span*.6,start+span*.8,end],names=["train","validation","test"] as const;
 const partitionAt=(time:number)=>names[time<bounds[1]?0:time<bounds[2]?1:2];
 let cash=input.equityUsd,position:Position|null=null,pending:PriceActionSetup|null=null,dailyCursor=0,fundingCursor=0,fundingComplete=true;
 const trades:PriceActionTrade[]=[],equityCurve:{date:string;equityUsd:number}[]=[];
 const funding=(input.fundingHistory??[]).filter(f=>Number.isFinite(f.rate)&&Number.isFinite(Date.parse(f.date))).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
 for(let i=0;i<bars.length;i++){
  const b=bars[i],time=Date.parse(b.date),closeTime=time+DAY/6;
  if(!position&&pending&&Date.parse(pending.expiresAt)>time){
   const sign=pending.direction==="long"?1:-1,entry=b.open*(1+sign*impact);
   // Cancel a gapped signal if its actual fill invalidates structural risk/reward.
   if((entry-pending.stop!)*sign>0&&(pending.tp1!-entry)*sign>=Math.abs(entry-pending.stop!)&&(pending.tp2!-entry)*sign>=2*Math.abs(entry-pending.stop!)){
    const sizing=sizePriceActionTrade({symbol:input.symbol,equityUsd:cash,availableUsd:cash,leverage:input.leverage},entry,pending.stop!,{commissionBps,impactBps:spreadBps/2+slippageBps});
    if(sizing.quantity>0)position={setup:pending,entry,quantity:sizing.quantity,remaining:sizing.quantity,stop:pending.stop!,initialStop:pending.stop!,risk:sizing.riskUsd,entryAt:b.date,lastFundingAt:time,gross:0,costs:entry*sizing.quantity*commission,funding:0,tp1Hit:false,partition:partitionAt(time)};
   }
  }
  pending=null;
  if(position){
   const p:Position=position,sign=p.setup.direction==="long"?1:-1;
   const quantityBefore=p.remaining;
   while(fundingCursor<funding.length&&Date.parse(funding[fundingCursor].date)<=p.lastFundingAt)fundingCursor++;
   const fundingDue:FundingPoint[]=[];
   while(fundingCursor<funding.length&&Date.parse(funding[fundingCursor].date)<=closeTime){if(isCrypto(input.symbol))fundingDue.push(funding[fundingCursor]);fundingCursor++;}
   if(isCrypto(input.symbol))for(let scheduled=Math.floor(p.lastFundingAt/(DAY/3))*(DAY/3)+DAY/3;scheduled<=closeTime;scheduled+=DAY/3){if(!fundingDue.some(f=>Math.abs(Date.parse(f.date)-scheduled)<60_000))fundingComplete=false;}
   p.lastFundingAt=closeTime;
   const exit=(raw:number,quantity:number)=>{const fill=raw*(1-sign*impact);p.gross+=(fill-p.entry)*quantity*sign;p.costs+=fill*quantity*commission;p.remaining-=quantity;return fill;};
   let reason:PriceActionTrade["exitReason"]|null=null,exitPrice=0,tp2Hit=false;
   // Stop first, including a gap through the stop; TP gaps get only the target price.
   const stopHit=sign===1?b.low<=p.stop:b.high>=p.stop;
   if(stopHit){exitPrice=exit(sign===1?Math.min(b.open,p.stop):Math.max(b.open,p.stop),p.remaining);reason="stop";}
   else {
    const tp1Hit=sign===1?b.high>=p.setup.tp1!:b.low<=p.setup.tp1!;
    if(!p.tp1Hit&&tp1Hit){exitPrice=exit(p.setup.tp1!,p.quantity/2);p.tp1Hit=true;
     // Remaining half must cover its own round-trip execution costs at breakeven.
     p.stop=sign===1?p.entry*(1+commission)/((1-impact)*(1-commission)):p.entry*(1-commission)/((1+impact)*(1+commission));
     if(sign===1?b.low<=p.stop:b.high>=p.stop){exitPrice=exit(p.stop,p.remaining);reason="stop";}
    }
    if(!reason&&(sign===1?b.high>=p.setup.tp2!:b.low<=p.setup.tp2!)){exitPrice=exit(p.setup.tp2!,p.remaining);reason="tp2";tp2Hit=true;}
   }
   // Intrabar exit timing is unknown: charge liabilities on pre-exit size, but never assume credits on exited size.
   for(const f of fundingDue){const signedRate=f.rate*sign;p.funding+=(signedRate>=0?quantityBefore:p.remaining)*b.open*signedRate;}
   if(reason){const net=p.gross-p.costs-p.funding;cash+=net;trades.push({id:`${input.symbol}-${p.entryAt}`,direction:p.setup.direction!,model:p.setup.model!,entryAt:p.entryAt,exitAt:new Date(closeTime).toISOString(),entry:p.entry,exit:exitPrice,stop:p.initialStop,tp1:p.setup.tp1!,tp2:p.setup.tp2!,quantity:p.quantity,grossPnlUsd:p.gross,costsUsd:p.costs,fundingUsd:p.funding,netPnlUsd:net,rMultiple:p.risk?net/p.risk:0,tp1Hit:p.tp1Hit,tp2Hit,exitReason:reason,partition:p.partition});position=null;}
  }
  const mark=position?position.gross-position.costs-position.funding+(b.close-position.entry)*position.remaining*(position.setup.direction==="long"?1:-1)-b.close*position.remaining*(commission+impact):0;
  equityCurve.push({date:new Date(closeTime).toISOString(),equityUsd:cash+mark});
  while(dailyCursor<daily.length&&Date.parse(daily[dailyCursor].date)+DAY<=closeTime)dailyCursor++;
  if(!position&&i>=29){const setup=derivePriceActionSetup({symbol:input.symbol,daily:daily.slice(Math.max(0,dailyCursor-730),dailyCursor),fourHour:bars.slice(Math.max(0,i-239),i+1),now:new Date(closeTime).toISOString(),equityUsd:cash,availableUsd:cash,leverage:input.leverage,source:input.source});if(setup.action==="ready")pending=setup;}
 }
 const partitions=names.map((name,i)=>{const selected=trades.filter(t=>t.partition===name&&Date.parse(t.exitAt)<=bounds[i+1]),curve=equityCurve.filter(p=>Date.parse(p.date)>bounds[i]&&Date.parse(p.date)<=bounds[i+1]),initial=equityCurve.filter(p=>Date.parse(p.date)<=bounds[i]).at(-1)?.equityUsd??input.equityUsd;return {name,from:new Date(bounds[i]).toISOString(),to:new Date(bounds[i+1]).toISOString(),metrics:summarizePriceActionTrades(selected,initial,curve,(bounds[i+1]-bounds[i])/DAY)};});
 const oos=partitions[2].metrics,reasons:string[]=[];
 if(oos.closedTrades<30)reasons.push("Test bölümünde en az 30 kapanmış işlem gerekli.");
 if(oos.netExpectancyUsd<=0)reasons.push("Test bölümü net beklentisi pozitif değil.");
 if(isCrypto(input.symbol)&&(!funding.length||!fundingComplete))reasons.push("Tarihsel funding yok; kripto sonuçları eksik maliyet içeriyor.");
 const openPosition=position?{direction:position.setup.direction!,entry:position.entry,quantity:position.remaining,unrealizedPnlUsd:equityCurve.at(-1)!.equityUsd-cash,openedAt:position.entryAt}:null;
 return {trades,metrics:summarizePriceActionTrades(trades,input.equityUsd,equityCurve,span/DAY),partitions,eligibility:{eligible:reasons.length===0,reasons},openPosition,metadata:{version:PRICE_ACTION_VERSION,source:input.source??"provided OHLC",parameters:{commissionBps,spreadBps,slippageBps,leverage:isCrypto(input.symbol)?input.leverage:1},fundingStatus:funding.length&&fundingComplete?"Tarihsel funding uygulandı":isCrypto(input.symbol)?"Funding eksik":"Spot; funding uygulanmaz",barConvention:"UTC açılış zamanı; kapanışta karar, sonraki mum açılışında giriş; aynı mumda stop öncelikli; zaman bazlı 60/20/20, optimizasyon yok; bölüm sınırını aşan işlemler bölüm işlem metrikleri ve uygunluktan hariç; funding 8 saatlik UTC kapsam kontrolü, mum açılışı fiyat yaklaşımı, çıkış mumunda alacak varsayılmaz"},equityCurve};
}
