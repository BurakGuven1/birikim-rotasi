import { NextResponse } from "next/server";
import { getFredSeries } from "@/lib/data/fred";

const supportedSeries = new Set(["M2SL", "CPIAUCSL"]);

export async function GET(request: Request) {
  const requestedSeries = new URL(request.url).searchParams.get("series") ?? "M2SL";
  if (!supportedSeries.has(requestedSeries)) {
    return NextResponse.json({ error: "Desteklenmeyen FRED serisi." }, { status: 400 });
  }

  try {
    return NextResponse.json({ points: await getFredSeries(requestedSeries), source: "FRED", series: requestedSeries });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "FRED geçmişi alınamadı." }, { status: 503 });
  }
}
