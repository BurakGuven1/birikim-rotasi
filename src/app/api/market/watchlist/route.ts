import { NextResponse } from "next/server";
import { refreshStockWatchlist } from "@/lib/data/stock-watchlist-service";

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 }); }
  const market = body && typeof body === "object" && "market" in body ? body.market : undefined;
  if (market !== "US" && market !== "TR") return NextResponse.json({ error: "Geçersiz piyasa." }, { status: 400 });
  try { return NextResponse.json(await refreshStockWatchlist(market), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Takip listesi güncellenemedi." }, { status: 503 }); }
}
