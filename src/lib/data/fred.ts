import type { PricePoint } from "../domain/types";

export async function getFredSeries(seriesId: string): Promise<PricePoint[]> {
  const response = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`FRED ${response.status}`);
  const text = await response.text();
  return text.trim().split(/\r?\n/).slice(1).flatMap((line) => {
    const [date, value] = line.split(",");
    return value && value !== "." ? [{ date: `${date}T00:00:00Z`, close: Number(value) }] : [];
  });
}
