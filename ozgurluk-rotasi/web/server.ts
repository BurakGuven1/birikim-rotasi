import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { extname, join, normalize } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { ASSET_IDS, type AssetId, type SwingStrategyId } from "../src/config.ts";
import { loadAsset } from "../src/data/load.ts";
import { ROOT, env, loadEnv } from "../src/env.ts";
import { atr, donchian, sma } from "../src/engine/indicators.ts";
import { runSwing } from "../src/pipeline.ts";
import { executeOrder } from "../src/live/orders.ts";

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

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
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
    const rel = isOut ? url.pathname.slice(5) : url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = normalize(join(base, rel));
    if (!file.startsWith(base) || !existsSync(file)) {
      res.writeHead(404).end("bulunamadı — önce `npm run backtest` ve `npm run sinyal` çalıştırın");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  } catch (err) {
    res.writeHead(500).end((err as Error).message);
  }
}).listen(PORT, () => console.log(`Özgürlük Rotası paneli: http://localhost:${PORT}`));
