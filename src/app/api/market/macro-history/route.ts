import { NextResponse } from "next/server";
import { getFredSeries } from "@/lib/data/fred";

export async function GET() {
  try {
    return NextResponse.json({ points: await getFredSeries("M2SL"), source: "FRED" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "M2 geçmişi alınamadı." }, { status: 503 });
  }
}
