/**
 * Haber toplayıcı: ücretsiz RSS kaynaklarından kripto, ABD piyasaları, makro, emtia ve
 * Türkiye haberlerini toplar; varlık etiketi, önem puanı ve basit duygu (yön) ekler,
 * aynı hikâyeyi farklı kaynaklardan gelenleri tek kümede birleştirir.
 */
export type NewsCategory = "crypto" | "us" | "macro" | "commodity" | "tr";
export type Tag = "BTC" | "ETH" | "GLD" | "SPY" | "QQQ" | "BIST" | "DBC" | "MACRO";

interface Feed { id: string; name: string; url: string; category: NewsCategory; weight: number }

const gnews = (q: string, tr = false) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:2d")}&hl=${tr ? "tr" : "en-US"}&gl=${tr ? "TR" : "US"}&ceid=${tr ? "TR:tr" : "US:en"}`;

export const FEEDS: Feed[] = [
  { id: "coindesk", name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", category: "crypto", weight: 1.1 },
  { id: "cointelegraph", name: "Cointelegraph", url: "https://cointelegraph.com/rss", category: "crypto", weight: 1.0 },
  { id: "decrypt", name: "Decrypt", url: "https://decrypt.co/feed", category: "crypto", weight: 0.9 },
  { id: "yahoo-crypto", name: "Yahoo Finance", url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=BTC-USD,ETH-USD&region=US&lang=en-US", category: "crypto", weight: 1.0 },
  { id: "yahoo-us", name: "Yahoo Finance", url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC,%5ENDX,SPY,QQQ&region=US&lang=en-US", category: "us", weight: 1.1 },
  { id: "yahoo-cmd", name: "Yahoo Finance", url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=GC%3DF,CL%3DF,SI%3DF&region=US&lang=en-US", category: "commodity", weight: 1.0 },
  { id: "fed", name: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml", category: "macro", weight: 1.6 },
  { id: "gn-fed", name: "Google News", url: gnews("Federal Reserve interest rates inflation"), category: "macro", weight: 1.0 },
  { id: "gn-markets", name: "Google News", url: gnews("stock market S&P 500 Nasdaq"), category: "us", weight: 0.9 },
  { id: "gn-gold", name: "Google News", url: gnews("gold price"), category: "commodity", weight: 0.9 },
  { id: "gn-oil", name: "Google News", url: gnews("oil prices OPEC"), category: "commodity", weight: 0.8 },
  { id: "gn-btc", name: "Google News", url: gnews("bitcoin ETF crypto market"), category: "crypto", weight: 0.9 },
  { id: "gn-bist", name: "Google News", url: gnews("Borsa İstanbul BIST 100", true), category: "tr", weight: 1.0 },
  { id: "gn-tcmb", name: "Google News", url: gnews("TCMB faiz kararı enflasyon", true), category: "tr", weight: 1.1 },
  { id: "bloomberght", name: "Bloomberg HT", url: "https://www.bloomberght.com/rss", category: "tr", weight: 1.1 },
  { id: "investing-tr", name: "Investing.com TR", url: "https://tr.investing.com/rss/news.rss", category: "tr", weight: 0.9 },
];

export interface NewsItem {
  id: string;
  title: string;
  link: string;
  source: string;
  published: string;
  summary: string;
  category: NewsCategory;
  tags: Tag[];
  importance: number;
  /** -1 düşüş/olumsuz · 0 nötr · 1 yükseliş/olumlu (kaba sözlük tahmini) */
  sentiment: -1 | 0 | 1;
  /** Aynı hikâyeyi veren diğer kaynaklar */
  alsoIn: string[];
  highImpact: string[];
}

// ------------------------------------------------------------------ RSS ayrıştırma
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
const stripTags = (s: string) => decode(decode(s)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const pick = (xml: string, tag: string) => {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1] : "";
};

export interface RawItem { title: string; link: string; published: string; summary: string; source?: string }

export function parseRss(xml: string): RawItem[] {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  return items.map((it) => {
    let link = stripTags(pick(it, "link"));
    if (!link) link = it.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? "";
    const date = stripTags(pick(it, "pubDate") || pick(it, "published") || pick(it, "updated") || pick(it, "dc:date"));
    const t = Date.parse(date);
    return {
      title: stripTags(pick(it, "title")),
      link,
      published: Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString(),
      summary: stripTags(pick(it, "description") || pick(it, "summary") || pick(it, "content:encoded")).slice(0, 400),
      source: stripTags(pick(it, "source")) || undefined,
    };
  }).filter((x) => x.title && x.link);
}

// ------------------------------------------------------------------ zenginleştirme
const TAG_RX: [Tag, RegExp][] = [
  ["BTC", /\b(bitcoin|btc|spot etf|halving|satoshi|microstrategy|strategy inc)\b/i],
  ["ETH", /\b(ethereum|ether|eth|solana|xrp|altcoin|defi|stablecoin|crypto|kripto)\b/i],
  ["GLD", /\b(gold|xau|bullion|altın|ons)\b/i],
  ["SPY", /(s&p|\bspx\b|\bdow\b|wall street|stocks?\b|equities|earnings|\bspy\b)/i],
  ["QQQ", /\b(nasdaq|tech stocks?|nvidia|apple|microsoft|alphabet|amazon|meta|tesla|ai stocks?|semiconductor|qqq)\b/i],
  ["BIST", /(bist|borsa istanbul|xu100|borsa|hisse|türk lirası|\btl\b|dolar\/tl|usd\/try|tcmb|türkiye)/i],
  ["DBC", /\b(oil|crude|brent|wti|opec|commodit|copper|silver|natural gas|petrol|emtia|gümüş|bakır|doğalgaz)\b/i],
  ["MACRO", /\b(fed|fomc|powell|interest rate|rate cut|rate hike|inflation|cpi|pce|jobs report|payroll|unemployment|gdp|recession|treasury|yields?|dollar index|dxy|tariff|ecb|boj|enflasyon|faiz|merkez bankası|büyüme|işsizlik)\b/i],
];
const HIGH_IMPACT: [string, RegExp][] = [
  ["Fed / faiz kararı", /\b(fomc|rate decision|rate cut|rate hike|cuts rates|raises rates|holds rates|faiz kararı|faizi (sabit|indir|artır))/i],
  ["Enflasyon verisi", /\b(cpi|pce|inflation data|inflation report|enflasyon (verisi|rakam))/i],
  ["İstihdam verisi", /\b(nonfarm|payrolls|jobs report|unemployment rate|tarım dışı)/i],
  ["Düzenleme / SEC", /\b(sec\b|regulat|ban(s|ned)?\b|lawsuit|approval|approves|etf (approval|inflows|outflows)|yasak|düzenleme)/i],
  ["Sert fiyat hareketi", /\b(crash|plunge|plummet|soar|surge|tumble|all-time high|record high|rekor|çöktü|sert (düş|yüksel))/i],
  ["Kriz / risk", /\b(hack|exploit|bankrupt|default|insolv|liquidat|war|attack|sanction|recession|crisis|kriz|savaş|iflas)/i],
  ["Politika / seçim", /\b(election|tariff|trump|white house|seçim|gümrük vergisi)/i],
];
/** Liste/tık tuzağı başlıklar (önemi düşürülür) */
const CLICKBAIT = /(no-brainer|i'm buying|should you buy|best (stocks?|etfs?|crypto)|\b\d+ (stocks?|etfs?|cryptos?|reasons)\b|millionaire|motley fool|here's why|could make you|buy and hold forever|\?$)/i;
const POS = /\b(surge|soar|rally|gain|jump|climb|rise|rises|record high|all-time high|bull|beat|upgrade|inflows|yüksel|rekor|artış|kazanç|toparlan)/i;
const NEG = /\b(plunge|crash|tumble|fall|falls|drop|slump|slide|sink|bear|miss|downgrade|outflows|hack|liquidat|düş|geriled|kayıp|çöküş|sert satış)/i;

function words(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 3));
}
function similar(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / Math.max(1, Math.min(a.size, b.size));
}

export function enrich(raw: RawItem & { feed: Feed }, now = Date.now()): NewsItem {
  const text = `${raw.title} ${raw.summary}`;
  const tags = TAG_RX.filter(([, rx]) => rx.test(text)).map(([t]) => t);
  const highImpact = HIGH_IMPACT.filter(([, rx]) => rx.test(raw.title)).map(([n]) => n);
  const pos = POS.test(raw.title), neg = NEG.test(raw.title);
  const ageH = Math.max(0, (now - Date.parse(raw.published)) / 3_600_000);
  const recency = Math.exp(-ageH / 18); // ~18 saatte bir e-kat sönüm
  const bait = CLICKBAIT.test(raw.title) ? 0.45 : 1;
  const importance = bait * raw.feed.weight * (1 + 0.6 * highImpact.length + 0.15 * Math.min(tags.length, 3)) * (0.35 + 0.65 * recency);
  const source = raw.feed.name === "Google News" && raw.source ? raw.source : raw.feed.name;
  const title = raw.feed.name === "Google News" && raw.source ? raw.title.replace(new RegExp(`\\s+-\\s+${raw.source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "") : raw.title;
  // Google News özeti genelde "başlık + kaynak"tır; bilgi taşımıyorsa gösterme
  const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const summary = norm(raw.summary).startsWith(norm(title).slice(0, 40)) ? "" : raw.summary;
  return {
    id: Buffer.from(raw.link).toString("base64url").slice(-24),
    title,
    link: raw.link,
    source,
    published: raw.published,
    summary,
    category: raw.feed.category,
    tags,
    importance,
    sentiment: pos && !neg ? 1 : neg && !pos ? -1 : 0,
    alsoIn: [],
    highImpact,
  };
}

/** Aynı hikâyeyi (başlık benzerliği ≥ 0,6) tek kayıtta birleştirir; çok kaynaklı hikâyelerin önemi artar. */
export function cluster(items: NewsItem[]): NewsItem[] {
  const sorted = [...items].sort((a, b) => b.importance - a.importance);
  const out: { item: NewsItem; w: Set<string> }[] = [];
  for (const it of sorted) {
    const w = words(it.title);
    const hit = out.find((o) => similar(o.w, w) >= 0.6);
    if (hit) {
      if (hit.item.source !== it.source && !hit.item.alsoIn.includes(it.source)) hit.item.alsoIn.push(it.source);
      for (const t of it.tags) if (!hit.item.tags.includes(t)) hit.item.tags.push(t);
    } else out.push({ item: { ...it, alsoIn: [] }, w });
  }
  for (const o of out) o.item.importance *= 1 + 0.35 * Math.min(o.item.alsoIn.length, 4);
  return out.map((o) => o.item).sort((a, b) => b.importance - a.importance);
}

// ------------------------------------------------------------------ toplama
async function fetchFeed(feed: Feed): Promise<(RawItem & { feed: Feed })[]> {
  const res = await fetch(feed.url, {
    headers: { "User-Agent": "Mozilla/5.0 (ozgurluk-rotasi news)", Accept: "application/rss+xml, application/xml, text/xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  return parseRss(xml).slice(0, 40).map((r) => ({ ...r, feed }));
}

export interface NewsPayload {
  generatedAt: string;
  items: NewsItem[];
  sources: { id: string; name: string; category: NewsCategory; ok: boolean; count: number; error?: string }[];
}

let cache: { at: number; data: NewsPayload } | undefined;

export async function getNews(force = false): Promise<NewsPayload> {
  if (!force && cache && Date.now() - cache.at < 10 * 60_000) return cache.data;
  const maxAgeMs = 4 * 86_400_000;
  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const raw: (RawItem & { feed: Feed })[] = [];
  const sources = FEEDS.map((f, i) => {
    const r = results[i];
    if (r.status === "fulfilled") {
      raw.push(...r.value);
      return { id: f.id, name: f.name, category: f.category, ok: true, count: r.value.length };
    }
    return { id: f.id, name: f.name, category: f.category, ok: false, count: 0, error: String((r.reason as Error)?.message ?? r.reason).slice(0, 80) };
  });
  const now = Date.now();
  const items = cluster(raw.filter((r) => now - Date.parse(r.published) < maxAgeMs).map((r) => enrich(r, now))).slice(0, 250);
  const data = { generatedAt: new Date().toISOString(), items, sources };
  // Tüm kaynaklar başarısızsa eski önbelleği koru
  if (items.length || !cache) cache = { at: Date.now(), data };
  return cache.data;
}
