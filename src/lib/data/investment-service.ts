import { INVESTMENT_ASSETS, type InvestmentMarket } from "../domain/monthly-investment";
import type { MarketSnapshot, PricePoint } from "../domain/types";
import { getHistory, getQuote, type HistoryCoverage } from "./market-service";

export interface InvestmentSnapshot {
  market: InvestmentMarket;
  fx?: MarketSnapshot;
  fxHistory: PricePoint[];
  histories?: Record<string, HistoryCoverage>;
  fxHistoryMetadata?: HistoryCoverage;
  fetchedAt: string;
  errors: string[];
}

let cached: InvestmentSnapshot | undefined;
let inFlight: Promise<InvestmentSnapshot> | undefined;

export async function getInvestmentSnapshot(): Promise<InvestmentSnapshot> {
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 60_000) return cached;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const errors: string[] = [];
    const histories: Record<string, HistoryCoverage> = {};
    const market: InvestmentMarket = {};
    const results = await Promise.allSettled([
      ...INVESTMENT_ASSETS.map(async asset => {
        const [quote, history] = await Promise.allSettled([getQuote(asset.symbol), getHistory(asset.symbol, "10y", { allowPartial: true })]);
        market[asset.key] = { quote: quote.status === "fulfilled" ? quote.value : undefined, history: history.status === "fulfilled" ? history.value.points : [], source: history.status === "fulfilled" ? history.value.source : "Veri yok" };
        if (history.status === "fulfilled") histories[asset.key] = history.value.coverage;
        if (quote.status === "rejected" || history.status === "rejected") errors.push(`${asset.label}: fiyat veya günlük geçmiş verisi eksik.`);
      }),
      getQuote("USDTRY"), getHistory("USDTRY", "10y", { allowPartial: true }),
    ]);
    const fxResult = results[INVESTMENT_ASSETS.length] as PromiseSettledResult<MarketSnapshot>;
    const fxHistoryResult = results[INVESTMENT_ASSETS.length + 1] as PromiseSettledResult<{ points: PricePoint[]; coverage: HistoryCoverage }>;
    if (fxResult.status === "rejected") errors.push("Güncel USD/TRY alınamadı.");
    if (fxHistoryResult.status === "rejected") errors.push("Tarihsel USD/TRY alınamadı; BIST sinyali bekleyecek.");
    cached = { market, fx: fxResult.status === "fulfilled" ? fxResult.value : undefined, fxHistory: fxHistoryResult.status === "fulfilled" ? fxHistoryResult.value.points : [], histories, fxHistoryMetadata: fxHistoryResult.status === "fulfilled" ? fxHistoryResult.value.coverage : undefined, fetchedAt: new Date().toISOString(), errors };
    return cached;
  })().finally(() => { inFlight = undefined; });
  return inFlight;
}

let dcaCache: InvestmentSnapshot | undefined;
export async function getDcaSnapshot(): Promise<InvestmentSnapshot> {
  if(dcaCache && Date.now()-Date.parse(dcaCache.fetchedAt)<60000) return dcaCache;
  const market:InvestmentMarket={},errors:string[]=[];
  const values=await Promise.allSettled([...INVESTMENT_ASSETS.map(async a=>{
    try{market[a.key]={quote:await getQuote(a.symbol),history:[],source:"Güncel fiyat"};}
    catch{errors.push(`${a.symbol}: fiyat alınamadı; tutar planı korunur.`);}
  }),getQuote("USDTRY")]);
  const fx=values.at(-1) as PromiseSettledResult<MarketSnapshot>;
  dcaCache={market,fx:fx.status==="fulfilled"?fx.value:undefined,fxHistory:[],fetchedAt:new Date().toISOString(),errors};
  return dcaCache;
}
