/**
 * Claude destekli "AI analist": günlük brifing ve soru-cevap. Anthropic TypeScript SDK'sı ile
 * çalışır; kimlik bilgisi ANTHROPIC_API_KEY (veya `ant auth login` profili) üzerinden çözülür.
 * Yanıtlar akış (stream) olarak panele aktarılır.
 */
import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.ts";
import type { NewsItem } from "./news.ts";
import type { PulsePayload } from "./pulse.ts";
import type { AllocationPayload } from "./allocation.ts";
import type { Valuation } from "./portfolio.ts";

export const AI_MODEL = env("CLAUDE_MODEL") ?? "claude-opus-5";

let client: Anthropic | undefined;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

/** API anahtarı ya da CLI profili var mı (istek atmadan kaba kontrol). */
export function aiConfigured(): boolean {
  return Boolean(env("ANTHROPIC_API_KEY") || env("ANTHROPIC_AUTH_TOKEN") || env("ANTHROPIC_PROFILE") || env("CLAUDE_USE_PROFILE"));
}

const SYSTEM = `Sen "Özgürlük Rotası" uygulamasının Türkçe konuşan kıdemli piyasa analistisin.
Kullanıcı 10-20 yıllık vadede her ay $1.000 + her Ocak $3.500 yatırarak ABD enflasyonundan arındırılmış yüksek getiri ve finansal özgürlük (ev + kira geliri + portföy) hedefliyor.
Portföy yedi varlıktan oluşur: S&P 500 %30, Nasdaq 100 %20, altın %15, BIST 100 (USD) %10, BTC %15, ETH/altcoin %5, emtia %5.
Üç strateji var: "Al-tut çoklu" (sabit ağırlık, hiç satmaz), "Hibrit" (her varlığın yarısı hep tutulur, yarısı ay sonu trend kuralına — 10 aylık SMA + 12 aylık momentum — göre nakde geçer) ve "Ana plan" (Hibrit %80 + OKX swing sistemleri %20).
Aylık sinyal yalnız ay kapanışında değişir; uzun vadeli planın gücü disiplindir.

Kuralların:
- Haberleri bu kişinin portföyü ve planı açısından yorumla; genel piyasa yorumunu kısa tut.
- Kısa vadeli gürültüyü sinyalden ayır. Plan kuralları dışında al-sat önermekten kaçın; kural dışı bir hareket gerekiyorsa bunun neden istisna olduğunu açıkça gerekçelendir.
- Sayıları verilen bağlamdan al; bilmediğin fiyatı uydurma. Emin olmadığın yerde bunu söyle.
- Kaynak göster: haberlerden söz ederken kaynak adını parantez içinde yaz.
- Kısa, taranabilir Türkçe yaz: başlıklar ve madde işaretleri kullan. Kesin getiri vaadi verme; bu bir karar desteğidir, kişisel yatırım tavsiyesi değildir.`;

export interface AiContext {
  pulse?: PulsePayload;
  news?: NewsItem[];
  allocation?: AllocationPayload;
  strategy?: string;
  portfolio?: Valuation;
}

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;

/** Model için kompakt bağlam metni. */
export function contextText(ctx: AiContext): string {
  const L: string[] = [`Bugün: ${new Date().toISOString().slice(0, 10)}`];
  if (ctx.pulse) {
    L.push("", "## Piyasa nabzı (günlük değişim)");
    for (const t of ctx.pulse.tickers) L.push(`- ${t.label}: ${t.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}${t.unit ?? ""} (${pct(t.change)})`);
    if (ctx.pulse.fearGreed) L.push(`- Kripto Korku/Açgözlülük: ${ctx.pulse.fearGreed.value} (${ctx.pulse.fearGreed.label}; dün ${ctx.pulse.fearGreed.previous}, 1 hafta önce ${ctx.pulse.fearGreed.weekAgo})`);
    if (ctx.pulse.upcoming.length) L.push(`- Yaklaşan: ${ctx.pulse.upcoming.map((u) => `${u.title} ${u.date} (${u.daysLeft} gün)`).join("; ")}`);
  }
  if (ctx.allocation) {
    const a = ctx.allocation;
    L.push("", `## Trend durumu (${a.signalMonth} ay sonu sinyali; sonraki güncelleme ${a.nextUpdate})`);
    for (const s of a.assets) L.push(`- ${s.name}: ${s.score === 1 ? "AÇIK" : s.score === 0.5 ? "YARIM" : "KAPALI"} · 12a momentum ${pct(s.mom12)} · fiyat SMA10 ${s.liveClose > s.sma10 ? "üstünde" : "altında"}`);
    const key = (ctx.strategy ?? "static") as keyof typeof a.strategies;
    const st = a.strategies[key];
    if (st) L.push(`- Kullanıcının seçtiği strateji: ${st.name}. Bu ayın hedef ağırlıkları: ${Object.entries(st.weights).filter(([, w]) => w > 0).map(([k, w]) => `${a.bucketNames[k as keyof typeof a.bucketNames]} ${(w * 100).toFixed(1)}%`).join(", ")}`);
  }
  if (ctx.portfolio && ctx.portfolio.positions.length) {
    const t = ctx.portfolio.totals;
    L.push("", `## Kullanıcının portföyü: değer $${t.value.toFixed(0)}, maliyet $${t.costBasis.toFixed(0)}, K/Z ${pct(t.pnlPct)}`);
    for (const p of ctx.portfolio.positions) L.push(`- ${p.name}: $${p.value.toFixed(0)} (%${(p.weight * 100).toFixed(1)}, K/Z ${pct(p.pnlPct)})`);
  }
  if (ctx.news?.length) {
    L.push("", "## Önem sırasına göre son haberler");
    for (const n of ctx.news) {
      const age = Math.round((Date.now() - Date.parse(n.published)) / 3_600_000);
      L.push(`- [${n.source}${n.alsoIn.length ? ` +${n.alsoIn.length} kaynak` : ""}, ${age} sa önce] ${n.title}${n.tags.length ? ` {${n.tags.join(",")}}` : ""}`);
    }
  }
  return L.join("\n");
}

