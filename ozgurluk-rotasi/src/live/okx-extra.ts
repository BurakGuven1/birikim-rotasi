export { fetchInstrument, privateRequest, type OkxCredentials, type OkxInstrument } from "../data/okx.ts";
import { getJson } from "../data/http.ts";

export async function getLast(instId: string): Promise<number> {
  const json = await getJson<{ code: string; data: { last: string }[] }>(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`);
  if (json.code !== "0" || !json.data[0]) throw new Error(`Fiyat alınamadı: ${instId}`);
  return Number(json.data[0].last);
}
