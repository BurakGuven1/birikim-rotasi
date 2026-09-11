import { NextResponse } from "next/server";
import { getInvestmentSnapshot, getDcaSnapshot } from "@/lib/data/investment-service";

export async function GET(request: Request) {
  try {
    return NextResponse.json(await (new URL(request.url).searchParams.get("dca") === "true" ? getDcaSnapshot() : getInvestmentSnapshot()), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Yatırım verileri alınamadı. Biraz sonra yeniden dene." }, { status: 503 });
  }
}
