/**
 * Ücretsiz likidasyon ısı haritası, likidasyon haritası (LiqMap) ve open interest uyumsuzluk
 * analizi — OKX'in herkese açık verisiyle (fiyat, open interest, taker hacmi, fonlama,
 * long/short oranı ve gerçekleşen likidasyon emirleri).
 *
 * Model (Coinglass / Kingfisher benzeri tahmin): her mumda open interest artışı yeni açılan
 * pozisyon sayılır; taker alış/satış oranına göre long/short'a bölünür, kaldıraç kademelerine
 * dağıtılır ve her kademenin likidasyon fiyatı hesaplanır. Fiyatın dokunduğu seviyeler
 * "tasfiye oldu" sayılıp silinir; OI düşüşleri kapanan pozisyon olarak orantılı düşülür.
 * Sonuç gerçek pozisyon defteri değil, kamuya açık veriden yapılmış bir tahmindir.
 */
import { getJson } from "./data/http.ts";

export type LiqAsset = "BTC" | "ETH";
export type LiqRange = "3d" | "7d" | "14d" | "30d";

const INST: Record<LiqAsset, { instId: string; family: string; ctVal: number }> = {
  BTC: { instId: "BTC-USDT-SWAP", family: "BTC-USDT", ctVal: 0.01 },
  ETH: { instId: "ETH-USDT-SWAP", family: "ETH-USDT", ctVal: 0.1 },
};

const RANGES: Record<LiqRange, { bar: "1H" | "4H"; bars: number; hours: number }> = {
  "3d": { bar: "1H", bars: 72, hours: 1 },
  "7d": { bar: "1H", bars: 168, hours: 1 },
  "14d": { bar: "1H", bars: 336, hours: 1 },
  "30d": { bar: "4H", bars: 180, hours: 4 },
};

/** Varsayılan kaldıraç dağılımı (yeni pozisyonların kaldıraç kademelerine bölünüşü). */
export const TIERS = [
  { lev: 10, w: 0.3 },
  { lev: 25, w: 0.3 },
  { lev: 50, w: 0.25 },
  { lev: 100, w: 0.15 },
];
/** Bakım teminatı oranı (yaklaşık) */
const MMR = 0.005;

export const liqPrice = (entry: number, lev: number, side: "long" | "short") =>
  side === "long" ? entry * (1 - 1 / lev + MMR) : entry * (1 + 1 / lev - MMR);

interface OkxResp<T> { code: string; msg: string; data: T }

async function okx<T>(path: string): Promise<T> {
  const j = await getJson<OkxResp<T>>(`https://www.okx.com${path}`);
  if (j.code !== "0") throw new Error(`OKX ${path}: ${j.code} ${j.msg}`);
  return j.data;
}

/** Yeniden eskiye sayfalanan OKX zaman serilerini (limit 100) istenen bar sayısına kadar çeker. */
async function paged(path: string, need: number, pageParam: "end" | "after"): Promise<string[][]> {
  const out: string[][] = [];
  let cursor = "";
  for (let i = 0; i < 12 && out.length < need; i++) {
    const rows = await okx<string[][]>(`${path}${cursor ? `&${pageParam}=${cursor}` : ""}`);
    if (!rows.length) break;
    out.push(...rows);
    cursor = rows[rows.length - 1][0];
    if (rows.length < 100) break;
  }
  return out;
}

export interface Bar { t: number; o: number; h: number; l: number; c: number }

export interface Level { price: number; usd: number; side: "long" | "short"; tier: number }

export interface SimResult {
  /** Her bar sonunda açık kalan seviyeler (son bar = şu an) */
  outstanding: Level[];
  /** Her bar için modelin tetiklediği likidasyonlar (USD) */
  triggered: { long: number; short: number }[];
  /** Isı haritası: her bar için fiyat kutularındaki açık likidasyon (USD) */
  heat: Float64Array[];
}

/**
 * Likidasyon seviyesi simülasyonu. bins: ısı haritası fiyat ekseni [lo, hi] n kutu.
 * Saf fonksiyon (test edilebilir).
 */
