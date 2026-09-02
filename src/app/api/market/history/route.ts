import { NextResponse } from "next/server";
import { z } from "zod";
import { getHistory } from "@/lib/data/market-service";

const schema = z.object({ symbol: z.string().min(1).max(30), range: z.enum(["1y", "3y", "5y", "10y", "max"]).default("5y") });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = schema.safeParse({ symbol: url.searchParams.get("symbol") ?? "", range: url.searchParams.get("range") ?? "5y" });
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz sembol veya dönem." }, { status: 400 });
  try { return NextResponse.json(await getHistory(parsed.data.symbol.toUpperCase(), parsed.data.range)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Geçmiş veri alınamadı." }, { status: 503 }); }
}