export const BRIEF_PROMPT = `Yukarıdaki bağlama göre bugünün yatırımcı brifingini hazırla. Şu başlıkları kullan:
### Bugünün özeti
(en önemli 3-5 gelişme, her biri tek cümle, kaynaklı)
### Portföyünüz ve planınız için anlamı
(varlık varlık, yalnız etkilenenler)
### Riskler ve dikkat
### Bu ayın planında değişiklik gerekir mi?
(çoğu zaman "hayır" doğru cevaptır; gerekçeyle)
### Takvim
(önümüzdeki 2 haftada izlenecek tarih ve veriler)`;

export interface StreamSink {
  text(chunk: string): void;
  status(s: string): void;
}

/**
 * Claude'a akışlı istek atar. `webSearch` açıksa Claude güncel haberleri kendisi de arar
 * (sunucu tarafı web_search aracı). Ret durumunda sunucu tarafı yedek modele geçilir.
 */
export async function runClaude(
  userPrompt: string,
  ctx: AiContext,
  sink: StreamSink,
  opts: { webSearch?: boolean; history?: { role: "user" | "assistant"; content: string }[] } = {},
): Promise<{ usage: { input: number; output: number; cacheRead: number }; model: string; stopReason: string | null; webSearches: number }> {
  const client = getClient();
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...(opts.history ?? []).slice(-8).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: `<baglam>\n${contextText(ctx)}\n</baglam>\n\n${userPrompt}` },
  ];
  const tools: Anthropic.Beta.BetaToolUnion[] = opts.webSearch ? [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }] : [];
  const usage = { input: 0, output: 0, cacheRead: 0 };
  let final: Anthropic.Beta.BetaMessage | undefined;
  let webSearches = 0;

  // pause_turn: sunucu tarafı araç döngüsü duraklarsa asistan içeriğini geri gönderip devam et
  for (let hop = 0; hop < 4; hop++) {
    const stream = client.beta.messages.stream({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages,
      ...(tools.length ? { tools } : {}),
    });
    stream.on("text", (t) => sink.text(t));
    stream.on("streamEvent", (e) => {
      if (e.type === "content_block_start" && e.content_block.type === "server_tool_use") {
        webSearches++;
        sink.status("Claude web'de arıyor…");
      }
    });
    final = await stream.finalMessage();
    usage.input += final.usage.input_tokens;
    usage.output += final.usage.output_tokens;
    usage.cacheRead += final.usage.cache_read_input_tokens ?? 0;
    if (final.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: final.content });
  }
  if (final?.stop_reason === "refusal") sink.text("\n\n_Claude bu isteği yanıtlamayı reddetti. Soruyu farklı ifade etmeyi deneyin._");
  if (final?.stop_reason === "max_tokens") sink.text("\n\n_(yanıt uzunluk sınırında kesildi)_");
  return { usage, model: final?.model ?? AI_MODEL, stopReason: final?.stop_reason ?? null, webSearches };
}

/** SDK hata sınıflarına göre kullanıcıya anlaşılır Türkçe mesaj. */
export function aiErrorMessage(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Claude API anahtarı geçersiz. .env dosyasındaki ANTHROPIC_API_KEY değerini kontrol edin.";
  if (err instanceof Anthropic.PermissionDeniedError) return "Bu API anahtarının seçilen modele ya da özelliğe erişimi yok.";
  if (err instanceof Anthropic.RateLimitError) return "Claude API hız sınırına takıldı; biraz sonra tekrar deneyin.";
  if (err instanceof Anthropic.BadRequestError) return `Claude isteği reddetti: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Claude API'ye bağlanılamadı (internet bağlantısını kontrol edin).";
  if (err instanceof Anthropic.APIError) return `Claude API hatası (${err.status}): ${err.message}`;
  const msg = (err as Error)?.message ?? String(err);
  if (/credentials|api key|apiKey|authentication/i.test(msg)) return "Claude kimlik bilgisi bulunamadı. .env dosyasına ANTHROPIC_API_KEY ekleyin (https://console.anthropic.com).";
  return msg;
}