export function simulate(bars: Bar[], oiUsd: number[], buyShare: number[], bins: { lo: number; hi: number; n: number }): SimResult {
  let levels: Level[] = [];
  const triggered: { long: number; short: number }[] = [];
  const heat: Float64Array[] = [];
  const step = (bins.hi - bins.lo) / bins.n;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    // 1) Bu barın fiyat aralığı açık seviyelere değdiyse likidasyon
    let tl = 0, ts = 0;
    if (i > 0) {
      const keep: Level[] = [];
      for (const lv of levels) {
        if (lv.side === "long" && b.l <= lv.price) tl += lv.usd;
        else if (lv.side === "short" && b.h >= lv.price) ts += lv.usd;
        else keep.push(lv);
      }
      levels = keep;
    }
    triggered.push({ long: tl, short: ts });
    // 2) Open interest değişimi: artış = yeni pozisyon, azalış = kapanış (likidasyonlar düşüldükten sonra)
    if (i > 0) {
      const share = Number.isFinite(buyShare[i]) ? Math.min(0.9, Math.max(0.1, buyShare[i])) : 0.5;
      const d = oiUsd[i] - oiUsd[i - 1];
      if (d > 0) {
        const entry = (b.h + b.l + b.c) / 3;
        TIERS.forEach((tier, k) => {
          levels.push({ price: liqPrice(entry, tier.lev, "long"), usd: d * share * tier.w, side: "long", tier: k });
          levels.push({ price: liqPrice(entry, tier.lev, "short"), usd: d * (1 - share) * tier.w, side: "short", tier: k });
        });
      } else if (d < 0) {
        // Likidasyonlar zaten OI'yi düşürdü; kalan azalış gönüllü kapanış
        const closing = Math.max(0, -d - tl - ts);
        const longTot = levels.reduce((s, x) => s + (x.side === "long" ? x.usd : 0), 0);
        const shortTot = levels.reduce((s, x) => s + (x.side === "short" ? x.usd : 0), 0);
        // Long kapatan satar, short kapatan alır
        const fl = longTot > 0 ? Math.max(0, 1 - (closing * (1 - share)) / longTot) : 1;
        const fs = shortTot > 0 ? Math.max(0, 1 - (closing * share) / shortTot) : 1;
        for (const lv of levels) lv.usd *= lv.side === "long" ? fl : fs;
        levels = levels.filter((x) => x.usd > 1);
      }
    }
    // 3) Isı haritası anlık görüntüsü
    const row = new Float64Array(bins.n);
    for (const lv of levels) {
      const k = Math.floor((lv.price - bins.lo) / step);
      if (k >= 0 && k < bins.n) row[k] += lv.usd;
    }
    heat.push(row);
  }
  return { outstanding: levels, triggered, heat };
}

// ------------------------------------------------------------------ OI uyumsuzluk analizi

export type Regime =
  | "uyumlu-yukselis"
  | "asiri-long"
  | "negatif-short-kapanisi"
  | "ayi-yeni-short"
  | "pozitif-short-birikimi"
  | "pozitif-temizlik"
  | "sikisma"
  | "notr";

export const REGIME_INFO: Record<Regime, { label: string; tone: "pos" | "neg" | "neutral"; text: string }> = {
  "uyumlu-yukselis": { label: "Uyumlu yükseliş", tone: "pos", text: "Fiyat ve OI birlikte artıyor: yükselişi yeni long pozisyonlar taşıyor, trend sağlıklı." },
  "asiri-long": { label: "Negatif uyumsuzluk riski: aşırı long", tone: "neg", text: "Fiyat ve OI artıyor ama fonlama yüksek: long tarafı aşırı kaldıraçlı, ani düşüşte long likidasyon zinciri riski." },
  "negatif-short-kapanisi": { label: "Negatif uyumsuzluk", tone: "neg", text: "Fiyat yükselirken OI düşüyor: yükselişi short kapanışları (short squeeze) taşıyor, yeni alıcı az. Kalıcılığı zayıf." },
  "ayi-yeni-short": { label: "Ayı: yeni short'lar", tone: "neg", text: "Fiyat düşerken OI artıyor ve fonlama pozitif/nötr: düşüşü yeni short'lar sürüyor." },
  "pozitif-short-birikimi": { label: "Pozitif uyumsuzluk: short birikimi", tone: "pos", text: "Fiyat düşerken OI artıyor ve fonlama negatif: short tarafı kalabalık; dönüşte short squeeze yakıtı." },
  "pozitif-temizlik": { label: "Pozitif uyumsuzluk: kaldıraç temizliği", tone: "pos", text: "Fiyat ve OI birlikte düşüyor: long'lar tasfiye oluyor, kaldıraç azalıyor. Dip oluşumu için sağlıklı zemin." },
  sikisma: { label: "Sıkışma: kaldıraç birikiyor", tone: "neutral", text: "Fiyat yatay, OI artıyor: iki tarafta da pozisyon birikiyor; sert bir hareket yaklaşıyor olabilir." },
  notr: { label: "Nötr", tone: "neutral", text: "Fiyat ve OI'de anlamlı bir ayrışma yok." },
};

