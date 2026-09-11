import { NextResponse } from "next/server";
import { z } from "zod";
import { getBinanceContext, getFundingHistory } from "@/lib/data/binance";
import { getHistory } from "@/lib/data/market-service";
const querySchema=z.object({symbol:z.string().regex(/^[A-Z][A-Z0-9.\-]{0,14}$/),interval:z.enum(["1d","4h"]),range:z.enum(["1y","3y","5y","10y"]),market:z.enum(["spot","futures"])});
export async function GET(request:Request) {
  const query=new URL(request.url).searchParams;
  const parsed=querySchema.safeParse({symbol:(query.get("symbol")??"").toUpperCase(),interval:query.get("interval")??"4h",range:query.get("range")??"3y",market:query.get("market")??"futures"});
  if(!parsed.success)return NextResponse.json({error:"Geçersiz sembol veya periyot."},{status:400});
  try {
    const {symbol,interval,range,market}=parsed.data;
    const crypto=symbol==="BTC"||symbol==="ETH";
    if(!crypto&&market==="futures")return NextResponse.json({error:"Bu sürümde futures yalnız BTC/ETH."},{status:400});
    const history=await getHistory(symbol,range,{interval,market,allowPartial:true});
    const warnings:string[]=[];
    const [context,funding]=await Promise.all([
      crypto&&market==="futures"&&query.get("context")==="true"?getBinanceContext(symbol).catch(()=>{warnings.push("Güncel order book / işlem akışı alınamadı.");return null;}):Promise.resolve(null),
      crypto&&market==="futures"&&query.get("funding")==="true"?getFundingHistory(symbol,history.coverage.actualFrom,history.coverage.actualTo).catch(()=>{warnings.push("Funding geçmişi alınamadı; sonuç maliyet açısından eksik.");return [];}):Promise.resolve([]),
    ]);
    return NextResponse.json({...history,context,funding:funding.map(f=>({date:f.time,rate:f.rate,markPrice:f.markPrice})),warnings});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Swing verisi alınamadı."},{status:503});}
}
