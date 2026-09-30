import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { ASSET_IDS, ASSETS, type AssetId } from "./config.ts";
import { ROOT } from "./env.ts";
import type { Quote } from "./data/quotes.ts";
import type { Bar } from "./data/types.ts";

/** Nakit kalemleri: fiyatı her zaman 1 (USD/USDT). */
export type CashBucket = "SWING" | "NAKIT";
export type Holding = AssetId | CashBucket;
export const HOLDINGS: Holding[] = [...ASSET_IDS, "SWING", "NAKIT"];
export const HOLDING_NAMES: Record<Holding, string> = {
  ...Object.fromEntries(ASSET_IDS.map((id) => [id, ASSETS[id].name])),
  SWING: "Swing kasası (USDT)",
  NAKIT: "Nakit / fırsat kasası",
} as Record<Holding, string>;

export interface Tx {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  asset: Holding;
  side: "buy" | "sell";
  /** Birim fiyat (USD). Nakit kalemlerinde 1. */
  price: number;
  quantity: number;
  /** İşlem tutarı (USD) = price × quantity */
  usd: number;
  note?: string;
  strategy?: string;
  createdAt: string;
}

export const PORTFOLIO_FILE = join(ROOT, "data", "portfoy.json");

export function readTxs(file = PORTFOLIO_FILE): Tx[] {
  if (!existsSync(file)) return [];
  const j = JSON.parse(readFileSync(file, "utf8")) as { transactions?: Tx[] };
  return (j.transactions ?? []).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

export function writeTxs(txs: Tx[], file = PORTFOLIO_FILE): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify({ version: 1, transactions: txs }, null, 2));
  renameSync(tmp, file); // yarım yazılmış dosya bırakmamak için atomik değişim
}