/** dp/doi: dönem değişimi (oran); fundingAnn: yıllıklandırılmış fonlama; t: eşik */
export function classify(dp: number, doi: number, fundingAnn: number, tp: number, toi: number): Regime {
  const up = dp > tp, down = dp < -tp, oiUp = doi > toi, oiDown = doi < -toi;
  if (up && oiUp) return fundingAnn > 0.3 ? "asiri-long" : "uyumlu-yukselis";
  if (up && oiDown) return "negatif-short-kapanisi";
  if (down && oiUp) return fundingAnn < 0 ? "pozitif-short-birikimi" : "ayi-yeni-short";
  if (down && oiDown) return "pozitif-temizlik";
  if (!up && !down && oiUp) return "sikisma";
  return "notr";
}

// ------------------------------------------------------------------ ana hesap

export interface LiqPayload {
  asset: LiqAsset;
  range: LiqRange;
  bar: string;
  generatedAt: string;
  price: number;
  times: number[];
  candles: [number, number, number, number][];
  oiUsd: number[];
  buyShare: number[];
  heat: { lo: number; hi: number; n: number; max: number; rows: number[][] };
  liqMap: { lo: number; hi: number; n: number; long: number[][]; short: number[][] };
  tiers: number[];
  clusters: { side: "long" | "short"; price: number; usd: number; distPct: number }[];
  totals: { longUsd: number; shortUsd: number };
  triggered: { long: number; short: number }[];
  realized: { ts: number; price: number; usd: number; side: "long" | "short" }[];
  realizedSummary: { hours: number; longUsd: number; shortUsd: number; count: number };
  divergence: {
    windows: { label: string; hours: number; dp: number; doi: number; tp: number; toi: number; regime: Regime }[];
    verdict: Regime;
    timeline: Regime[];
  };
  funding: { current: number; annualized: number; nextTime?: string };
  longShortRatio?: number;
  regimeInfo: typeof REGIME_INFO;
  notes: string[];
}

const cache = new Map<string, { at: number; data: LiqPayload }>();

