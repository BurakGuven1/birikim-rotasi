import { NextResponse } from "next/server";
import { getFredMacroIndicators } from "@/lib/data/fred";

export async function GET() {
  try {
    return NextResponse.json(await getFredMacroIndicators());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Makro veri alınamadı." }, { status: 503 });
  }
}
