/**
 * Panelin /api uçları — Web standardı Request/Response ile yazıldı; hem yerel sunucu
 * (web/server.ts) hem de Netlify fonksiyonu (netlify/functions/api.ts) bunu kullanır.
 *
 * Portföy sunucuda SAKLANMAZ: her kullanıcının işlemleri kendi tarayıcısında durur ve
 * hesaplama için isteğin gövdesinde gönderilir. Böylece aynı adresi kullanan iki kişi
 * birbirinin portföyünü göremez.
 */
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { ASSET_IDS, type AssetId, type SwingStrategyId } from "./config.ts";
import { loadAsset } from "./data/load.ts";
import { ROOT, env } from "./env.ts";
import { atr, donchian, sma } from "./engine/indicators.ts";
import { runSwing, loadUniverse, type Universe } from "./pipeline.ts";
import { buildCalendar, type CalendarPayload } from "./calendar.ts";
import { buildBacktest } from "./report/backtest.ts";
import { currentAllocation, type AllocationPayload } from "./allocation.ts";
import { executeOrder } from "./live/orders.ts";
import { APP_VERSION } from "./version.ts";
import { fetchQuotes, type Quote } from "./data/quotes.ts";
import { PORTFOLIO_FILE, history, makeTx, readTxs, sanitizeTxs, valuate, type Tx, type TxInput } from "./portfolio.ts";
import { getNews } from "./news.ts";
import { getPulse } from "./pulse.ts";
import { AI_MODEL, BRIEF_PROMPT, aiConfigured, aiErrorMessage, runClaude } from "./ai.ts";

