import type { PricePoint } from "./types";
import { exponentialMovingAverage, relativeStrengthIndex } from "./indicators";
export function relativeMarketSeries(numerator:PricePoint[],denominator:PricePoint[],now=new Date()){
 const closed=(points:PricePoint[])=>[...new Map(points.filter(p=>Number.isFinite(p.close)&&p.close>0&&Date.parse(p.date)+86400000<=+now).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)).map(p=>[p.date.slice(0,10),p.close])).entries()];
 const den=new Map(closed(denominator));const values=closed(numerator).flatMap(([date,close])=>{const d=den.get(date);return d?[{date,ratio:close/d}]:[];});
 const prices=values.map(p=>p.ratio),ema20=exponentialMovingAverage(prices,20),ema50=exponentialMovingAverage(prices,50),rsi=relativeStrengthIndex(prices,14);
 return values.map((p,i)=>({...p,ema20:ema20[i],ema50:ema50[i],rsi:rsi[i]}));
}
