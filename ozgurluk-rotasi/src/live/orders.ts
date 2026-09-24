import { env } from "../env.ts";
import { fetchInstrument, getLast, privateRequest, type OkxCredentials, type OkxInstrument } from "./okx-extra.ts";

export interface OrderIntent {
  instId: string;
  side: "buy" | "sell";
  /** Nominal büyüklük, USD */
  usd: number;
  /** Stop-loss tetik fiyatı (önerilir) */
  stopLoss?: number;
  takeProfit?: number;
  /** Mevcut pozisyonu yalnız azalt/kapat */
  reduceOnly?: boolean;
}

export interface OrderPlan {
  body: Record<string, unknown>;
  price: number;
  size: string;
  notionalUsd: number;
  warnings: string[];
}

/** Adet → lot adımına yuvarla (aşağı). */
export function roundToLot(qty: number, lotSz: string): string {
  const step = Number(lotSz);
  const decimals = lotSz.includes(".") ? lotSz.split(".")[1].length : 0;
  const n = Math.floor(qty / step + 1e-9) * step;
  return n.toFixed(decimals);
}

/** Saf fonksiyon: niyet + enstrüman + fiyat → OKX v5 /trade/order gövdesi. */
export function buildOrder(intent: OrderIntent, inst: OkxInstrument, price: number): OrderPlan {
  const warnings: string[] = [];
  const isSwap = intent.instId.endsWith("-SWAP");
  if (intent.instId === "SPX-USDT-SWAP") warnings.push("SPX-USDT-SWAP bir memecoin'dir (SPX6900), S&P 500 değildir! US500-USDT-SWAP kullanın.");
  let size: string;
  let notional: number;
  const body: Record<string, unknown> = { instId: intent.instId, side: intent.side, ordType: "market" };
  if (isSwap) {
    const ctVal = Number(inst.ctVal);
    size = roundToLot(intent.usd / (price * ctVal), inst.lotSz);
    notional = Number(size) * ctVal * price;
    body.tdMode = "isolated";
    body.sz = size;
    if (intent.reduceOnly) body.reduceOnly = true;
  } else {
    // Spot market alış: tgtCcy=quote_ccy ile USDT tutarı; satış: baz adet
    body.tdMode = "cash";
    if (intent.side === "buy") {
      body.tgtCcy = "quote_ccy";
      size = intent.usd.toFixed(2);
      notional = intent.usd;
    } else {
      size = roundToLot(intent.usd / price, inst.lotSz);
      notional = Number(size) * price;
    }
    body.sz = size;
  }
  if (Number(size) < Number(inst.minSz) && !(body.tgtCcy === "quote_ccy")) warnings.push(`Büyüklük ${size} < min ${inst.minSz}`);
  const algo: Record<string, string> = {};
  if (intent.stopLoss) {
    const wrong = intent.side === "buy" ? intent.stopLoss >= price : intent.stopLoss <= price;
    if (wrong) warnings.push(`Stop (${intent.stopLoss}) fiyatın yanlış tarafında (${price}).`);
    algo.slTriggerPx = String(intent.stopLoss);
    algo.slOrdPx = "-1";
  } else if (isSwap && !intent.reduceOnly) {
    warnings.push("Stop-loss yok. Swing işlemlerinde stop zorunlu tutulmalı.");
  }
  if (intent.takeProfit) {
    algo.tpTriggerPx = String(intent.takeProfit);
    algo.tpOrdPx = "-1";
  }
  if (Object.keys(algo).length) body.attachAlgoOrds = [algo];
  return { body, price, size, notionalUsd: notional, warnings };
}

export function credentials(): OkxCredentials | undefined {
  const apiKey = env("OKX_API_KEY");
  const secret = env("OKX_SECRET_KEY");
  const passphrase = env("OKX_PASSPHRASE");
  return apiKey && secret && passphrase ? { apiKey, secret, passphrase } : undefined;
}

export function liveEnabled(): boolean {
  return env("OKX_LIVE") === "1";
}

export async function planOrder(intent: OrderIntent): Promise<OrderPlan> {
  const type = intent.instId.endsWith("-SWAP") ? "SWAP" : "SPOT";
  const inst = await fetchInstrument(type, intent.instId);
  if (!inst) throw new Error(`Enstrüman bulunamadı: ${intent.instId}`);
  const price = await getLast(intent.instId);
  return buildOrder(intent, inst, price);
}

/**
 * Emir: varsayılan ÖNİZLEME. Borsaya yalnız OKX_LIVE=1 VE live=true iken ve
 * nominal ≤ OKX_MAX_ORDER_USD olduğunda gönderilir.
 */
export async function executeOrder(intent: OrderIntent, live: boolean): Promise<{ plan: OrderPlan; sent: boolean; response?: unknown }> {
  const plan = await planOrder(intent);
  const maxUsd = Number(env("OKX_MAX_ORDER_USD") ?? "1500");
  if (!live || !liveEnabled()) return { plan, sent: false };
  if (plan.notionalUsd > maxUsd) throw new Error(`Emir ${plan.notionalUsd.toFixed(0)}$ > güvenlik sınırı ${maxUsd}$`);
  if (plan.warnings.some((w) => w.includes("yanlış tarafında") || w.includes("memecoin"))) throw new Error(`Emir engellendi: ${plan.warnings.join(" | ")}`);
  const creds = credentials();
  if (!creds) throw new Error("OKX anahtarları .env içinde tanımlı değil");
  const response = await privateRequest(creds, "POST", "/api/v5/trade/order", plan.body);
  return { plan, sent: true, response };
}
