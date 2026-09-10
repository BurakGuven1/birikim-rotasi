import type { DcaResult, DcaResultRow } from "./dca-backtest";
import { opportunityXirr } from "./opportunity-backtest";
import type { AssetClass } from "./types";
type Curve=DcaResultRow["curve"];
function measure(curve:Curve,from:number,to:number){
 const flows:{date:string;amount:number}[]=[];let previous=from?curve[from].value:0,twr=1,peak=1,dd=0;
 if(from)flows.push({date:curve[from].date,amount:-previous});
 for(let i=from?from+1:0;i<=to;i++){const point=curve[i],flow=point.contributed-(curve[i-1]?.contributed??0);if(flow)flows.push({date:point.date,amount:-flow});if(previous>0)twr*=Math.max(0,(point.value-flow)/previous);peak=Math.max(peak,twr);dd=Math.max(dd,1-twr/peak);previous=point.value;}
 flows.push({date:curve[to].date,amount:curve[to].value});const annual=opportunityXirr(flows);return {annual,drawdown:dd,score:annual===null?-Infinity:annual-.5*dd};
}
export function screenDcaBaskets(result:DcaResult){
 const btc=result.rows.find(r=>r.name==="BTC DCA"),vti=result.rows.find(r=>r.name==="VTI DCA"),gold=result.rows.find(r=>r.name==="Altın DCA"),base=result.rows.find(r=>r.name==="Sabit sepet DCA");
 if(!btc?.complete||!vti?.complete||!gold?.complete||!base?.complete)return {available:false as const,reason:"BTC, VTI, altın ve mevcut sepetin tam dönem verisi gerekli; eksik veriyle tarama yapılmadı."};
 const cutoff=Date.parse(result.start)+(Date.parse(result.end)-Date.parse(result.start))*.6;
 const split=btc.curve.findLastIndex(p=>Date.parse(p.date)<=cutoff);
 if(split<2||split>=btc.curve.length-2)return {available:false as const,reason:"Ayrı seçim ve doğrulama dönemi için veri yetersiz."};
 const combine=(b:number,g:number)=>btc.curve.map((p,i)=>({...p,value:p.value*b+gold.curve[i].value*g+vti.curve[i].value*(1-b-g)}));
 let selected:{weights:Record<AssetClass,number>;train:ReturnType<typeof measure>;curve:Curve}|undefined;let tested=0;
 for(const b of [0,.1,.2,.3,.4])for(const g of [.1,.2,.3,.4]){const v=+(1-b-g).toFixed(2);if(v<.2||v>.8)continue;tested++;const curve=combine(b,g),train=measure(curve,0,split);if(!selected||train.score>selected.train.score)selected={weights:{bitcoin:b,commodity:g,foreignEquity:v,turkishEquity:0},train,curve};}
 if(!selected)return {available:false as const,reason:"Uygun sepet bulunamadı."};
 const validation=measure(selected.curve,split,selected.curve.length-1),baseline=measure(base.curve,split,base.curve.length-1);
 const supported=validation.annual!==null&&validation.annual>0&&validation.score>=baseline.score+.01&&validation.drawdown<=baseline.drawdown+.02;
 return {available:true as const,weights:selected.weights,tested,selectedUntil:btc.curve[split].date,train:selected.train,validation,baseline,supported,
  note:"BTC/VTI/IAU sepetleri yalnız ilk %60 dönemde yıllık nominal XIRR − 0,5 × azami düşüş puanıyla seçilir. Son %40 seçimde kullanılmaz. Sabit DCA eğrileri birleştirilir; minimum emir ve kuruş yuvarlama farkları nedeniyle tarama yaklaşık karşılaştırmadır. Temettü/vergi yok; değişken katkı yönteminin backtesti değildir. En iyi gelecek sepetini kanıtlamaz."};
}
