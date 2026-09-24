import { ASSETS, type AssetId } from "./config.ts";
import { EVENTS, EVENT_TYPE_LABEL, type Scope } from "./data/events.ts";
import { loadAsset, loadRaw } from "./data/load.ts";
import type { Bar } from "./data/types.ts";
import {
  MONTHS_TR_LONG,
  eventInsights,
  eventStudy,
  monthStats,
  monthlyReturns,
  notesByMonth,
  seasonalInsights,
  type EventTypeSummary,
  type Insight,
  type MonthStat,
} from "./engine/seasonality.ts";

export type CalendarAssetId = AssetId | "BIST_TL";

interface CalendarAssetDef {
  id: CalendarAssetId;
  name: string;
  short: string;
  currency: string;
  scopes: Scope[];
  load: () => Promise<Bar[]>;
}

export const CALENDAR_ASSETS: CalendarAssetDef[] = [
  { id: "BIST_TL", name: "BIST 100 (TL)", short: "XU100 TL", currency: "TRY", scopes: ["TR", "GLOBAL"], load: () => loadRaw("XU100.IS", "XU100.INDX") },
  { id: "BIST", name: ASSETS.BIST.name, short: "XU100 $", currency: "USD", scopes: ["TR", "GLOBAL"], load: () => loadAsset("BIST") },
  { id: "SPY", name: ASSETS.SPY.name, short: "S&P 500", currency: "USD", scopes: ["US", "GLOBAL"], load: () => loadAsset("SPY") },
  { id: "QQQ", name: ASSETS.QQQ.name, short: "Nasdaq 100", currency: "USD", scopes: ["US", "GLOBAL"], load: () => loadAsset("QQQ") },
  { id: "GLD", name: ASSETS.GLD.name, short: "Altın", currency: "USD", scopes: ["GLOBAL", "US"], load: () => loadAsset("GLD") },
  { id: "BTC", name: ASSETS.BTC.name, short: "BTC", currency: "USD", scopes: ["CRYPTO", "GLOBAL"], load: () => loadAsset("BTC") },
  { id: "ETH", name: ASSETS.ETH.name, short: "ETH", currency: "USD", scopes: ["CRYPTO", "GLOBAL"], load: () => loadAsset("ETH") },
  { id: "DBC", name: ASSETS.DBC.name, short: "Emtia", currency: "USD", scopes: ["GLOBAL"], load: () => loadAsset("DBC") },
];

export interface CalendarAsset {
  id: CalendarAssetId;
  name: string;
  short: string;
  currency: string;
  dataStart: string;
  lastDate: string;
  years: number[];
  cells: Record<string, { ret: number; partial: boolean }>;
  stats: MonthStat[];
  baseUpRate: number;
  typicalAbs: number;
  insights: Insight[];
  events: EventTypeSummary[];
  notes: Record<string, { date: string; title: string; type: string; typeLabel: string; upcoming: boolean }[]>;
}

export interface UpcomingRow {
  asset: string;
  n: number;
  preUp: number;
  preAvg: number;
  pre3mUp: number;
  pre3mAvg: number;
  n3m: number;
  post3mUp: number;
  post3mAvg: number;
}

export interface CalendarPayload {
  generatedAt: string;
  asOf: string;
  lookbackYears: number;
  assets: CalendarAsset[];
  focus: { month: number; label: string; lines: string[] }[];
  upcoming: { date: string; title: string; typeLabel: string; daysLeft: number; lines: string[]; rows: UpcomingRow[] }[];
}

