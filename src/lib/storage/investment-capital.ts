import { investmentRepository } from "./investment-repository";
import { portfolioRepository } from "./portfolio-repository";
import { earnRepository } from "./earn-repository";
import { reserveSummary } from "../domain/earn-reserve";
import { valueInvestmentHoldings } from "../domain/monthly-investment";
import type { MarketSnapshot } from "../domain/types";
export async function readInvestmentCapital() {
  const [policy,earn,transactions]=await Promise.all([investmentRepository.getPolicy(),earnRepository.get(),portfolioRepository.list()]);
  const reserve=reserveSummary(earn),now=new Date();
  const symbols=[...new Set([...transactions.map(t=>t.symbol),...(transactions.some(t=>t.currency==="TRY")?["USDTRY"]:[])])];
  const quotes:Record<string,MarketSnapshot>={};
  if(symbols.length) {
    const response=await fetch(`/api/market/quotes?symbols=${encodeURIComponent(symbols.join(","))}`,{signal:AbortSignal.timeout(45000)});
    if(!response.ok)throw new Error("Portföy fiyatları alınamadı.");
    const payload=await response.json() as Record<string,{ok:boolean;data?:MarketSnapshot}>;
    for(const [symbol,result] of Object.entries(payload))if(result.ok&&result.data)quotes[symbol]=result.data;
  }
  const fx=quotes.USDTRY;
  const fxAge=fx?now.getTime()-Date.parse(fx.asOf):Infinity;
  const usdTry=fx&&fx.price>0&&fxAge>=-300000&&fxAge<96*3600000&&fx.status!=="stale"&&fx.status!=="unavailable"?fx.price:undefined;
  const valuation=valueInvestmentHoldings(transactions,quotes,usdTry,policy.cashReserveUsd+reserve.valueUsd,now);
  const issues=[...valuation.missing,...reserve.issues];
  return {equityUsd:Object.values(valuation.values).reduce((a,b)=>a+b,0),availableUsd:valuation.complete&&reserve.valuationFresh&&!issues.length?policy.cashReserveUsd+reserve.availableUsd:0,btcExposureUsd:valuation.values.bitcoin,issues,policy};
}
