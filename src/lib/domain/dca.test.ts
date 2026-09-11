import { describe, expect, it } from "vitest";
import { DEFAULT_INVESTMENT_POLICY, normalizeInvestmentPolicy } from "./investment-policy";
import { buildMonthlyInvestment, EMPTY_INVESTMENT_VALUES } from "./monthly-investment";
import { relativeMarketSeries } from "./relative-market";
import { screenDcaBaskets } from "./dca-screen";
import { runDcaBacktest, DCA_SYMBOLS, BIST_DCA_SYMBOLS } from "./dca-backtest";
const now=new Date("2026-09-07T12:00:00Z");
describe("DCA contribution accounting",()=>{
 it("varies contributions toward underweight assets without selling",()=>{
  const input={budgetUsd:1000,policy:DEFAULT_INVESTMENT_POLICY,market:{},currentValues:{...EMPTY_INVESTMENT_VALUES,bitcoin:3500,foreignEquity:5500,commodity:1000},valuationComplete:true,now};
  const p=buildMonthlyInvestment(input),fixed=buildMonthlyInvestment({...input,policy:{...DEFAULT_INVESTMENT_POLICY,dcaAllocation:"fixed"}});
  expect(p.rows.find(r=>r.key==="commodity")!.amountUsd).toBeGreaterThan(fixed.rows.find(r=>r.key==="commodity")!.amountUsd);
  expect(p.rows.find(r=>r.key==="foreignEquity")!.amountUsd).toBe(0);
  expect(p.rows.reduce((sum,r)=>sum+r.amountUsd,0)+p.costUsd).toBeCloseTo(1000,8);
 });
 it("pairs only shared closed days and never carries missing ratio data",()=>{
  const numerator=[{date:"2026-09-04",close:200},{date:"2026-09-05",close:300},{date:"2026-09-07",close:400}];
  const denominator=[{date:"2026-09-04",close:100},{date:"2026-09-06",close:100},{date:"2026-09-07",close:100}];
  expect(relativeMarketSeries(numerator,denominator,now).map(p=>p.ratio)).toEqual([2]);
 });
 it("uses historical FX for Turkish shares rather than reporting TRY growth as USD growth",()=>{
  const points=Array.from({length:1110},(_,i)=>({date:new Date(Date.UTC(2023,7,25+i)).toISOString(),open:i<500?100:200,close:i<500?100:200}));
  // FX closes one day before the equity open; both double together in USD terms.
  const fx=points.map(p=>({date:new Date(Date.parse(p.date)-86400000).toISOString(),close:p.close/100}));
  const r=runDcaBacktest({histories:Object.fromEntries(BIST_DCA_SYMBOLS.map(s=>[s,{points,source:"fixture"}])),fxHistory:fx,years:3,endDate:now.toISOString(),policy:{...DEFAULT_INVESTMENT_POLICY,feeBps:0,annualContributionUsd:0}}).rows.find(r=>r.name==="BIST 5’li DCA")!;
  expect(r.complete).toBe(true);expect(r.endingUsd).toBeCloseTo(36000,6);
 });

 it("migrates the former opportunity default without losing the contribution schedule",()=>{
  const p=normalizeInvestmentPolicy({version:2,allocationMode:"opportunity",startDate:"2026-12-05",annualContributionUsd:4200});
  expect(p.allocationMode).toBe("dca");expect(p.annualContributionUsd).toBe(4200);expect(p.startDate).toBe("2026-12-05");
 });
 it("allocates a monthly budget without technical history and conserves fees",()=>{
  const p=buildMonthlyInvestment({budgetUsd:1000,policy:DEFAULT_INVESTMENT_POLICY,market:{},currentValues:EMPTY_INVESTMENT_VALUES,valuationComplete:true,now});
  expect(p.rows.find(r=>r.key==="cash")!.amountUsd).toBeLessThan(.1);
  expect(p.rows.find(r=>r.key==="bitcoin")!.amountUsd).toBeGreaterThan(340);
  expect(p.rows.reduce((s,r)=>s+r.amountUsd,0)+p.costUsd).toBeCloseTo(1000,8);
  expect(p.status).toBe("draft");
 });
 it("redirects excess BTC purchases to other assets instead of reserve",()=>{
  const p=buildMonthlyInvestment({budgetUsd:1000,policy:DEFAULT_INVESTMENT_POLICY,market:{},currentValues:{...EMPTY_INVESTMENT_VALUES,bitcoin:4300,foreignEquity:5700},valuationComplete:true,now});
  const btc=p.rows.find(r=>r.key==="bitcoin")!;
  expect(btc.afterWeight).toBeLessThanOrEqual(.4);
  expect(p.rows.find(r=>r.key==="cash")!.amountUsd).toBeLessThan(.1);
 });
 it("keeps every strategy on identical flows and flags missing history",()=>{
  const result=runDcaBacktest({histories:{},years:3,endDate:now.toISOString()});
  expect(result.rows).toHaveLength(6);
  result.rows.forEach(r=>{expect(r.contributedUsd).toBe(46500);expect(r.endingUsd).toBe(46500);expect(r.orders).toBe(0);expect(r.complete).toBe(false);});
 });
 it("buys every monthly contribution at flat prices and accounts for all fees",()=>{
  const points=Array.from({length:1110},(_,i)=>({date:new Date(Date.UTC(2023,7,25+i)).toISOString(),open:100,close:100}));
  const histories=Object.fromEntries(DCA_SYMBOLS.map(s=>[s,{points,source:"fixture",complete:true}]));
  const result=runDcaBacktest({histories,fxHistory:points.map(p=>({...p,close:1})),years:3,endDate:now.toISOString(),policy:{...DEFAULT_INVESTMENT_POLICY,annualContributionUsd:0}});
  const first=screenDcaBaskets(result);
  const changed=structuredClone(result);
  const cutoff=Date.parse(result.start)+(Date.parse(result.end)-Date.parse(result.start))*.6;
  changed.rows.forEach(r=>r.curve.forEach(p=>{if(Date.parse(p.date)>cutoff && r.name==="BTC DCA")p.value*=5;}));
  const second=screenDcaBaskets(changed);
  expect(first.available&&second.available&&first.weights).toEqual(second.available&&second.weights);
  for(const r of result.rows){expect(r.complete).toBe(true);expect(r.endingUsd+r.costsUsd).toBeCloseTo(36000,6);expect(r.cashUsd).toBeLessThan(1);expect(r.orders).toBe(r.name==="Sabit sepet DCA"?108:r.name==="BIST 5’li DCA"?180:36);}
 });
});
