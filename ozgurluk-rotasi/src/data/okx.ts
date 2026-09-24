import { createHmac } from "node:crypto";
import type { Bar } from "./types.ts";
import { getJson } from "./http.ts";

const BASE = "https://www.okx.com";

interface OkxResponse<T> { code: string; msg: string; data: T }

async function publicGet<T>(path: string): Promise<T> {
  const json = await getJson<OkxResponse<T>>(BASE + path);
  if (json.code !== "0") throw new Error(`OKX ${path}: ${json.code} ${json.msg}`);
  return json.data;
}

/** Günlük mumlar (UTC). history-candles uç noktasıyla geriye doğru sayfalar. */
export async function fetchOkxDaily(instId: string, maxBars = 3000): Promise<Bar[]> {
  const out: Bar[] = [];
  let after = "";
  while (out.length < maxBars) {
    const rows = await publicGet<string[][]>(
      `/api/v5/market/history-candles?instId=${instId}&bar=1Dutc&limit=100${after ? `&after=${after}` : ""}`,
    );
    if (rows.length === 0) break;
    for (const r of rows) {
      out.push({
        date: new Date(Number(r[0])).toISOString().slice(0, 10),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[7] ?? r[5]),
      });
    }
    after = rows[rows.length - 1][0];
    if (rows.length < 100) break;
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface OkxTicker { instId: string; last: string; open24h: string; volCcy24h: string }

export async function fetchTickers(instType: "SPOT" | "SWAP"): Promise<OkxTicker[]> {
  return publicGet<OkxTicker[]>(`/api/v5/market/tickers?instType=${instType}`);
}

export async function fetchFundingRate(instId: string): Promise<{ fundingRate: number; nextFundingTime: string }> {
  const [d] = await publicGet<{ fundingRate: string; nextFundingTime: string }[]>(`/api/v5/public/funding-rate?instId=${instId}`);
  return { fundingRate: Number(d.fundingRate), nextFundingTime: new Date(Number(d.nextFundingTime)).toISOString() };
}

export interface OkxInstrument { instId: string; instCategory?: string; ctVal: string; ctValCcy: string; lotSz: string; minSz: string; lever: string }

export async function fetchInstrument(instType: "SPOT" | "SWAP", instId: string): Promise<OkxInstrument | undefined> {
  const d = await publicGet<OkxInstrument[]>(`/api/v5/public/instruments?instType=${instType}&instId=${instId}`);
  return d[0];
}

// ---------------------------------------------------------------- özel (imzalı) uçlar

export interface OkxCredentials { apiKey: string; secret: string; passphrase: string }

/** OKX v5 imzası: base64(HMAC-SHA256(timestamp + METHOD + requestPath + body, secret)) */
export function signOkx(timestamp: string, method: string, requestPath: string, body: string, secret: string): string {
  return createHmac("sha256", secret).update(timestamp + method.toUpperCase() + requestPath + body).digest("base64");
}

export async function privateRequest<T>(creds: OkxCredentials, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const ts = new Date().toISOString();
  const bodyStr = body === undefined ? "" : JSON.stringify(body);
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "OK-ACCESS-KEY": creds.apiKey,
      "OK-ACCESS-SIGN": signOkx(ts, method, path, bodyStr, creds.secret),
      "OK-ACCESS-TIMESTAMP": ts,
      "OK-ACCESS-PASSPHRASE": creds.passphrase,
      "Content-Type": "application/json",
    },
    body: bodyStr || undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json()) as OkxResponse<T>;
  if (json.code !== "0") throw new Error(`OKX ${method} ${path}: ${json.code} ${json.msg} ${JSON.stringify(json.data ?? "")}`);
  return json.data;
}
