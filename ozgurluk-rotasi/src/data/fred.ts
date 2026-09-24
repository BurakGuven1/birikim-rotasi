import type { Point } from "./types.ts";
import { getJson, getText } from "./http.ts";

/** FRED serisi: anahtar varsa resmi API, yoksa herkese açık grafik CSV'si. */
export async function fetchFred(id: string, apiKey?: string): Promise<Point[]> {
  if (apiKey) {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${apiKey}&file_type=json`;
    const json = await getJson<{ observations: { date: string; value: string }[] }>(url);
    return json.observations.filter((o) => o.value !== ".").map((o) => ({ date: o.date, value: Number(o.value) }));
  }
  // FRED CSV uç noktası tarayıcı benzeri User-Agent'ları reddedebiliyor.
  const csv = await getText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`, { headers: { "User-Agent": "curl/8.5.0" } });
  return csv
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.split(","))
    .filter(([, v]) => v && v !== ".")
    .map(([d, v]) => ({ date: d, value: Number(v) }));
}
