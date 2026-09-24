import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { extname, join, normalize } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { ASSET_IDS, type AssetId, type SwingStrategyId } from "../src/config.ts";
import { loadAsset } from "../src/data/load.ts";
import { ROOT, env, loadEnv } from "../src/env.ts";
import { atr, donchian, sma } from "../src/engine/indicators.ts";
import { runSwing } from "../src/pipeline.ts";
import { buildCalendar, type CalendarPayload } from "../src/calendar.ts";
import { loadUniverse, type Universe } from "../src/pipeline.ts";
import { buildBacktest } from "../src/report/backtest.ts";
import { currentAllocation, type AllocationPayload } from "../src/allocation.ts";
import { executeOrder } from "../src/live/orders.ts";
import { APP_VERSION } from "../src/version.ts";
import { fetchQuotes, type Quote } from "../src/data/quotes.ts";
import { history, makeTx, readTxs, valuate, writeTxs, type TxInput } from "../src/portfolio.ts";

loadEnv();
const PORT = Number(process.env.PORT ?? 4173);
const WEB = join(ROOT, "web");
const OUT = join(ROOT, "out");
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".md": "text/markdown; charset=utf-8" };

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e5) reject(new Error("çok büyük"));
    });
    req.on("end", () => resolve(data));
  });
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
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

async function getState(opts: { refresh?: boolean } = {}): Promise<State> {
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
  const q = (await quotes()) as Record<string, Quote>;
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

async function portfolioPayload(force = false) {
  const txs = readTxs();
  const q = await quotes(force);
  const st = await getState();
  const valuation = valuate(txs, q);
  const hist = history(txs, st.universe.bars);
  // Son (içinde bulunulan) ayın noktası anlık fiyatlarla hesaplanan değerle aynı olsun
  if (hist.length) hist[hist.length - 1].value = valuation.totals.value;
  return { version: APP_VERSION, transactions: txs.slice().reverse(), valuation, quotes: q, history: hist };
}

const json = (res: import("node:http").ServerResponse, code: number, data: unknown) => {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    if (url.pathname === "/api/health") return json(res, 200, { version: APP_VERSION, features: ["refresh", "backtest", "portfolio"] });
    if (url.pathname === "/api/quotes") return json(res, 200, await quotes(url.searchParams.get("refresh") === "1"));
    if (url.pathname === "/api/price") return json(res, 200, { price: (await priceOn(url.searchParams.get("asset") ?? "", url.searchParams.get("date") ?? undefined)) ?? null });
    if (url.pathname === "/api/portfolio" && req.method === "GET") return json(res, 200, await portfolioPayload(url.searchParams.get("refresh") === "1"));
    if (url.pathname === "/api/portfolio/tx" && req.method === "POST") {
      let input: TxInput | { transactions: TxInput[] };
      try { input = JSON.parse(await body(req)); } catch { return json(res, 400, { error: "Geçersiz JSON" }); }
      const q = await quotes();
      const list = "transactions" in input ? input.transactions : [input];
      try {
        const txs = readTxs();
        for (const t of list) txs.push(makeTx(t, (await priceOn(t.asset, t.date)) ?? (q as Record<string, Quote>)[t.asset]?.price));
        writeTxs(txs);
      } catch (e) {
        return json(res, 400, { error: (e as Error).message });
      }
      return json(res, 200, await portfolioPayload());
    }
    if (url.pathname === "/api/portfolio/tx" && req.method === "DELETE") {
      const id = url.searchParams.get("id");
      const txs = readTxs();
      const next = txs.filter((t) => t.id !== id);
      if (next.length === txs.length) return json(res, 404, { error: "İşlem bulunamadı" });
      writeTxs(next);
      return json(res, 200, await portfolioPayload());
    }
    if (url.pathname === "/api/allocation" || url.pathname === "/api/backtest") {
      const st = await getState();
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(url.pathname === "/api/allocation" ? st.allocation : st.backtest));
      return;
    }
    if (url.pathname === "/api/refresh" && req.method === "POST") {
      // Veri sağlayıcılarını yormamak için zorla yenileme en fazla 2 dakikada bir
      const force = Date.now() - lastForced > 120_000;
      if (force) lastForced = Date.now();
      const before = state?.allocation;
      const st = await getState({ refresh: force });
      calCache = undefined;
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ refreshed: force, at: new Date(st.at).toISOString(), previousSignalMonth: before?.signalMonth, allocation: st.allocation }));
      return;
    }
    if (url.pathname === "/api/takvim") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(await calendar()));
      return;
    }
    if (url.pathname === "/api/bars") {
      const asset = url.searchParams.get("asset") as AssetId;
      const strategy = (url.searchParams.get("strategy") ?? "donchian") as SwingStrategyId;
      if (!ASSET_IDS.includes(asset)) throw new Error("bilinmeyen varlık");
      const bars = await loadAsset(asset);
      const run = runSwing(bars, asset, strategy);
      const c = bars.map((b) => b.close);
      const s200 = sma(c, 200);
      const d55 = donchian(bars, 55);
      const a = atr(bars, 14);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ bars, sma200: s200, upper55: d55.upper, lower55: d55.lower, atr: a, trades: run.result.trades, stats: run.result.stats, equity: run.result.equity }));
      return;
    }
    if (url.pathname === "/webhook" && req.method === "POST") {
      // TradingView alarm gövdesi: {"secret":"...","instId":"BTC-USDT-SWAP","side":"buy","usd":200,"stop":80000,"live":false}
      const secret = env("WEBHOOK_SECRET");
      const payload = JSON.parse(await body(req)) as { secret?: string; instId: string; side: "buy" | "sell"; usd: number; stop?: number; target?: number; reduceOnly?: boolean; live?: boolean };
      if (!secret || !payload.secret || !safeEqual(payload.secret, secret)) {
        res.writeHead(401).end("yetkisiz");
        return;
      }
      mkdirSync(OUT, { recursive: true });
      const log = (o: unknown) => appendFileSync(join(OUT, "webhook-log.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...(o as object) }) + "\n");
      const { secret: _s, ...rest } = payload;
      try {
        const r = await executeOrder({ instId: payload.instId, side: payload.side, usd: payload.usd, stopLoss: payload.stop, takeProfit: payload.target, reduceOnly: payload.reduceOnly }, payload.live === true);
        log({ payload: rest, sent: r.sent, plan: r.plan, response: r.response });
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ sent: r.sent, warnings: r.plan.warnings }));
      } catch (err) {
        log({ payload: rest, error: (err as Error).message });
        res.writeHead(400).end((err as Error).message);
      }
      return;
    }
    const isOut = url.pathname.startsWith("/out/");
    const base = isOut ? OUT : WEB;
    const rel = isOut ? url.pathname.slice(5) : url.pathname === "/" ? "index.html" : url.pathname === "/takvim" ? "takvim.html" : url.pathname === "/portfoy" ? "portfoy.html" : url.pathname.slice(1);
    const file = normalize(join(base, rel));
    if (url.pathname.startsWith("/api/")) return json(res, 404, { error: `Bilinmeyen uç: ${url.pathname}`, version: APP_VERSION });
    if (!file.startsWith(base) || !existsSync(file)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("bulunamadı");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  } catch (err) {
    res.writeHead(500).end((err as Error).message);
  }
}).listen(PORT, () => {
  console.log(`Özgürlük Rotası paneli (sürüm ${APP_VERSION}): http://localhost:${PORT}`);
  // Veriyi arka planda hazırla: ilk sayfa açılışı hızlı olsun
  getState().catch((e) => console.warn("! Başlangıç verisi hazırlanamadı:", (e as Error).message));
});
