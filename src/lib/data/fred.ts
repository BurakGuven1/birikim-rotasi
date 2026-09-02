import type { PricePoint } from "../domain/types";
import { freshnessStatus } from "./provider";

export interface FredMacroIndicator {
  id: "M2SL" | "CPIAUCSL" | "DFII10";
  label: string;
  value: number;
  change: number;
  unit: string;
  asOf: string;
  status: "fresh" | "delayed" | "stale";
  source: string;
}

export async function getFredSeries(seriesId: string): Promise<PricePoint[]> {
  const apiKey = process.env.FRED_API_KEY;
  if (apiKey) {
    const response = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(seriesId)}&api_key=${encodeURIComponent(apiKey)}&file_type=json&sort_order=asc`, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`FRED ${response.status}`);
    const payload = await response.json() as { observations?: Array<{ date: string; value: string }> };
    return (payload.observations ?? []).flatMap((row) => row.value !== "." && Number.isFinite(Number(row.value)) ? [{ date: `${row.date}T00:00:00Z`, close: Number(row.value) }] : []);
  }
  const response = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`FRED ${response.status}`);
  const text = await response.text();
  return text.trim().split(/\r?\n/).slice(1).flatMap((line) => {
    const [date, value] = line.split(",");
    return value && value !== "." ? [{ date: `${date}T00:00:00Z`, close: Number(value) }] : [];
  });
}

function yearAgo(points: PricePoint[]) {
  const latest = points.at(-1);
  if (!latest) return undefined;
  const cutoff = new Date(latest.date);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  return points.filter((point) => new Date(point.date) <= cutoff).at(-1) ?? points.at(0);
}

export async function getFredMacroIndicators(): Promise<FredMacroIndicator[]> {
  const definitions = [
    { id: "M2SL" as const, label: "ABD M2 para arzı", unit: "Milyar $", mode: "ratio" },
    { id: "CPIAUCSL" as const, label: "ABD tüketici fiyat endeksi", unit: "Endeks", mode: "ratio" },
    { id: "DFII10" as const, label: "ABD 10 yıllık reel faiz", unit: "%", mode: "difference" },
  ];
  return Promise.all(definitions.map(async (definition) => {
    const points = await getFredSeries(definition.id);
    const latest = points.at(-1);
    const previous = yearAgo(points);
    if (!latest || !previous) throw new Error(`FRED ${definition.id} verisi boş.`);
    const rawChange = definition.mode === "ratio" ? latest.close / previous.close - 1 : latest.close - previous.close;
    return {
      id: definition.id,
      label: definition.label,
      value: latest.close,
      change: Number(rawChange.toFixed(4)),
      unit: definition.unit,
      asOf: latest.date,
      status: freshnessStatus(latest.date, "macro"),
      source: process.env.FRED_API_KEY ? "FRED API" : "FRED CSV",
    };
  }));
}
