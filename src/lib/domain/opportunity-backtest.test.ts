import {describe,expect,it} from "vitest";
import {opportunityXirr,runOpportunityBacktest} from "./opportunity-backtest";
describe("opportunity backtest cash flows",()=>{
 it("conserves identical contributions without prices and solves dated returns",()=>{
  const result=runOpportunityBacktest({market:{},fxHistory:[],years:3,endDate:"2026-01-01T00:00:00Z"});
  expect(result.rows).toHaveLength(4);
  for(const row of result.rows){expect(row.contributedUsd).toBe(46500);expect(row.endingUsd).toBe(row.contributedUsd);expect(row.orders).toBe(0);expect(row.nominalXirr).toBeCloseTo(0,8);expect(row.annualTwr).toBeCloseTo(0,8);}
  expect(opportunityXirr([{date:"2024-01-01",amount:-100},{date:"2025-01-01",amount:110}])).toBeCloseTo(.1,3);
 });
});
