/**
 * Ekonomik takvim: haftanın en önemli (3 yıldız / yüksek etkili) veri açıklamaları.
 * Önce Investing.com (importance=3), erişilemezse ForexFactory'nin herkese açık
 * haftalık JSON'u (impact = High) kullanılır.
 */
export interface EconEvent {
  id: string;
  /** ISO zaman (UTC) */
  time: string;
  currency: string;
  country: string;
  title: string;
  actual?: string;
  forecast?: string;
  previous?: string;
  allDay?: boolean;
}

export interface EconPayload {
  generatedAt: string;
  source: "investing" | "forexfactory" | "none";
  sourceNote: string;
  events: EconEvent[];
}

const COUNTRY: Record<string, string> = { USD: "ABD", EUR: "Euro Bölgesi", GBP: "İngiltere", JPY: "Japonya", CNY: "Çin", TRY: "Türkiye", AUD: "Avustralya", CAD: "Kanada", CHF: "İsviçre", NZD: "Yeni Zelanda" };
const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** Investing.com takvim HTML satırlarını ayrıştırır (en iyi çaba; site yapısı değişirse boş döner). */
export function parseInvesting(html: string): EconEvent[] {
  const rows = html.match(/<tr[^>]*id="eventRowId_\d+"[\s\S]*?<\/tr>/g) ?? [];
  const out: EconEvent[] = [];
  for (const r of rows) {
    const dt = r.match(/data-event-datetime="([^"]+)"/)?.[1];
    const title = strip(r.match(/<td[^>]*class="[^"]*\bevent\b[^"]*"[^>]*>([\s\S]*?)<\/td>/)?.[1] ?? "");
    if (!dt || !title) continue;
    const cur = r.match(/class="[^"]*flagCur[^"]*"[^>]*>[\s\S]*?<\/span>\s*([A-Z]{3})/)?.[1] ?? "";
    const cell = (k: string) => strip(r.match(new RegExp(`id="event${k}_\\d+"[^>]*>([\\s\\S]*?)</td>`))?.[1] ?? "") || undefined;
    // timeZone=55 (GMT) istendiği için tarih UTC kabul edilir
    const iso = new Date(dt.replace(/\//g, "-").replace(" ", "T") + "Z").toISOString();
    out.push({ id: r.match(/eventRowId_(\d+)/)?.[1] ?? iso + title, time: iso, currency: cur, country: COUNTRY[cur] ?? cur, title, actual: cell("Actual"), forecast: cell("Forecast"), previous: cell("Previous") });
  }
  return out;
}

async function fromInvesting(): Promise<EconEvent[]> {
  // Ülkeler: ABD 5, Euro Bölgesi 72, İngiltere 4, Japonya 35, Çin 37, Türkiye 63, Almanya 17
  const form = new URLSearchParams();
  for (const c of [5, 72, 4, 35, 37, 63, 17]) form.append("country[]", String(c));
  form.append("importance[]", "3");
  form.set("timeZone", "55");
  form.set("timeFilter", "timeOnly");
  form.set("currentTab", "thisWeek");
  form.set("submitFilters", "1");
  form.set("limit_from", "0");
  const res = await fetch("https://www.investing.com/economic-calendar/Service/getCalendarFilteredData", {
    method: "POST",
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      Referer: "https://www.investing.com/economic-calendar/",
      Accept: "application/json, text/javascript, */*; q=0.01",
    },
    body: form,
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Investing HTTP ${res.status}`);
  const j = (await res.json()) as { data?: string };
  const ev = parseInvesting(j.data ?? "");
  if (!ev.length) throw new Error("Investing yanıtı ayrıştırılamadı");
  return ev;
}

async function fromForexFactory(): Promise<EconEvent[]> {
  const res = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", { headers: { "User-Agent": "Mozilla/5.0 (ozgurluk-rotasi)" }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`ForexFactory HTTP ${res.status}`);
  const rows = (await res.json()) as { title: string; country: string; date: string; impact: string; forecast?: string; previous?: string; actual?: string }[];
  return rows
    .filter((r) => r.impact === "High")
    .map((r) => ({
      id: `${r.date}|${r.country}|${r.title}`,
      time: new Date(r.date).toISOString(),
      currency: r.country,
      country: COUNTRY[r.country] ?? r.country,
      title: r.title,
      actual: r.actual || undefined,
      forecast: r.forecast || undefined,
      previous: r.previous || undefined,
    }));
}

let cache: { at: number; data: EconPayload } | undefined;

export async function getEcon(force = false): Promise<EconPayload> {
  if (!force && cache && Date.now() - cache.at < 30 * 60_000) return cache.data;
  let data: EconPayload;
  try {
    data = { generatedAt: new Date().toISOString(), source: "investing", sourceNote: "Investing.com — 3 yıldızlı (yüksek volatilite beklenen) veriler", events: await fromInvesting() };
  } catch (e1) {
    try {
      data = { generatedAt: new Date().toISOString(), source: "forexfactory", sourceNote: `ForexFactory — yüksek etkili veriler (Investing erişilemedi: ${(e1 as Error).message})`, events: await fromForexFactory() };
    } catch (e2) {
      if (cache) return cache.data;
      data = { generatedAt: new Date().toISOString(), source: "none", sourceNote: `Takvim alınamadı: ${(e2 as Error).message}`, events: [] };
    }
  }
  data.events.sort((a, b) => a.time.localeCompare(b.time));
  cache = { at: Date.now(), data };
  return data;
}
