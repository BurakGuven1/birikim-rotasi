/**
 * Day-trade setup tarayıcısı — Jake Schincariol'un MIT lisanslı "Day Trader skill" paketindeki
 * kuralların (trader-scanner, trader-entry, trader-exit, trader-timemachine) TypeScript'e
 * taşınmış hâli; kaynak: github.com/Jakeschincariol/day-trader-skill (.claude/skills/trader-*).
 *
 * Paketten aynen alınanlar:
 *  - Günlük kurulumlar kapanışlarla: 20 günlük kapanış zirvesi kırılımı, boğa bayrağı, 20 günlük
 *    ortalamayı geri alma, aşırı satım (RSI14 < 30) ve aşırı satım dönüşü.
 *  - Açılış aralığı kırılımı (ORB): seansın ilk 15 dakikası (üç 5 dakikalık bar); tetik, aralık
 *    sonrası ilk KAPANMIŞ barın aralık tepesinin üstünde kapanması. 15 dk'dan önce ve kapanıştan
 *    30 dk sonra giriş yok; kapanıştan 5 dk önce pozisyon kapatılır.
 *  - Çıkış planı: stop aralık ortası (kuruşa aşağı yuvarlanır), hedef R katı; risk fiyatın
 *    %0,05'inden azsa plan reddedilir.
 *  - Zaman Makinesi: son 60 günün tam seanslarından aynı saat dilimindeki (±2 bar) 5 dakikalık
 *    barlarla 10.000 tekrar; aynı kuralın geçmiş seanslarda gerçekte ne yaptığı; başabaş eşiğine
 *    göre karar cümlesi.
 *
 * Eklemeler: "yaklaşan" kurulumlar (henüz tetiklenmemiş ama yakın), short tarafı (OKX perp için
 * ayna kurallar), günlük kurulumların geçmiş isabet istatistiği ve Yahoo'nun seans saatleriyle
 * BIST ve kripto (UTC günü) seansları. Hiçbir şey emir göndermez.
 */
import { getJson } from "./data/http.ts";

export type Group = "core" | "us" | "crypto" | "tr";
export type Side = "long" | "short";

export const UNIVERSE: { sym: string; name: string; group: Group }[] = [
  { sym: "SPY", name: "S&P 500 ETF", group: "core" },
  { sym: "QQQ", name: "Nasdaq 100 ETF", group: "core" },
  { sym: "GLD", name: "Altın ETF", group: "core" },
  { sym: "DBC", name: "Emtia ETF", group: "core" },
  { sym: "XU100.IS", name: "BIST 100", group: "core" },
  { sym: "BTC-USD", name: "Bitcoin", group: "core" },
  { sym: "ETH-USD", name: "Ethereum", group: "core" },
  ...["AAPL Apple", "MSFT Microsoft", "NVDA Nvidia", "AMZN Amazon", "GOOGL Alphabet", "META Meta", "TSLA Tesla", "AVGO Broadcom", "AMD AMD", "NFLX Netflix", "COST Costco", "JPM JPMorgan", "V Visa", "MA Mastercard", "UNH UnitedHealth", "XOM Exxon", "LLY Eli Lilly", "WMT Walmart", "ORCL Oracle", "CRM Salesforce", "ADBE Adobe", "INTC Intel", "MU Micron", "PLTR Palantir", "COIN Coinbase", "MSTR Strategy", "UBER Uber", "BA Boeing", "DIS Disney", "KO Coca-Cola", "BAC Bank of America", "GS Goldman Sachs", "CAT Caterpillar", "HD Home Depot", "QCOM Qualcomm", "ARM Arm", "SHOP Shopify", "SMCI Super Micro", "HOOD Robinhood", "NKE Nike"]
    .map((s) => ({ sym: s.split(" ")[0], name: s.slice(s.indexOf(" ") + 1), group: "us" as const })),
  ...["SOL-USD Solana", "XRP-USD XRP", "BNB-USD BNB", "DOGE-USD Dogecoin", "ADA-USD Cardano", "AVAX-USD Avalanche", "LINK-USD Chainlink", "LTC-USD Litecoin", "DOT-USD Polkadot", "SUI20947-USD Sui"]
    .map((s) => ({ sym: s.split(" ")[0], name: s.slice(s.indexOf(" ") + 1), group: "crypto" as const })),
  ...["THYAO.IS THY", "ASELS.IS Aselsan", "GARAN.IS Garanti BBVA", "KCHOL.IS Koç Holding", "BIMAS.IS BİM", "TUPRS.IS Tüpraş", "AKBNK.IS Akbank", "SISE.IS Şişecam"]
    .map((s) => ({ sym: s.split(" ")[0], name: s.slice(s.indexOf(" ") + 1), group: "tr" as const })),
];

export const GROUP_NAMES: Record<Group, string> = { core: "Planımızdaki varlıklar", us: "ABD büyük hisseler", crypto: "Kripto (OKX'te spot/perp)", tr: "BIST hisseleri" };

// ------------------------------------------------------------------ veri

export interface Series {
  t: number[]; // saniye
  o: number[]; h: number[]; l: number[]; c: number[]; v: number[];
  periods: { start: number; end: number }[];
  current: { start: number; end: number };
  gmtoffset: number;
  price: number;
}

