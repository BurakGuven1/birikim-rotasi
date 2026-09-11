import { describe, expect, it } from "vitest";
import { confirmedPivots, sizePriceActionTrade, derivePriceActionSetup } from "./price-action";
describe("price action safety", () => {
 it("blocks stale daily context even when four-hour candles are fresh",()=>{
  const now=Date.parse("2026-09-07T12:00:00Z");
  const make=(start:number,count:number,step:number)=>Array.from({length:count},(_,i)=>({date:new Date(start+i*step).toISOString(),open:100+i,close:101+i,high:102+i,low:99+i}));
  const result=derivePriceActionSetup({symbol:"BTC",equityUsd:10000,availableUsd:10000,leverage:2,now:new Date(now).toISOString(),daily:make(now-180*86400000,60,86400000),fourHour:make(now-40*14400000,40,14400000)});
  expect(result.action).toBe("wait");
  expect(result.reasons.join(" ")).toContain("günlük mum güncel değil");
 });
 it("subtracts existing margin from the ten percent account budget",()=>{
  const sized=sizePriceActionTrade({symbol:"BTC",equityUsd:10000,availableUsd:10000,openMarginUsd:950,leverage:2},100,95);
  expect(sized.marginUsd).toBeLessThanOrEqual(50);
 });
 it("requires both right-hand bars before confirming a pivot", () => {
  const bars = [1,2,5,2,1].map((high,i)=>({date:`2026-01-0${i+1}`,open:1,close:1,high,low:0.5}));
  expect(confirmedPivots(bars.slice(0,4))).toHaveLength(0);
  expect(confirmedPivots(bars).some(p=>p.price===5)).toBe(true);
 });
 it("enforces remaining aggregate risk and absolute BTC exposure", () => {
  expect(sizePriceActionTrade({symbol:"BTC",equityUsd:10000,availableUsd:10000,openRiskUsd:100,btcExposureUsd:0,leverage:2},100,95).quantity).toBe(0);
  const sized=sizePriceActionTrade({symbol:"BTC",equityUsd:10000,availableUsd:10000,btcExposureUsd:3900,leverage:2},100,95);
  expect(sized.notionalUsd).toBeLessThanOrEqual(100);
 });
 it("never uses future data and waits without closed OHLC", () => {
  const input={symbol:"BTC",daily:[],fourHour:[],equityUsd:10000,availableUsd:10000,leverage:1 as const,now:"2026-01-01T00:00:00Z"};
  expect(derivePriceActionSetup(input).action).toBe("wait");
  expect(derivePriceActionSetup({...input,fourHour:[{date:"2027-01-01",open:1,high:2,low:1,close:2}]})).toEqual(derivePriceActionSetup(input));
 });
});
