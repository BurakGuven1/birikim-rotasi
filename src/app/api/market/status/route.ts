import { NextResponse } from "next/server";
import { getProviderStatus } from "@/lib/data/market-service";

export async function GET() {
  return NextResponse.json(getProviderStatus());
}