interface ChartResp {
  chart: {
    result: {
      meta: {
        regularMarketPrice?: number; gmtoffset?: number;
        currentTradingPeriod?: { regular: { start: number; end: number } };
        tradingPeriods?: { start: number; end: number }[][] | Record<string, unknown>;
      };
      timestamp?: number[];
      indicators: { quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[] };
    }[] | null;
  };
}

export async function yahooChart(sym: string, range: string, interval: string): Promise<Series> {
  const path = `/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&includePrePost=false`;
  let j: ChartResp | undefined;
  let err: unknown;
  for (const host of ["https://query2.finance.yahoo.com", "https://query1.finance.yahoo.com"]) {
    try { j = await getJson<ChartResp>(host + path); break; } catch (e) { err = e; }
  }
  const r = j?.chart.result?.[0];
  if (!r) throw err instanceof Error ? err : new Error(`Yahoo: ${sym} için veri yok`);
  const q = r.indicators.quote[0];
  const s: Series = { t: [], o: [], h: [], l: [], c: [], v: [], periods: [], current: r.meta.currentTradingPeriod?.regular ?? { start: 0, end: 0 }, gmtoffset: r.meta.gmtoffset ?? 0, price: r.meta.regularMarketPrice ?? NaN };
  (r.timestamp ?? []).forEach((ts, i) => {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if (o == null || h == null || l == null || c == null) return; // boş kapanışlar atılır
    s.t.push(ts); s.o.push(o); s.h.push(h); s.l.push(l); s.c.push(c); s.v.push(q.volume[i] ?? 0);
  });
  const tp = r.meta.tradingPeriods;
  if (Array.isArray(tp)) s.periods = tp.flat().map((p) => ({ start: p.start, end: p.end }));
  return s;
}

/** Sınırlı eşzamanlılıkla eşleme (veri sağlayıcıya nazik olmak için). */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<(R | Error)[]> {
  const out: (R | Error)[] = new Array(items.length);
  let k = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (k < items.length) {
      const i = k++;
      try { out[i] = await fn(items[i]); } catch (e) { out[i] = e as Error; }
    }
  }));
  return out;
}

// ------------------------------------------------------------------ göstergeler (paketle aynı)

/** Wilder RSI, kapanışlarla. */
export function rsi(c: number[], n = 14): number | null {
  if (c.length < n + 1) return null;
  let ag = 0, al = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; ag += Math.max(0, d); al += Math.max(0, -d); }
  ag /= n; al /= n;
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    ag = (ag * (n - 1) + Math.max(0, d)) / n;
    al = (al * (n - 1) + Math.max(0, -d)) / n;
  }
  return al ? 100 - 100 / (1 + ag / al) : 100;
}

export function atr(h: number[], l: number[], c: number[], n = 14): number {
  const tr: number[] = [];
  for (let i = 1; i < c.length; i++) tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  const k = tr.slice(-n);
  return k.reduce((s, x) => s + x, 0) / Math.max(1, k.length);
}

// ------------------------------------------------------------------ günlük kurulumlar

export type DailyKey =
  | "breakout_20d" | "bull_flag" | "reclaim_ma20" | "oversold_bounce" | "oversold"
  | "breakdown_20d" | "bear_flag" | "lose_ma20" | "overbought_fade" | "overbought"
  | "near_breakout" | "flag_forming" | "near_reclaim" | "near_oversold"
  | "near_breakdown" | "near_lose_ma20";

