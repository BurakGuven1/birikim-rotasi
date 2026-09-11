import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { priceActionJournal } from "./price-action-journal";
import type { PriceActionSetup } from "../domain/price-action";
beforeEach(()=>{const data=new Map<string,string>();vi.stubGlobal("window",{});vi.stubGlobal("localStorage",{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value)});});
afterEach(()=>vi.unstubAllGlobals());
const account={symbol:"BTC",equityUsd:10000,availableUsd:10000,btcExposureUsd:0,leverage:2 as const};
const setup:PriceActionSetup={version:"test-v1",symbol:"BTC",action:"ready",direction:"long",model:"sweep-reclaim",entry:100,stop:90,tp1:110,tp2:120,levels:[],reasons:["fixture"],indicators:{ema20:null,ema50:null,rsi:null,macdHistogram:null,atr:1,weeklyBias:"up",dailyBias:"up"},sizing:{quantity:2,notionalUsd:200,marginUsd:100,riskUsd:21,leverage:2},generatedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),source:"fixture"};
it("takes half only once and charges fees on actual exit not entry notional",async()=>{
  const planned=await priceActionJournal.plan(setup,account);
  await priceActionJournal.open(planned.id,100,account);
  const partial=await priceActionJournal.takeTp1(planned.id,110);
  expect(partial.remainingFraction).toBe(.5);
  expect(partial.stop).toBeGreaterThan(100);
  await expect(priceActionJournal.takeTp1(planned.id,110)).rejects.toThrow();
  const closed=await priceActionJournal.close(planned.id,120);
  expect(closed.realizedPnlUsd).toBeCloseTo(30-.21-.22);
  await expect(priceActionJournal.close(planned.id,120)).rejects.toThrow();
});
it("blocks a plan without spendable capital and refuses to hide corrupt open positions",async()=>{
  await expect(priceActionJournal.plan(setup,{...account,availableUsd:0})).rejects.toThrow();
  localStorage.setItem("birikim-rotasi:swing-journal:v1","broken");
  await expect(priceActionJournal.list()).rejects.toThrow("sıfır kabul edilmedi");
});