export async function getLiq(asset: LiqAsset, range: LiqRange, force = false): Promise<LiqPayload> {
  const key = `${asset}:${range}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < 5 * 60_000) return hit.data;

  const { instId, family, ctVal } = INST[asset];
  const R = RANGES[range];
  const need = R.bars + 1;
  const [candleRows, oiRows, takerRows, fundingNow, fundingHist, lsRows, liqPages] = await Promise.all([
    paged(`/api/v5/market/history-candles?instId=${instId}&bar=${R.bar}&limit=100`, need, "after"),
    paged(`/api/v5/rubik/stat/contracts/open-interest-history?instId=${instId}&period=${R.bar}&limit=100`, need, "end"),
    paged(`/api/v5/rubik/stat/taker-volume-contract?instId=${instId}&period=${R.bar}&unit=2&limit=100`, need, "end"),
    okx<{ fundingRate: string; nextFundingTime: string }[]>(`/api/v5/public/funding-rate?instId=${instId}`).catch(() => []),
    okx<{ fundingRate: string; fundingTime: string }[]>(`/api/v5/public/funding-rate-history?instId=${instId}&limit=100`).catch(() => []),
    okx<string[][]>(`/api/v5/rubik/stat/contracts/long-short-account-ratio-contract?instId=${instId}&period=1H&limit=1`).catch(() => []),
    realizedLiquidations(family, ctVal),
  ]);

  // Zamana göre hizala (yalnız üç seride de olan barlar)
  const oiMap = new Map(oiRows.map((r) => [Number(r[0]), Number(r[3])]));
  const tkMap = new Map(takerRows.map((r) => [Number(r[0]), { sell: Number(r[1]), buy: Number(r[2]) }]));
  const bars: Bar[] = [];
  const oiUsd: number[] = [];
  const buyShare: number[] = [];
  for (const r of [...candleRows].reverse()) {
    const t = Number(r[0]);
    const oi = oiMap.get(t);
    if (oi === undefined) continue;
    const tk = tkMap.get(t);
    bars.push({ t, o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]) });
    oiUsd.push(oi);
    buyShare.push(tk && tk.buy + tk.sell > 0 ? tk.buy / (tk.buy + tk.sell) : NaN);
  }
  const win = bars.slice(-R.bars - 1);
  const oiWin = oiUsd.slice(-R.bars - 1);
  const shareWin = buyShare.slice(-R.bars - 1);
  if (win.length < 10) throw new Error("OKX'ten yeterli veri alınamadı");
  const price = win[win.length - 1].c;

  // Isı haritası ekseni: dönemin fiyat aralığı ±%12
  const lo = Math.min(...win.map((b) => b.l)) * 0.88;
  const hi = Math.max(...win.map((b) => b.h)) * 1.12;
  const N = 180;
  const sim = simulate(win, oiWin, shareWin, { lo, hi, n: N });

  // LiqMap: güncel fiyat ±%20, kaldıraç kademesine göre
  const mlo = price * 0.8, mhi = price * 1.2, MN = 120, mstep = (mhi - mlo) / MN;
  const long = TIERS.map(() => new Array<number>(MN).fill(0));
  const short = TIERS.map(() => new Array<number>(MN).fill(0));
  for (const lv of sim.outstanding) {
    const k = Math.floor((lv.price - mlo) / mstep);
    if (k < 0 || k >= MN) continue;
    (lv.side === "long" ? long : short)[lv.tier][k] += lv.usd;
  }

  // En büyük kümeler: ±%1'lik pencerelerde toplam
  const binsAll = new Map<number, { long: number; short: number }>();
  for (const lv of sim.outstanding) {
    const k = Math.round(lv.price / (price * 0.0025)); // %0,25'lik kutu
    const e = binsAll.get(k) ?? { long: 0, short: 0 };
    e[lv.side] += lv.usd;
    binsAll.set(k, e);
  }
  const clusters = [...binsAll.entries()]
    .flatMap(([k, v]) => [
      { side: "long" as const, price: k * price * 0.0025, usd: v.long },
      { side: "short" as const, price: k * price * 0.0025, usd: v.short },
    ])
    .filter((c) => c.usd > 0 && ((c.side === "long" && c.price < price) || (c.side === "short" && c.price > price)))
    .map((c) => ({ ...c, distPct: c.price / price - 1 }))
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 8)
    .sort((a, b) => b.price - a.price);

  // Fonlama
  const fNow = Number(fundingNow[0]?.fundingRate ?? NaN);
  const fAvg = fundingHist.slice(0, 9).reduce((s, f) => s + Number(f.fundingRate), 0) / Math.max(1, Math.min(9, fundingHist.length));
  const fundingAnn = (Number.isFinite(fNow) ? fNow : fAvg) * 3 * 365;

  // OI uyumsuzluğu: farklı pencereler
  const winDefs = [
    { label: "4 saat", hours: 4, tp: 0.004, toi: 0.006 },
    { label: "24 saat", hours: 24, tp: 0.012, toi: 0.015 },
    { label: "3 gün", hours: 72, tp: 0.025, toi: 0.03 },
    { label: "7 gün", hours: 168, tp: 0.04, toi: 0.05 },
  ].filter((w) => w.hours / R.hours <= win.length - 1 && w.hours >= R.hours);
  const windows = winDefs.map((w) => {
    const k = Math.round(w.hours / R.hours);
    const i0 = win.length - 1 - k;
    const dp = price / win[i0].c - 1;
    const doi = oiWin[oiWin.length - 1] / oiWin[i0] - 1;
    return { label: w.label, hours: w.hours, dp, doi, tp: w.tp, toi: w.toi, regime: classify(dp, doi, fundingAnn, w.tp, w.toi) };
  });
  // Karar: 24 saat penceresi ağırlıklı (yoksa en uzun)
  const verdict = (windows.find((w) => w.hours === 24) ?? windows[windows.length - 1])?.regime ?? "notr";
  // Zaman çizelgesi: her bar için geriye dönük 24 saat (4H'de 24 saat = 6 bar)
  const k24 = Math.max(1, Math.round(24 / R.hours));
  const timeline: Regime[] = win.map((b, i) => (i < k24 ? "notr" : classify(b.c / win[i - k24].c - 1, oiWin[i] / oiWin[i - k24] - 1, fundingAnn, 0.012, 0.015)));

  const sinceTs = win[0].t;
  const realized = liqPages.filter((x) => x.ts >= sinceTs);
  const rh = realized.length ? (Date.now() - Math.min(...realized.map((x) => x.ts))) / 3_600_000 : 0;

  const data: LiqPayload = {
    asset,
    range,
    bar: R.bar,
    generatedAt: new Date().toISOString(),
    price,
    times: win.map((b) => b.t),
    candles: win.map((b) => [b.o, b.h, b.l, b.c]),
    oiUsd: oiWin.map((x) => Math.round(x)),
    buyShare: shareWin.map((x) => (Number.isFinite(x) ? +x.toFixed(4) : 0.5)),
    heat: {
      lo,
      hi,
      n: N,
      max: Math.max(...sim.heat.map((r) => Math.max(...r))),
      // Bin değerleri bin USD cinsinden (yanıt boyutunu küçültmek için)
      rows: sim.heat.map((r) => Array.from(r, (v) => Math.round(v / 1000))),
    },
    liqMap: { lo: mlo, hi: mhi, n: MN, long: long.map((r) => r.map(Math.round)), short: short.map((r) => r.map(Math.round)) },
    tiers: TIERS.map((t) => t.lev),
    clusters,
    totals: {
      longUsd: sim.outstanding.filter((x) => x.side === "long").reduce((s, x) => s + x.usd, 0),
      shortUsd: sim.outstanding.filter((x) => x.side === "short").reduce((s, x) => s + x.usd, 0),
    },
    triggered: sim.triggered.map((t) => ({ long: Math.round(t.long), short: Math.round(t.short) })),
    realized,
    realizedSummary: {
      hours: Math.round(rh),
      longUsd: realized.filter((x) => x.side === "long").reduce((s, x) => s + x.usd, 0),
      shortUsd: realized.filter((x) => x.side === "short").reduce((s, x) => s + x.usd, 0),
      count: realized.length,
    },
    divergence: { windows, verdict, timeline },
    funding: { current: fNow, annualized: fundingAnn, nextTime: fundingNow[0] ? new Date(Number(fundingNow[0].nextFundingTime)).toISOString() : undefined },
    longShortRatio: lsRows[0] ? Number(lsRows[0][1]) : undefined,
    regimeInfo: REGIME_INFO,
    notes: [
      "Veri: OKX herkese açık API (fiyat, open interest, taker hacmi, fonlama, long/short oranı, gerçekleşen likidasyonlar). Tutarlar OKX'teki pozisyonlardır; tüm piyasanın bir kesitidir.",
      `Model: yeni OI, taker alış/satış oranına göre long/short'a bölünür ve ${TIERS.map((t) => `${t.lev}x %${t.w * 100}`).join(", ")} kaldıraç dağılımıyla likidasyon seviyelerine çevrilir; fiyatın değdiği seviyeler silinir.`,
      "Dönem başından önce açılmış pozisyonlar görünmez; uzun dönem (14g/30g) daha eksiksiz bir harita verir. Bu bir tahmindir, işlem kararı tek başına buna dayanmamalı.",
    ],
  };
  cache.set(key, { at: Date.now(), data });
  return data;
}

