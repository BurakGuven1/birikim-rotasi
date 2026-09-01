import { NextResponse } from "next/server";
import { z } from "zod";
import { getQuote } from "@/lib/data/market-service";

const querySchema = z.string().min(1).transform((value) => value.split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean).slice(0, 30));

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(url.searchParams.get("symbols") ?? "");
  if (!parsed.success) return NextResponse.json({ error: "En az bir sembol gerekli." }, { status: 400 });
  const entries = await Promise.all(parsed.data.map(async (symbol) => {
    try { return [symbol, { ok: true, data: await getQuote(symbol) }] as const; }
    catch (error) { return [symbol, { ok: false, error: error instanceof Error ? error.message : "Veri alınamadı." }] as const; }
  }));
  return NextResponse.json(Object.fromEntries(entries));
}
