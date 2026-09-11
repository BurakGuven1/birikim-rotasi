import {beforeEach,describe,expect,it,vi} from "vitest";
import type {PriceActionSetup} from "./price-action";
import {derivePriceActionSetup} from "./price-action";
import {runPriceActionBacktest} from "./price-action-backtest";
vi.mock("./price-action",async importOriginal=>({...await importOriginal<typeof import("./price-action")>(),derivePriceActionSetup:vi.fn()}));
const start=Date.parse("2026-01-01T00:00:00Z"),step=14_400_000;
function run(direction:"long"|"short",tail:{open:number;high:number;low:number;close:number}[]){
 const sign=direction==="long"?1:-1;
 vi.mocked(derivePriceActionSetup).mockImplementation(input=>({action:"ready",direction,model:"sweep-reclaim",entry:100,stop:100-sign*5,tp1:100+sign*6,tp2:100+sign*12,expiresAt:new Date(Date.parse(input.now)+7*86_400_000).toISOString()} as PriceActionSetup));
 const fourHour=[...Array.from({length:30},()=>({open:100,high:101,low:99,close:100})),...tail].map((b,i)=>({...b,date:new Date(start+i*step).toISOString()}));
 return runPriceActionBacktest({symbol:"BTC",daily:[],fourHour,equityUsd:10000,leverage:1,commissionBps:0,spreadBps:0,slippageBps:0,now:new Date(start+fourHour.length*step).toISOString()});
}
describe("price action execution accounting",()=>{
 beforeEach(()=>vi.clearAllMocks());
 it("takes stop before target on an ambiguous long bar",()=>{const r=run("long",[{open:100,high:115,low:94,close:100}]);expect(r.trades[0].exitReason).toBe("stop");expect(r.trades[0].rMultiple).toBe(-1);expect(r.trades[0].tp1Hit).toBe(false);});
 it("takes a worse gap fill rather than the original stop",()=>{const r=run("long",[{open:100,high:102,low:98,close:100},{open:90,high:94,low:88,close:91}]);expect(r.trades[0].exit).toBe(90);expect(r.trades[0].rMultiple).toBe(-2);});
 it("accounts for a short half exit and remaining breakeven",()=>{const r=run("short",[{open:100,high:101,low:93,close:95}]);expect(r.trades[0].tp1Hit).toBe(true);expect(r.trades[0].tp2Hit).toBe(false);expect(r.trades[0].netPnlUsd).toBe(30);expect(r.trades[0].rMultiple).toBe(.6);});
 it("marks an open position without a closed win",()=>{const r=run("long",[{open:100,high:103,low:99,close:102}]);expect(r.metrics.closedTrades).toBe(0);expect(r.metrics.netWinRate).toBe(0);expect(r.openPosition?.unrealizedPnlUsd).toBe(20);expect(r.eligibility.eligible).toBe(false);});
});