export const DAILY_INFO: Record<DailyKey, { side: Side; status: "ready" | "watch"; label: string; rule: string; trigger?: string; fromSkill: boolean }> = {
  breakout_20d: { side: "long", status: "ready", label: "20 günlük zirve kırılımı", rule: "Son kapanış, önceki 20 seansın her kapanışının üstünde.", fromSkill: true },
  bull_flag: { side: "long", status: "ready", label: "Boğa bayrağı", rule: "Son 5 seanstan önceki 10 seansta %10'dan fazla yükseliş, ardından son 5 kapanış %5'lik bir bant içinde.", fromSkill: true },
  reclaim_ma20: { side: "long", status: "ready", label: "20 günlük ortalamayı geri aldı", rule: "Önceki kapanış 20 günlük ortalamanın altındaydı, son kapanış üstünde.", fromSkill: true },
  oversold_bounce: { side: "long", status: "ready", label: "Aşırı satımdan dönüş", rule: "Dün RSI14 30'un altındaydı, bugün yükselişle kapandı.", fromSkill: true },
  oversold: { side: "long", status: "watch", label: "Aşırı satım (dönüş bekleniyor)", rule: "RSI14 30'un altında.", trigger: "Bir sonraki günlük kapanış bugünkünden yüksek olursa \"aşırı satımdan dönüş\" tetiklenir.", fromSkill: true },
  breakdown_20d: { side: "short", status: "ready", label: "20 günlük dip kırılımı", rule: "Son kapanış, önceki 20 seansın her kapanışının altında (zirve kırılımının aynası).", fromSkill: false },
  bear_flag: { side: "short", status: "ready", label: "Ayı bayrağı", rule: "Son 5 seanstan önceki 10 seansta %10'dan fazla düşüş, ardından son 5 kapanış %5'lik bir bant içinde.", fromSkill: false },
  lose_ma20: { side: "short", status: "ready", label: "20 günlük ortalamayı kaybetti", rule: "Önceki kapanış 20 günlük ortalamanın üstündeydi, son kapanış altında.", fromSkill: false },
  overbought_fade: { side: "short", status: "ready", label: "Aşırı alımdan dönüş", rule: "Dün RSI14 70'in üstündeydi, bugün düşüşle kapandı.", fromSkill: false },
  overbought: { side: "short", status: "watch", label: "Aşırı alım (dönüş bekleniyor)", rule: "RSI14 70'in üstünde.", trigger: "Bir sonraki günlük kapanış bugünkünden düşük olursa \"aşırı alımdan dönüş\" tetiklenir.", fromSkill: false },
  near_breakout: { side: "long", status: "watch", label: "Zirve kırılımına yakın", rule: "Son kapanış 20 günlük kapanış zirvesinin en fazla %2 altında.", trigger: "Günlük kapanış seviyenin üstünde olursa 20 günlük zirve kırılımı tetiklenir.", fromSkill: false },
  flag_forming: { side: "long", status: "watch", label: "Bayrak şekilleniyor", rule: "Güçlü bir koşunun ardından sıkışma başlamış ama bayrak kuralı henüz tam değil (koşu %7–10 ya da bant %5–7).", trigger: "Koşu %10'u, son 5 kapanışın bandı %5'in altını sağlarsa boğa bayrağı olur.", fromSkill: false },
  near_reclaim: { side: "long", status: "watch", label: "Ortalamayı geri almaya yakın", rule: "Son kapanış 20 günlük ortalamanın en fazla %1,5 altında.", trigger: "Günlük kapanış ortalamanın üstünde olursa tetiklenir.", fromSkill: false },
  near_oversold: { side: "long", status: "watch", label: "Aşırı satıma yaklaşıyor", rule: "RSI14 30–35 arasında ve düşüyor.", trigger: "RSI 30'un altına inip sonra yükselişle kapanış gelirse dönüş kurulumu oluşur.", fromSkill: false },
  near_breakdown: { side: "short", status: "watch", label: "Dip kırılımına yakın", rule: "Son kapanış 20 günlük kapanış dibinin en fazla %2 üstünde.", trigger: "Günlük kapanış seviyenin altında olursa 20 günlük dip kırılımı tetiklenir.", fromSkill: false },
  near_lose_ma20: { side: "short", status: "watch", label: "Ortalamayı kaybetmeye yakın", rule: "Son kapanış 20 günlük ortalamanın en fazla %1,5 üstünde ve dün de üstündeydi; ortalamaya doğru düşüyor.", trigger: "Günlük kapanış ortalamanın altında olursa tetiklenir.", fromSkill: false },
};

export interface DailyNums { rsi: number | null; rsiPrev: number | null; high20: number; low20: number; ma20: number; run: number; range5: number }

/** closes en eskiden yeniye, en az 30 — paketteki find_setups + ayna ve "yaklaşan" kurallar. */
export function findDailySetups(c: number[]): { tags: DailyKey[]; nums: DailyNums; levels: Partial<Record<DailyKey, number>> } {
  const n = c.length, last = c[n - 1];
  const prev20 = c.slice(n - 21, n - 1);
  const hi20 = Math.max(...prev20), lo20 = Math.min(...prev20);
  const ma20 = c.slice(n - 20).reduce((s, x) => s + x, 0) / 20;
  const ma20Prev = prev20.reduce((s, x) => s + x, 0) / 20;
  const run = c[n - 6] / c[n - 16] - 1;
  const last5 = c.slice(n - 5);
  const rng5 = (Math.max(...last5) - Math.min(...last5)) / last;
  const r = rsi(c), rp = rsi(c.slice(0, -1));
  const tags: DailyKey[] = [];
  const levels: Partial<Record<DailyKey, number>> = {};
  // paketin beş kuralı
  if (last > hi20) tags.push("breakout_20d");
  if (run > 0.1 && rng5 < 0.05) tags.push("bull_flag");
  if (c[n - 2] < ma20Prev && last > ma20) tags.push("reclaim_ma20");
  if (r !== null && r < 30) tags.push("oversold");
  if (rp !== null && rp < 30 && last > c[n - 2]) tags.push("oversold_bounce");
  // short aynaları
  if (last < lo20) tags.push("breakdown_20d");
  if (run < -0.1 && rng5 < 0.05) tags.push("bear_flag");
  if (c[n - 2] > ma20Prev && last < ma20) tags.push("lose_ma20");
  if (r !== null && r > 70) tags.push("overbought");
  if (rp !== null && rp > 70 && last < c[n - 2]) tags.push("overbought_fade");
  // yaklaşanlar (henüz tetiklenmemiş)
  if (last <= hi20 && hi20 / last - 1 <= 0.02) { tags.push("near_breakout"); levels.near_breakout = hi20; }
  if (!tags.includes("bull_flag") && ((run > 0.1 && rng5 < 0.07) || (run > 0.07 && rng5 < 0.05))) tags.push("flag_forming");
  if (last < ma20 && ma20 / last - 1 <= 0.015 && !tags.includes("lose_ma20")) { tags.push("near_reclaim"); levels.near_reclaim = ma20; }
  if (r !== null && rp !== null && r >= 30 && r < 35 && r < rp) tags.push("near_oversold");
  if (last >= lo20 && last / lo20 - 1 <= 0.02) { tags.push("near_breakdown"); levels.near_breakdown = lo20; }
  if (last > ma20 && last / ma20 - 1 <= 0.015 && c[n - 2] > ma20Prev && last < c[n - 2] && !tags.includes("reclaim_ma20")) { tags.push("near_lose_ma20"); levels.near_lose_ma20 = ma20; }
  return { tags, nums: { rsi: r, rsiPrev: rp, high20: hi20, low20: lo20, ma20, run, range5: rng5 }, levels };
}

