import { NextResponse } from "next/server";
import { z } from "zod";
import { getHistory } from "@/lib/data/market-service";

const schema = z.object({ symbol: z.string().min(1).max(30), range: z.enum(["1y", "3y", "5y", "10y", "max"]).default("5y"), interval: z.enum(["1d", "4h"]).optional(), market: z.enum(["spot", "futures"]).optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional(), allowPartial: z.enum(["true", "false"]).optional().transform(value => value === "true") });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = schema.safeParse(Object.fromEntries(["symbol", "range", "interval", "market", "from", "to", "allowPartial"].map(key => [key, url.searchParams.get(key) ?? undefined])));
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz sembol veya dönem." }, { status: 400 });
  try { const { symbol, range, ...options } = parsed.data; return NextResponse.json(await getHistory(symbol.toUpperCase(), range, options)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Geçmiş veri alınamadı." }, { status: 503 }); }
}