const OUT = join(ROOT, "out");
/** Netlify/Lambda gibi sunucusuz ortamda mıyız (dosya sistemi kalıcı değil, canlı emir kapalı)? */
const SERVERLESS = !!process.env.LAMBDA_TASK_ROOT;

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const json = (code: number, data: unknown) => new Response(JSON.stringify(data), { status: code, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function readJson<T>(req: Request): Promise<T> {
  const text = await req.text();
  if (text.length > 2e6) throw new Error("çok büyük");
  return JSON.parse(text || "{}") as T;
}

// Takvim: veri önbelleği 12 saatte bir tazelenir; ay kapanınca yeni ay otomatik eklenir.
let calCache: { at: number; data: CalendarPayload } | undefined;
async function calendar(): Promise<CalendarPayload> {
  if (!calCache || Date.now() - calCache.at > 3_600_000) calCache = { at: Date.now(), data: await buildCalendar() };
  return calCache.data;
}

// Evren (fiyat verisi), dağılım ve backtest bellekte tutulur. Veri önbelleği 12 saatte bir
// kendiliğinden tazelenir; /api/refresh verileri hemen yeniden indirip her şeyi yeniden hesaplar.
interface State { at: number; universe: Universe; allocation: AllocationPayload; backtest: Record<string, unknown> }
let state: State | undefined;
let building: Promise<State> | undefined;
let lastForced = 0;

async function build(refresh: boolean): Promise<State> {
  const universe = await loadUniverse({ refresh });
  const allocation = currentAllocation(universe);
  const backtest = buildBacktest(universe).json;
  return { at: Date.now(), universe, allocation, backtest };
}

export async function getState(opts: { refresh?: boolean } = {}): Promise<State> {
  const stale = !state || Date.now() - state.at > 3_600_000;
  if (!building && (stale || opts.refresh)) {
    building = build(!!opts.refresh).finally(() => (building = undefined));
  }
  if (building && (stale || opts.refresh)) state = await building;
  return state!;
}

async function quotes(force = false): Promise<Record<string, Quote>> {
  const st = await getState();
  // Aynı birimdeki son kapanışlar yedek fiyat olarak (altın hariç: seri GLD ETF, portföy XAU onsu)
  const fb: Record<string, { price: number; time: string }> = {};
  for (const id of ["SPY", "QQQ", "BIST", "BTC", "ETH", "DBC"] as const) {
    const b = st.universe.bars[id];
    fb[id] = { price: b[b.length - 1].close, time: b[b.length - 1].date };
  }
  return fetchQuotes(fb, force);
}

/** Belirli bir tarihteki fiyat (portföy birimiyle). Bugün/gelecek için anlık fiyat. */
async function priceOn(asset: string, date: string | undefined): Promise<number | undefined> {
  const q = await quotes();
  const today = new Date().toISOString().slice(0, 10);
  if (!date || date >= today || !(asset in q)) return q[asset]?.price;
  const bars = (await getState()).universe.bars[asset as keyof Universe["bars"]];
  if (!bars?.length) return q[asset]?.price;
  const on = [...bars].reverse().find((b) => b.date <= date)?.close;
  if (!on) return undefined;
  // Altın: seri GLD ETF, portföy XAU onsu — oranla ölçekle
  if (asset === "GLD") return q.GLD.price * (on / bars[bars.length - 1].close);
  return on;
}

async function portfolioPayload(txs: Tx[], force = false) {
  const q = await quotes(force);
  const st = await getState();
  const valuation = valuate(txs, q);
  const hist = history(txs, st.universe.bars);
  // Son (içinde bulunulan) ayın noktası anlık fiyatlarla hesaplanan değerle aynı olsun
  if (hist.length) hist[hist.length - 1].value = valuation.totals.value;
  return { version: APP_VERSION, transactions: txs.slice().reverse(), valuation, quotes: q, history: hist };
}

/** AI uçları: AI_ACCESS_CODE tanımlıysa yalnızca kodu bilenler kullanabilir (API ücreti sizden kesilir). */
function aiAllowed(req: Request): boolean {
  const code = env("AI_ACCESS_CODE");
  if (!code) return true;
  const given = req.headers.get("x-ai-code") ?? "";
  return !!given && safeEqual(given, code);
}

interface AiBody { strategy?: string; webSearch?: boolean; question?: string; transactions?: unknown; history?: { role: "user" | "assistant"; content: string }[] }

/** NDJSON akışı: her satır {t:"text"|"status"|"done"|"error", ...} */
function streamAi(prompt: string, body: AiBody): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (o: unknown) => ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        send({ t: "status", v: "Bağlam hazırlanıyor (piyasa, haberler, portföy)…" });
        const [pulse, news, st] = await Promise.all([getPulse().catch(() => undefined), getNews().catch(() => undefined), getState()]);
        const txs = sanitizeTxs(body.transactions);
        const portfolio = txs.length ? valuate(txs, (await quotes()) as never) : undefined;
        send({ t: "status", v: `Claude (${AI_MODEL}) düşünüyor…` });
        const meta = await runClaude(prompt, { pulse, news: news?.items.slice(0, 30), allocation: st.allocation, strategy: body.strategy, portfolio }, {
          text: (c) => send({ t: "text", v: c }),
          status: (v) => send({ t: "status", v }),
        }, { webSearch: !!body.webSearch, history: body.history });
        send({ t: "done", meta });
      } catch (e) {
        send({ t: "error", v: aiErrorMessage(e) });
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}

async function route(req: Request, url: URL): Promise<Response | undefined> {
  const p = url.pathname;
  const refresh = url.searchParams.get("refresh") === "1";
  if (p === "/api/health") return json(200, { version: APP_VERSION, features: ["refresh", "backtest", "portfolio", "portfolio-local", "news", "ai"] });
  if (p === "/api/news") return json(200, await getNews(refresh));
  if (p === "/api/pulse") return json(200, await getPulse(refresh));
  if (p === "/api/ai/status") return json(200, { configured: aiConfigured(), model: AI_MODEL, needsCode: !!env("AI_ACCESS_CODE"), codeOk: aiAllowed(req) });
  if ((p === "/api/ai/brief" || p === "/api/ai/ask") && req.method === "POST") {
    if (!aiAllowed(req)) return json(401, { error: "Claude analist için geçerli bir erişim anahtarı gerekli.", needsCode: true });
    let b: AiBody;
    try { b = await readJson<AiBody>(req); } catch { return json(400, { error: "Geçersiz JSON" }); }
    if (p === "/api/ai/brief") return streamAi(BRIEF_PROMPT, b);
    const q = (b.question ?? "").trim().slice(0, 2000);
    if (!q) return json(400, { error: "Soru boş" });
    const hist = (b.history ?? []).filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string").map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
    return streamAi(q, { ...b, history: hist });
  }
  if (p === "/api/quotes") return json(200, await quotes(refresh));
  if (p === "/api/price") return json(200, { price: (await priceOn(url.searchParams.get("asset") ?? "", url.searchParams.get("date") ?? undefined)) ?? null });
  if (p === "/api/portfolio" && req.method === "POST") {
    // Gövde: { transactions: cihazdaki işlemler, add?: eklenecek yeni işlemler }. Yanıt güncel listeyi döner; tarayıcı kaydeder.
    let input: { transactions?: unknown; add?: TxInput[]; refresh?: boolean };
    try { input = await readJson(req); } catch { return json(400, { error: "Geçersiz JSON" }); }
    const txs = sanitizeTxs(input.transactions);
    try {
      for (const t of (input.add ?? []).slice(0, 500)) txs.push(makeTx(t, (await priceOn(t.asset, t.date)) ?? (await quotes())[t.asset]?.price));
    } catch (e) {
      return json(400, { error: (e as Error).message });
    }
    return json(200, await portfolioPayload(sanitizeTxs(txs), !!input.refresh));
  }
  if (p === "/api/portfolio/legacy") {
    // Eski sürüm portföyü sunucudaki data/portfoy.json'da tutuyordu; yerel kurulumda bir kez tarayıcıya taşınır.
    return json(200, { transactions: !SERVERLESS && existsSync(PORTFOLIO_FILE) ? readTxs() : [] });
  }
  if (p === "/api/allocation" || p === "/api/backtest") {
    const st = await getState();
    return json(200, p === "/api/allocation" ? st.allocation : st.backtest);
  }
  if (p === "/api/refresh" && req.method === "POST") {
    // Veri sağlayıcılarını yormamak için zorla yenileme en fazla 2 dakikada bir
    const force = Date.now() - lastForced > 120_000;
    if (force) lastForced = Date.now();
    const before = state?.allocation;
    const st = await getState({ refresh: force });
    calCache = undefined;
    return json(200, { refreshed: force, at: new Date(st.at).toISOString(), previousSignalMonth: before?.signalMonth, allocation: st.allocation });
  }
  if (p === "/api/takvim") return json(200, await calendar());
  if (p === "/api/bars") {
    const asset = url.searchParams.get("asset") as AssetId;
    const strategy = (url.searchParams.get("strategy") ?? "donchian") as SwingStrategyId;
    if (!ASSET_IDS.includes(asset)) throw new Error("bilinmeyen varlık");
    const bars = await loadAsset(asset);
    const run = runSwing(bars, asset, strategy);
    const c = bars.map((b) => b.close);
    const d55 = donchian(bars, 55);
    return json(200, { bars, sma200: sma(c, 200), upper55: d55.upper, lower55: d55.lower, atr: atr(bars, 14), trades: run.result.trades, stats: run.result.stats, equity: run.result.equity });
  }
  if (p === "/webhook" && req.method === "POST" && !SERVERLESS) {
    // TradingView alarm gövdesi: {"secret":"...","instId":"BTC-USDT-SWAP","side":"buy","usd":200,"stop":80000,"live":false}
    const secret = env("WEBHOOK_SECRET");
    const payload = await readJson<{ secret?: string; instId: string; side: "buy" | "sell"; usd: number; stop?: number; target?: number; reduceOnly?: boolean; live?: boolean }>(req);
    if (!secret || !payload.secret || !safeEqual(payload.secret, secret)) return new Response("yetkisiz", { status: 401 });
    mkdirSync(OUT, { recursive: true });
    const log = (o: unknown) => appendFileSync(join(OUT, "webhook-log.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...(o as object) }) + "\n");
    const { secret: _s, ...rest } = payload;
    try {
      const r = await executeOrder({ instId: payload.instId, side: payload.side, usd: payload.usd, stopLoss: payload.stop, takeProfit: payload.target, reduceOnly: payload.reduceOnly }, payload.live === true);
      log({ payload: rest, sent: r.sent, plan: r.plan, response: r.response });
      return json(200, { sent: r.sent, warnings: r.plan.warnings });
    } catch (err) {
      log({ payload: rest, error: (err as Error).message });
      return new Response((err as Error).message, { status: 400 });
    }
  }
  if (p.startsWith("/api/")) return json(404, { error: `Bilinmeyen uç: ${p}`, version: APP_VERSION });
  return undefined;
}

/** /api ve /webhook isteklerini yanıtlar; bu uçlardan biri değilse undefined döner (statik dosya). */
export async function handleApi(req: Request): Promise<Response | undefined> {
  try {
    return await route(req, new URL(req.url));
  } catch (err) {
    return json(500, { error: (err as Error).message });
  }
}