export async function buildCalendar(lookbackYears = 10, asOf = new Date().toISOString().slice(0, 10)): Promise<CalendarPayload> {
  const assets: CalendarAsset[] = [];
  for (const def of CALENDAR_ASSETS) {
    const bars = (await def.load()).filter((b) => b.date <= asOf);
    const all = monthlyReturns(bars, asOf);
    const lastYear = Number(asOf.slice(0, 4));
    const firstYear = lastYear - lookbackYears;
    const shown = all.filter((c) => Number(c.month.slice(0, 4)) >= firstYear);
    const { stats, baseUpRate, typicalAbs } = monthStats(all, lookbackYears);
    const events = eventStudy(bars, def.scopes);
    const notes: CalendarAsset["notes"] = {};
    for (const [m, evs] of Object.entries(notesByMonth(def.scopes))) {
      if (Number(m.slice(0, 4)) < firstYear) continue;
      notes[m] = evs.map((e) => ({ date: e.date, title: e.title, type: e.type, typeLabel: EVENT_TYPE_LABEL[e.type], upcoming: !!e.upcoming }));
    }
    const years = [...new Set(shown.map((c) => Number(c.month.slice(0, 4))))].sort((a, b) => b - a);
    assets.push({
      id: def.id,
      name: def.name,
      short: def.short,
      currency: def.currency,
      dataStart: bars[0].date,
      lastDate: bars[bars.length - 1].date,
      years,
      cells: Object.fromEntries(shown.map((c) => [c.month, { ret: c.ret, partial: c.partial }])),
      stats,
      baseUpRate,
      typicalAbs,
      insights: [...seasonalInsights(def.name, stats), ...eventInsights(def.name, events)],
      events,
      notes,
    });
  }

  // Bu ay ve gelecek ay için varlıklar arası özet
  const curMonth = Number(asOf.slice(5, 7));
  const focus = [curMonth, (curMonth % 12) + 1].map((m) => {
    const lines: string[] = [];
    for (const a of assets) {
      const s = a.stats[m - 1];
      if (s.n < 6) continue;
      const r = s.up / s.n;
      if (r >= 0.7) lines.push(`🟢 ${a.short}: ${s.up}/${s.n} yeşil, ort. ${pctSigned(s.avg)}`);
      else if (r <= 0.3) lines.push(`🔴 ${a.short}: ${s.n - s.up}/${s.n} kırmızı, ort. ${pctSigned(s.avg)}`);
    }
    if (!lines.length) lines.push("Belirgin bir mevsimsel eğilim yok (hiçbir varlıkta ≥7/10 veya ≤3/10).");
    return { month: m, label: MONTHS_TR_LONG[m - 1], lines };
  });

  // Yaklaşan olaylar (24 ay)
  const now = Date.parse(asOf);
  const upcoming = EVENTS.filter((e) => e.upcoming && Date.parse(e.date) > now && Date.parse(e.date) - now < 730 * 86_400_000).map((e) => {
    const lines: string[] = [];
    const rows: UpcomingRow[] = [];
    for (const def of CALENDAR_ASSETS) {
      if (!e.scope.some((s) => def.scopes.includes(s))) continue;
      const a = assets.find((x) => x.id === def.id)!;
      const s = a.events.find((x) => x.type === e.type);
      if (!s) continue;
      rows.push({ asset: a.short, n: s.n, preUp: s.preUp, preAvg: s.preAvg, pre3mUp: s.pre3mUp, pre3mAvg: s.pre3mAvg, n3m: s.n3m, post3mUp: s.post3mUp, post3mAvg: s.post3mAvg });
      lines.push(`${a.short} (önceki ${s.n} örnek): öncesindeki 6 ay ${s.preUp}/${s.n} yükseliş, ort. ${pctSigned(s.preAvg)} · son 3 ay ${s.pre3mUp}/${s.n}, ort. ${pctSigned(s.pre3mAvg)} · sonrasındaki 3 ay ${s.post3mUp}/${s.n3m}, ort. ${pctSigned(s.post3mAvg)}`);
    }
    return { date: e.date, title: e.title, typeLabel: EVENT_TYPE_LABEL[e.type], daysLeft: Math.round((Date.parse(e.date) - now) / 86_400_000), lines, rows };
  });

  return { generatedAt: new Date().toISOString(), asOf, lookbackYears, assets, focus, upcoming };
}

export function pctSigned(x: number): string {
  if (!Number.isFinite(x)) return "—";
  return `${x >= 0 ? "+" : "−"}%${Math.abs(x * 100).toFixed(1)}`;
}