/** OKX gerçekleşen likidasyon emirleri (en yeniden geriye, en fazla ~8 sayfa). */
async function realizedLiquidations(family: string, ctVal: number): Promise<{ ts: number; price: number; usd: number; side: "long" | "short" }[]> {
  const out: { ts: number; price: number; usd: number; side: "long" | "short" }[] = [];
  let after = "";
  try {
    for (let i = 0; i < 8; i++) {
      const d = await okx<{ details: { bkPx: string; sz: string; posSide: string; side: string; ts: string }[] }[]>(
        `/api/v5/public/liquidation-orders?instType=SWAP&instFamily=${family}&state=filled&limit=100${after ? `&after=${after}` : ""}`,
      );
      const det = d[0]?.details ?? [];
      if (!det.length) break;
      for (const x of det) {
        const px = Number(x.bkPx);
        // posSide "long" ya da tek yönlü modda side=sell → long tasfiyesi
        const side: "long" | "short" = x.posSide === "long" || (x.posSide === "net" && x.side === "sell") ? "long" : "short";
        out.push({ ts: Number(x.ts), price: px, usd: Number(x.sz) * ctVal * px, side });
      }
      after = det[det.length - 1].ts;
      if (det.length < 100) break;
    }
  } catch { /* isteğe bağlı */ }
  return out;
}