/** Günlük kurulumun geçmişte ne yaptığı: giriş kapanışta, stop 1,5×ATR, hedef 2R, en çok 20 seans. */
export function dailyHistory(s: { h: number[]; l: number[]; c: number[] }, key: DailyKey, until: number, stopAtr = 1.5, targetR = 2, hold = 20) {
  const side = DAILY_INFO[key].side;
  let n = 0, win = 0, loss = 0, open = 0, sumR = 0;
  for (let i = 30; i < until - 1; i++) {
    if (!findDailySetups(s.c.slice(0, i + 1)).tags.includes(key)) continue;
    const e = s.c[i];
    const risk = stopAtr * atr(s.h.slice(0, i + 1), s.l.slice(0, i + 1), s.c.slice(0, i + 1));
    if (!(risk > 0)) continue;
    const stop = side === "long" ? e - risk : e + risk, target = side === "long" ? e + targetR * risk : e - targetR * risk;
    n++;
    let done = false;
    for (let j = i + 1; j <= Math.min(until - 1, i + hold); j++) {
      const hitStop = side === "long" ? s.l[j] <= stop : s.h[j] >= stop;
      const hitTgt = side === "long" ? s.h[j] >= target : s.l[j] <= target;
      if (hitStop) { loss++; sumR -= 1; done = true; break; } // aynı gün ikisi de: stop sayılır
      if (hitTgt) { win++; sumR += targetR; done = true; break; }
    }
    if (!done) {
      open++;
      const j = Math.min(until - 1, i + hold);
      sumR += ((side === "long" ? 1 : -1) * (s.c[j] - e)) / risk;
    }
    i += 2; // aynı kurulumun art arda günlerini tek olay say
  }
  return { n, win, loss, open, avgR: n ? sumR / n : 0, targetR, stopAtr, hold, verdict: verdict(win, loss, targetR, n) };
}

/** Paketin karar cümlesi: yalnız bir tarafa değenlerde hedef payı, başabaş 1/(1+R) ile kıyaslanır. */
export function verdict(win: number, loss: number, R: number, total: number): { text: string; tone: "pos" | "neg" | "neutral" } {
  const decided = win + loss;
  if (total < 5 || decided < 3) return { text: "Karar için yeterli örnek yok.", tone: "neutral" };
  const share = (win / decided) * 100, be = 100 / (1 + R), d = share - be;
  const coin = R === 1 ? "Yazı tura gibi" : "Başabaşa yakın";
  if (Math.abs(d) < 5) return { text: `${coin}: bir tarafa değenlerde hedefe giden pay %${share.toFixed(0)} (başabaş %${be.toFixed(0)}).`, tone: "neutral" };
  const dir = d > 0 ? "hedefe" : "stopa";
  return { text: `${Math.abs(d) >= 15 ? "Belirgin şekilde" : "Hafifçe"} ${dir} eğilimli: bir tarafa değenlerde hedefe giden pay %${share.toFixed(0)} (başabaş %${be.toFixed(0)}).`, tone: d > 0 ? "pos" : "neg" };
}

/** Plan: stop kuruşa girişten UZAĞA yuvarlanır, hedef yarım yukarı. Risk fiyatın %0,05'inden azsa null. */
export function plan(side: Side, entry: number, stopRaw: number, R: number) {
  const dec = entry >= 1 ? 100 : 1e6;
  const stop = side === "long" ? Math.floor(stopRaw * dec) / dec : Math.ceil(stopRaw * dec) / dec;
  const risk = side === "long" ? entry - stop : stop - entry;
  if (!(risk > 0) || risk < entry * 0.0005) return null;
  const target = Math.round((side === "long" ? entry + R * risk : entry - R * risk) * dec) / dec;
  return { entry, stop, target, risk, riskPct: risk / entry, R };
}

export interface DailyHit {
  sym: string; name: string; group: Group; key: DailyKey; side: Side; status: "ready" | "watch";
  date: string; close: number; level?: number; distPct?: number;
  plan: ReturnType<typeof plan>;
  history?: ReturnType<typeof dailyHistory>;
}