/** Tarayıcıdan gelen (kullanıcının cihazında saklanan) işlem listesini doğrular ve sıralar. */
export function sanitizeTxs(raw: unknown): Tx[] {
  if (!Array.isArray(raw)) return [];
  const pos = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x > 0;
  const str = (x: unknown, n: number) => (typeof x === "string" && x ? x.slice(0, n) : undefined);
  const out: Tx[] = [];
  for (const t of raw.slice(0, 5000) as Partial<Tx>[]) {
    if (!t || !HOLDINGS.includes(t.asset as Holding) || !pos(t.price) || !pos(t.quantity)) continue;
    if (typeof t.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) continue;
    out.push({
      id: str(t.id, 64) ?? randomUUID(),
      date: t.date,
      asset: t.asset as Holding,
      side: t.side === "sell" ? "sell" : "buy",
      price: t.price!,
      quantity: t.quantity!,
      usd: t.price! * t.quantity!,
      note: str(t.note, 200),
      strategy: str(t.strategy, 40),
      createdAt: str(t.createdAt, 40) ?? new Date().toISOString(),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

export interface TxInput { date?: string; asset: string; side?: string; usd?: number; quantity?: number; price?: number; note?: string; strategy?: string }

/** Girdiyi doğrular; tutar veya miktardan diğerini fiyatla hesaplar. */
export function makeTx(input: TxInput, marketPrice: number | undefined): Tx {
  const asset = input.asset as Holding;
  if (!HOLDINGS.includes(asset)) throw new Error(`Bilinmeyen varlık: ${input.asset}`);
  const side = input.side === "sell" ? "sell" : "buy";
  const cash = asset === "SWING" || asset === "NAKIT";
  const price = cash ? 1 : Number(input.price) > 0 ? Number(input.price) : marketPrice;
  if (!price || !(price > 0)) throw new Error("Fiyat bulunamadı; fiyatı elle girin.");
  let quantity = Number(input.quantity) > 0 ? Number(input.quantity) : NaN;
  const usdIn = Number(input.usd) > 0 ? Number(input.usd) : NaN;
  if (Number.isNaN(quantity) && Number.isNaN(usdIn)) throw new Error("Tutar ($) veya miktar girin.");
  if (Number.isNaN(quantity)) quantity = usdIn / price;
  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : new Date().toISOString().slice(0, 10);
  return {
    id: randomUUID(),
    date,
    asset,
    side,
    price,
    quantity,
    usd: price * quantity,
    note: input.note?.slice(0, 200) || undefined,
    strategy: input.strategy?.slice(0, 40) || undefined,
    createdAt: new Date().toISOString(),
  };
}

export interface Position {
  asset: Holding;
  name: string;
  unit: string;
  quantity: number;
  avgCost: number;
  /** Açık pozisyonun maliyeti */
  costBasis: number;
  price: number;
  priceTime?: string;
  priceLabel?: string;
  value: number;
  pnl: number;
  pnlPct: number;
  realized: number;
  weight: number;
  firstDate: string;
}

export interface Valuation {
  positions: Position[];
  totals: { value: number; costBasis: number; pnl: number; pnlPct: number; realized: number; netInvested: number; txCount: number };
}

/** Ortalama maliyet yöntemiyle pozisyonlar, anlık değer ve kâr/zarar. */
export function valuate(txs: Tx[], quotes: Partial<Record<AssetId, Quote>>): Valuation {
  const acc = new Map<Holding, { qty: number; cost: number; realized: number; first: string }>();
  let netInvested = 0;
  for (const t of txs) {
    const a = acc.get(t.asset) ?? { qty: 0, cost: 0, realized: 0, first: t.date };
    if (t.side === "buy") {
      a.qty += t.quantity;
      a.cost += t.usd;
      netInvested += t.usd;
    } else {
      const q = Math.min(t.quantity, a.qty);
      const avg = a.qty > 0 ? a.cost / a.qty : 0;
      a.realized += (t.price - avg) * q;
      a.cost -= avg * q;
      a.qty -= q;
      netInvested -= t.usd;
    }
    acc.set(t.asset, a);
  }
  const positions: Position[] = [];
  for (const [asset, a] of acc) {
    if (a.qty <= 1e-12 && Math.abs(a.realized) < 0.005) continue;
    const cash = asset === "SWING" || asset === "NAKIT";
    const q = cash ? undefined : quotes[asset as AssetId];
    const price = cash ? 1 : q?.price ?? (a.qty > 0 ? a.cost / a.qty : 0);
    const value = a.qty * price;
    positions.push({
      asset,
      name: HOLDING_NAMES[asset],
      unit: cash ? "USD" : q?.unit ?? "",
      quantity: a.qty,
      avgCost: a.qty > 0 ? a.cost / a.qty : 0,
      costBasis: a.cost,
      price,
      priceTime: q?.time,
      priceLabel: q?.label,
      value,
      pnl: value - a.cost,
      pnlPct: a.cost > 0 ? value / a.cost - 1 : 0,
      realized: a.realized,
      weight: 0,
      firstDate: a.first,
    });
  }
  const value = positions.reduce((s, p) => s + p.value, 0);
  const costBasis = positions.reduce((s, p) => s + p.costBasis, 0);
  const realized = positions.reduce((s, p) => s + p.realized, 0);
  for (const p of positions) p.weight = value > 0 ? p.value / value : 0;
  positions.sort((x, y) => y.value - x.value);
  return {
    positions,
    totals: { value, costBasis, pnl: value - costBasis, pnlPct: costBasis > 0 ? value / costBasis - 1 : 0, realized, netInvested, txCount: txs.length },
  };
}

/**
 * Aylık değer geçmişi (yaklaşık): her alımın değeri, varlığın günlük kapanış serisindeki
 * getiriyle büyütülür. Son nokta anlık fiyattan hesaplanan değerle aynı olmayabilir.
 */
export function history(txs: Tx[], bars: Record<AssetId, Bar[]>): { month: string; value: number; invested: number }[] {
  if (!txs.length) return [];
  const priceAt = (id: AssetId, date: string): number | undefined => {
    const b = bars[id];
    let lo = 0, hi = b.length - 1;
    if (!b.length || b[0].date > date) return b[0]?.close;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (b[mid].date <= date) lo = mid; else hi = mid - 1; }
    return b[lo].close;
  };
  const start = txs[0].date.slice(0, 7);
  const now = new Date().toISOString().slice(0, 7);
  const months: string[] = [];
  let [y, m] = start.split("-").map(Number);
  for (;;) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    months.push(k);
    if (k >= now) break;
    m++; if (m > 12) { m = 1; y++; }
  }
  const today = new Date().toISOString().slice(0, 10);
  return months.map((mo) => {
    const endDate = mo >= now ? today : `${mo}-31`;
    let value = 0, invested = 0;
    const units = new Map<Holding, number>(); // seri birimi cinsinden adet
    for (const t of txs) {
      if (t.date > endDate) break;
      const cash = t.asset === "SWING" || t.asset === "NAKIT";
      const p0 = cash ? 1 : priceAt(t.asset as AssetId, t.date) ?? 1;
      const u = t.usd / p0;
      units.set(t.asset, (units.get(t.asset) ?? 0) + (t.side === "buy" ? u : -u));
      invested += t.side === "buy" ? t.usd : -t.usd;
    }
    for (const [h, u] of units) value += u * (h === "SWING" || h === "NAKIT" ? 1 : priceAt(h as AssetId, endDate) ?? 0);
    return { month: mo, value: Math.max(0, value), invested };
  });
}
