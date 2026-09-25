import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { extname, join, normalize } from "node:path";
import { ROOT, loadEnv } from "../src/env.ts";

loadEnv();
// .env yüklendikten sonra içe aktar: AI modeli gibi ayarlar modül yüklenirken okunur
const { handleApi, getState } = await import("../src/api.ts");
const { APP_VERSION } = await import("../src/version.ts");

const PORT = Number(process.env.PORT ?? 4173);
const WEB = join(ROOT, "web");
const OUT = join(ROOT, "out");
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".md": "text/markdown; charset=utf-8" };

/** Node isteğini Web standardı Request'e çevirir (Netlify fonksiyonuyla aynı işleyici kullanılsın diye). */
function toRequest(req: IncomingMessage, url: URL): Request {
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    duplex: "half",
  } as RequestInit);
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    const r = await handleApi(toRequest(req, url));
    if (r) {
      res.writeHead(r.status, Object.fromEntries(r.headers));
      if (r.body) for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk);
      res.end();
      return;
    }
    const isOut = url.pathname.startsWith("/out/");
    const base = isOut ? OUT : WEB;
    const rel = isOut ? url.pathname.slice(5) : url.pathname === "/" ? "index.html" : url.pathname === "/takvim" ? "takvim.html" : url.pathname === "/portfoy" ? "portfoy.html" : url.pathname === "/haberler" ? "haberler.html" : url.pathname.slice(1);
    const file = normalize(join(base, rel));
    if (!file.startsWith(base) || !existsSync(file) || extname(file) === ".ts") {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("bulunamadı");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  } catch (err) {
    if (!res.headersSent) res.writeHead(500);
    res.end((err as Error).message);
  }
}).listen(PORT, () => {
  console.log(`Özgürlük Rotası paneli (sürüm ${APP_VERSION}): http://localhost:${PORT}`);
  // Veriyi arka planda hazırla: ilk sayfa açılışı hızlı olsun
  getState().catch((e) => console.warn("! Başlangıç verisi hazırlanamadı:", (e as Error).message));
});