/** Bugünün tamamlanmamış günlük barını at (seans bitmeden). */
function completeDaily(s: Series, nowSec: number) {
  let n = s.t.length;
  if (n && s.t[n - 1] >= s.current.start - 3600 && nowSec < s.current.end) n--;
  return { t: s.t.slice(0, n), h: s.h.slice(0, n), l: s.l.slice(0, n), c: s.c.slice(0, n) };
}

export function scanDaily(sym: string, name: string, group: Group, s: Series, nowSec: number): DailyHit[] {
  const d = completeDaily(s, nowSec);
  if (d.c.length < 60) return [];
  const { tags, levels } = findDailySetups(d.c);
  const last = d.c[d.c.length - 1];
  const a = atr(d.h, d.l, d.c);
  const date = new Date((d.t[d.t.length - 1] + s.gmtoffset) * 1000).toISOString().slice(0, 10);
  return tags.map((key) => {
    const info = DAILY_INFO[key];
    const level = levels[key];
    const entry = info.status === "ready" ? last : level ?? last;
    const stopRaw = info.side === "long" ? entry - 1.5 * a : entry + 1.5 * a;
    return {
      sym, name, group, key, side: info.side, status: info.status, date, close: last,
      level, distPct: level ? level / last - 1 : undefined,
      plan: plan(info.side, entry, stopRaw, 2),
      history: dailyHistory(d, key, d.c.length),
    };
  });
}

// ------------------------------------------------------------------ açılış aralığı kırılımı (ORB)

const BAR = 300; // 5 dakika, saniye

export interface OrbState {
  sym: string; name: string; group: Group;
  status: "closed" | "forming" | "waiting" | "triggered" | "expired" | "nodata";
  side?: Side;
  session?: { start: number; end: number; noEntryAfter: number; flatBy: number };
  orHigh?: number; orLow?: number; last?: number; lastBarClose?: number;
  distHigh?: number; distLow?: number;
  trigger?: { at: number; price: number; barIndex: number; pctOver: number; volX: number; barsAgo: number };
  plan1R?: ReturnType<typeof plan>; plan2R?: ReturnType<typeof plan>;
  after?: "target1R" | "target2R" | "stop" | "open";
  /** Aynı seansta sonradan ters yönde de kırılım olduysa */
  other?: { side: Side; at: number; price: number };
  bars?: [number, number, number, number, number][];
  note?: string;
  /** Seans kapandı: gösterilen durum son seansa ait */
  ended?: boolean;
  nextOpen?: number;
}

interface Bar5 { t: number; o: number; h: number; l: number; c: number; v: number }

/** Bir seansın ızgaradaki, kesimde tamamlanmış 5 dakikalık barları. */
export function sessionBars(s: { t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] }, start: number, end: number, cutoff: number): Bar5[] {
  const out = new Map<number, Bar5>();
  for (let i = 0; i < s.t.length; i++) {
    const t = s.t[i];
    if (t < start || t >= end || (t - start) % BAR !== 0) continue; // başka gün ya da ızgara dışı canlı tik
    if (t + BAR > cutoff) continue; // henüz kapanmadı
    out.set(t, { t, o: s.o[i], h: s.h[i], l: s.l[i], c: s.c[i], v: s.v[i] });
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}

/**
 * ORB durumu. nRange: aralık bar sayısı (15 dk = 3). Tetik long için aralık tepesinin, short için
 * aralık dibinin ötesinde KAPANAN ilk bar. Giriş penceresi: aralık bitişi … kapanış − 30 dk.
 */
export function orbState(bars: Bar5[], sess: { start: number; end: number }, now: number, nRange = 3): Omit<OrbState, "sym" | "name" | "group"> {
  const noEntryAfter = sess.end - 30 * 60, flatBy = sess.end - 5 * 60;
  const session = { ...sess, noEntryAfter, flatBy };
  if (now < sess.start) return { status: "closed", session, note: "Seans henüz açılmadı." };
  if (bars.length < nRange || bars[0].t !== sess.start) return { status: now < sess.start + nRange * BAR + BAR ? "forming" : "nodata", session, note: now < sess.start + nRange * BAR + BAR ? "Açılış aralığı oluşuyor." : "Seansın ilk barları eksik." };
  const rng = bars.slice(0, nRange);
  const oh = Math.max(...rng.map((b) => b.h)), ol = Math.min(...rng.map((b) => b.l));
  const volAvg = rng.reduce((s, b) => s + b.v, 0) / nRange;
  const last = bars[bars.length - 1];
  const base = { session, orHigh: oh, orLow: ol, last: last.c, lastBarClose: last.t + BAR, distHigh: oh / last.c - 1, distLow: ol / last.c - 1, bars: bars.map((b) => [b.t, b.o, b.h, b.l, b.c] as [number, number, number, number, number]) };
  const firstK = (sd: Side) => { for (let k = nRange; k < bars.length; k++) if (sd === "long" ? bars[k].c > oh : bars[k].c < ol) return k; return -1; };
  const kl = firstK("long"), ks = firstK("short");
  const cands = ([["long", kl], ["short", ks]] as [Side, number][]).filter(([, k]) => k >= 0 && bars[k].t + BAR <= noEntryAfter).sort((x, y) => x[1] - y[1]);
  if (cands.length) {
    const [side, k] = cands[0];
    const b = bars[k];
    const at = b.t + BAR;
    const entry = Math.round(b.c * 100) / 100; // fiyat kuruşa
    const mid = (oh + ol) / 2;
    const p1 = plan(side, entry, mid, 1), p2 = plan(side, entry, mid, 2);
    // Tetikten sonra ne oldu? (stop önce kontrol edilir)
    let after: OrbState["after"] = "open";
    if (p1) {
      for (let j = k + 1; j < bars.length; j++) {
        const x = bars[j];
        if (side === "long" ? x.l <= p1.stop : x.h >= p1.stop) { after = "stop"; break; }
        if (p2 && (side === "long" ? x.h >= p2.target : x.l <= p2.target)) { after = "target2R"; break; }
        if (side === "long" ? x.h >= p1.target : x.l <= p1.target) after = "target1R";
      }
    }
    return {
      ...base, status: "triggered", side,
      trigger: { at, price: entry, barIndex: k, pctOver: side === "long" ? b.c / oh - 1 : b.c / ol - 1, volX: volAvg ? b.v / volAvg : 0, barsAgo: bars.length - 1 - k },
      plan1R: p1, plan2R: p2, after,
      other: cands[1] ? { side: cands[1][0], at: bars[cands[1][1]].t + BAR, price: Math.round(bars[cands[1][1]].c * 100) / 100 } : undefined,
    };
  }
  if (now >= noEntryAfter) return { ...base, status: "expired", note: "Giriş penceresi kapandı (kapanışa 30 dk'dan az)." };
  return { ...base, status: "waiting" };
}

/**
 * Yahoo'nun seans listesinden şu anki ya da en son seansı seçer. Seans başı, ilk barın
 * zamanına hizalanır (BIST'te seans 09:50'de açılır, Yahoo'nun ilk 5 dakikalık barı 09:55–10:15 arası gelir).
 */
export function pickSession(s: Series, now: number) {
  const ps = s.periods.length ? s.periods : [s.current];
  const p = ps.find((x) => now >= x.start && now < x.end) ?? ps.filter((x) => x.start <= now).at(-1) ?? s.current;
  return alignSession(s, p);
}

export function alignSession(s: { t: number[] }, p: { start: number; end: number }) {
  const first = s.t.find((t) => t >= p.start && t < p.start + 30 * 60);
  return { start: first ?? p.start, end: p.end };
}

/** Geçmiş havuz için seans: en çok %2 eksik bar varsa eksikler önceki kapanışta düz bar ile doldurulur. */
export function fullSession(s: Series, p: { start: number; end: number }): Bar5[] | null {
  const a = alignSession(s, p);
  const n = Math.ceil((a.end - a.start) / BAR);
  const got = new Map(sessionBars(s, a.start, a.end, a.end).map((b) => [b.t, b]));
  if (!got.has(a.start) || got.size < n * 0.98) return null;
  const out: Bar5[] = [];
  for (let k = 0; k < n; k++) {
    const t = a.start + k * BAR;
    const b = got.get(t);
    if (b) out.push(b);
    else { const c = out[out.length - 1].c; out.push({ t, o: c, h: c, l: c, c, v: 0 }); }
  }
  return out;
}

// ------------------------------------------------------------------ Zaman Makinesi

/** Deterministik RNG (mulberry32): aynı tohum, aynı sonuç. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TmResult {
  sym: string; side: Side; entry: number; stop: number; target: number; R: number; entryBar: number; barsLeft: number;
  seed: number; runs: number; sessions: number;
  targetFirst: number; stopFirst: number; neither: number; green: number; avgR: number;
  closeP5: number; closeP50: number; closeP95: number;
  fan: { p10: number[]; p50: number[]; p90: number[] };
  history: { fired: number; target: number; stop: number; neither: number; avgR: number };
  verdict: { text: string; tone: "pos" | "neg" | "neutral" };
  extra: string[];
  hypothetical: boolean;
}

/**
 * Paketteki Zaman Makinesi: yalnız TAM seanslar havuza girer; her bar önceki kapanışa oranlanır;
 * her tekrar için kalan her bar, aynı saat dilimindeki (±2) rastgele bir geçmiş barla, güncel
 * fiyata ölçeklenerek üretilir. Stop önce kontrol edilir; ikisine birden değen bar stop sayılır.
 */
export function timeMachine(pastSessions: Bar5[][], plan0: { side: Side; entry: number; stop: number; target: number; R: number; entryBar: number; nBars: number }, runs = 10_000, seed = 19) {
  const { side, entry, stop, target, R, entryBar, nBars } = plan0;
  const risk = Math.abs(entry - stop);
  // Oranlar: [slot][oturum] -> [o,h,l,c] / önceki kapanış
  const ratios: number[][][] = Array.from({ length: nBars }, () => []);
  for (const bs of pastSessions) for (let k = 1; k < nBars; k++) { const p = bs[k - 1].c, b = bs[k]; ratios[k].push([b.o / p, b.h / p, b.l / p, b.c / p]); }
  const rand = rng(seed);
  const pick = (k: number) => { const pool = ratios[Math.min(nBars - 1, Math.max(1, k + Math.floor(rand() * 5) - 2))]; return pool[Math.floor(rand() * pool.length)]; };
  let tf = 0, sf = 0, nf = 0, gr = 0, sumR = 0;
  const closes: number[] = [];
  const rT = Math.abs(target - entry) / risk;
  for (let r = 0; r < runs; r++) {
    let price = entry, res = 0;
    for (let k = entryBar + 1; k < nBars; k++) {
      const x = pick(k);
      const h = price * x[1], l = price * x[2];
      if (res === 0) {
        if (side === "long" ? l <= stop : h >= stop) res = -1; // aynı barda ikisi: stop (temkinli)
        else if (side === "long" ? h >= target : l <= target) res = 1;
      }
      price *= x[3];
    }
    closes.push(price); // kapanıştaki fiyat (çıkıştan sonra da yol sürer)
    if (res === 1) { tf++; gr++; sumR += rT; }
    else if (res === -1) { sf++; sumR -= 1; }
    else {
      nf++;
      const rr = ((side === "long" ? 1 : -1) * (price - entry)) / risk;
      sumR += rr;
      if (rr > 0) gr++;
    }
  }
  // Yelpaze: aynı tohumla 2.000 koşulsuz yol (paketteki ikinci çalıştırma)
  const fr = rng(seed);
  const fpick = (k: number) => { const pool = ratios[Math.min(nBars - 1, Math.max(1, k + Math.floor(fr() * 5) - 2))]; return pool[Math.floor(fr() * pool.length)]; };
  const left = nBars - 1 - entryBar;
  const paths: number[][] = Array.from({ length: left + 1 }, () => []);
  for (let r = 0; r < 2000; r++) {
    let price = entry;
    paths[0].push(price);
    for (let k = entryBar + 1; k < nBars; k++) { price *= fpick(k)[3]; paths[k - entryBar].push(price); }
  }
  const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const fan = { p10: [] as number[], p50: [] as number[], p90: [] as number[] };
  for (const col of paths) { if (!col.length) break; fan.p10.push(q(col, 0.1)); fan.p50.push(q(col, 0.5)); fan.p90.push(q(col, 0.9)); }
  return { targetFirst: tf / runs, stopFirst: sf / runs, neither: nf / runs, green: gr / runs, avgR: sumR / runs, closeP5: q(closes, 0.05), closeP50: q(closes, 0.5), closeP95: q(closes, 0.95), fan, seed, runs };
}

/**
 * Paketteki history_replay: her geçmiş tam seansta giriş, aralıktan sonra (kapanışa kadar) aralığın
 * ötesinde kapanan ilk bar; stop aralık ortası, aynı R; önce stop, sonra hedef; yoksa kapanış.
 */
export function orbHistory(pastSessions: Bar5[][], side: Side, R: number, nRange = 3) {
  const long = side === "long";
  let fired = 0, t = 0, s = 0, n = 0, sumR = 0;
  for (const D of pastSessions) {
    const rg = D.slice(0, nRange);
    const oh = Math.max(...rg.map((b) => b.h)), ol = Math.min(...rg.map((b) => b.l));
    let kk = -1;
    for (let i = nRange; i < D.length; i++) if (long ? D[i].c > oh : D[i].c < ol) { kk = i; break; }
    if (kk < 0) continue;
    const p = plan(side, Math.round(D[kk].c * 100) / 100, (oh + ol) / 2, R);
    if (!p) continue;
    fired++;
    let res = 0;
    for (const x of D.slice(kk + 1)) {
      if (long ? x.l <= p.stop : x.h >= p.stop) { res = -1; break; }
      if (long ? x.h >= p.target : x.l <= p.target) { res = 1; break; }
    }
    const cl = D[D.length - 1].c;
    if (res === 1) { t++; sumR += (long ? p.target - p.entry : p.entry - p.target) / p.risk; }
    else if (res === -1) { s++; sumR -= 1; }
    else { n++; sumR += ((long ? 1 : -1) * (cl - p.entry)) / p.risk; }
  }
  return { fired, target: t, stop: s, neither: n, avgR: fired ? sumR / fired : 0 };
}

// ------------------------------------------------------------------ yükler

export interface SetupsPayload {
  generatedAt: string;
  groups: typeof GROUP_NAMES;
  daily: DailyHit[];
  orb: OrbState[];
  scanned: number; failed: string[];
  info: typeof DAILY_INFO;
  source: string;
}

const cache = new Map<string, { at: number; data: unknown }>();
async function cached<T>(key: string, ttl: number, force: boolean, fn: () => Promise<T>): Promise<T> {
  const h = cache.get(key);
  if (!force && h && Date.now() - h.at < ttl) return h.data as T;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
}

export function getSetups(force = false): Promise<SetupsPayload> {
  return cached("setups", 2 * 60_000, force, async () => {
    const now = Math.floor(Date.now() / 1000);
    const failed: string[] = [];
    const daily: DailyHit[] = [];
    const orb: OrbState[] = [];
    const dailyData = await cached("daily-raw", 30 * 60_000, force, () => pool(UNIVERSE, 10, (u) => yahooChart(u.sym, "2y", "1d")));
    const intra = await pool(UNIVERSE, 10, (u) => yahooChart(u.sym, "1d", "5m"));
    UNIVERSE.forEach((u, i) => {
      const d = dailyData[i], x = intra[i];
      if (d instanceof Error) failed.push(u.sym);
      else daily.push(...scanDaily(u.sym, u.name, u.group, d, now));
      if (x instanceof Error) { orb.push({ sym: u.sym, name: u.name, group: u.group, status: "nodata", note: x.message }); return; }
      const sess = pickSession(x, now);
      const bars = sessionBars(x, sess.start, sess.end, Math.min(now, sess.end));
      // Seans bittiyse sonuç "son seans" olarak gösterilir; giriş için geçerli değildir
      orb.push({ sym: u.sym, name: u.name, group: u.group, ...orbState(bars, sess, Math.min(now, sess.end)), ended: now >= sess.end, nextOpen: now >= sess.end && x.current.start > now ? x.current.start : undefined });
    });
    return {
      generatedAt: new Date().toISOString(), groups: GROUP_NAMES, daily, orb, scanned: UNIVERSE.length, failed, info: DAILY_INFO,
      source: "Kurallar: Day Trader skill (Jake Schincariol, MIT) — trader-scanner / entry / exit / timemachine. Veri: Yahoo Finance (ücretsiz, resmî değil, gecikebilir).",
    };
  });
}

/** Tek sembol için Zaman Makinesi. Tetik yoksa aralık sınırında varsayımsal giriş planlanır. */
export function getTimeMachine(sym: string, side: Side, R: number, force = false): Promise<TmResult> {
  return cached(`tm:${sym}:${side}:${R}`, 10 * 60_000, force, async () => {
    const u = UNIVERSE.find((x) => x.sym === sym);
    if (!u) throw new Error("Bilinmeyen sembol");
    const now = Math.floor(Date.now() / 1000);
    const s = await yahooChart(sym, "60d", "5m");
    const sess = pickSession(s, now);
    const nBars = Math.ceil((sess.end - sess.start) / BAR);
    const past: Bar5[][] = [];
    for (const p of s.periods) {
      if (p.start >= sess.start - 60) continue; // bugünkü seans havuza girmez
      const bs = fullSession(s, p);
      if (bs && bs.length === nBars) past.push(bs); // yalnız aynı uzunlukta tam seanslar (yarım günler dışarıda)
    }
    if (past.length < 20) throw new Error(`Havuz için yeterli tam seans yok (${past.length}, en az 20 gerekir).`);
    const bars = sessionBars(s, sess.start, sess.end, Math.min(now, sess.end));
    const st = orbState(bars, sess, now);
    let entry: number, stopRaw: number, entryBar: number, hypothetical = false;
    const own = st.status === "triggered" ? (st.side === side ? { at: st.trigger!.at, price: st.trigger!.price } : st.other?.side === side ? st.other : undefined) : undefined;
    if (own) {
      entry = own.price; entryBar = Math.round((own.at - sess.start) / BAR) - 1;
      stopRaw = (st.orHigh! + st.orLow!) / 2;
    } else {
      // Varsayımsal: aralık sınırında, aralıktan hemen sonraki barda giriş (paketin "--entry" ile önceden planlaması)
      hypothetical = true;
      let oh: number, ol: number;
      if (st.orHigh !== undefined) { oh = st.orHigh; ol = st.orLow!; }
      else { const last = past[past.length - 1]; oh = Math.max(...last.slice(0, 3).map((b) => b.h)); ol = Math.min(...last.slice(0, 3).map((b) => b.l)); }
      entry = Math.round((side === "long" ? oh : ol) * 100) / 100;
      stopRaw = (oh + ol) / 2;
      entryBar = 3;
    }
    const p = plan(side, entry, stopRaw, R);
    if (!p) throw new Error("Plan reddedildi: risk fiyatın %0,05'inden küçük (aralık çok dar).");
    const mc = timeMachine(past, { side, entry: p.entry, stop: p.stop, target: p.target, R, entryBar, nBars });
    const history = orbHistory(past, side, R);
    const v = verdict(Math.round(mc.targetFirst * 1e4), Math.round(mc.stopFirst * 1e4), R, 1e4);
    const extra: string[] = [];
    if (mc.neither > 0.4) extra.push(`Tekrarların %${(mc.neither * 100).toFixed(1)}'i kapanışa kadar iki tarafa da değmedi; bunları kapanış fiyatı belirler.`);
    if ((v.tone === "pos" && mc.avgR < 0) || (v.tone === "neg" && mc.avgR > 0)) extra.push(`Ortalama R (${mc.avgR >= 0 ? "+" : ""}${mc.avgR.toFixed(3)}) eğilimin tersini gösteriyor; fark, hiçbir tarafa değmeyen tekrarlardan geliyor.`);
    return {
      sym, side, entry: p.entry, stop: p.stop, target: p.target, R, entryBar, barsLeft: nBars - 1 - entryBar,
      sessions: past.length, ...mc, history, verdict: v, extra, hypothetical,
    };
  });
}
