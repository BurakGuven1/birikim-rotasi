/**
 * Takvim notları ve olay çalışması (event study) için olay listesi.
 * scope: olayın hangi varlıkları doğrudan ilgilendirdiği (takvimde not olarak gösterilir).
 */
export type EventType =
  | "us_presidential"
  | "us_midterm"
  | "tr_general"
  | "tr_local"
  | "btc_halving"
  | "shock";

export type Scope = "TR" | "US" | "CRYPTO" | "GLOBAL";

export interface MarketEvent {
  date: string;
  type: EventType;
  title: string;
  scope: Scope[];
  /** Gelecekteki olay mı (planlanan / tahmini) */
  upcoming?: boolean;
}

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  us_presidential: "ABD başkanlık seçimi",
  us_midterm: "ABD ara seçimi",
  tr_general: "Türkiye genel/cumhurbaşkanlığı seçimi",
  tr_local: "Türkiye yerel seçimi",
  btc_halving: "Bitcoin halving",
  shock: "Piyasa şoku",
};

export const EVENTS: MarketEvent[] = [
  // ABD seçimleri
  { date: "2012-11-06", type: "us_presidential", title: "ABD başkanlık seçimi (Obama 2. dönem)", scope: ["US", "GLOBAL"] },
  { date: "2014-11-04", type: "us_midterm", title: "ABD ara seçimi", scope: ["US"] },
  { date: "2016-11-08", type: "us_presidential", title: "ABD başkanlık seçimi (Trump)", scope: ["US", "GLOBAL"] },
  { date: "2018-11-06", type: "us_midterm", title: "ABD ara seçimi", scope: ["US"] },
  { date: "2020-11-03", type: "us_presidential", title: "ABD başkanlık seçimi (Biden)", scope: ["US", "GLOBAL"] },
  { date: "2022-11-08", type: "us_midterm", title: "ABD ara seçimi", scope: ["US"] },
  { date: "2024-11-05", type: "us_presidential", title: "ABD başkanlık seçimi (Trump 2. dönem)", scope: ["US", "GLOBAL"] },
  { date: "2026-11-03", type: "us_midterm", title: "ABD ara seçimi", scope: ["US"], upcoming: true },
  { date: "2028-11-07", type: "us_presidential", title: "ABD başkanlık seçimi", scope: ["US", "GLOBAL"], upcoming: true },
  // Türkiye seçimleri
  { date: "2011-06-12", type: "tr_general", title: "TR genel seçim", scope: ["TR"] },
  { date: "2014-03-30", type: "tr_local", title: "TR yerel seçim", scope: ["TR"] },
  { date: "2014-08-10", type: "tr_general", title: "TR cumhurbaşkanlığı seçimi", scope: ["TR"] },
  { date: "2015-06-07", type: "tr_general", title: "TR genel seçim (Haziran)", scope: ["TR"] },
  { date: "2015-11-01", type: "tr_general", title: "TR genel seçim (Kasım, tekrar)", scope: ["TR"] },
  { date: "2018-06-24", type: "tr_general", title: "TR cumhurbaşkanlığı + genel seçim", scope: ["TR"] },
  { date: "2019-03-31", type: "tr_local", title: "TR yerel seçim", scope: ["TR"] },
  { date: "2023-05-14", type: "tr_general", title: "TR cumhurbaşkanlığı + genel seçim (2. tur 28 Mayıs)", scope: ["TR"] },
  { date: "2024-03-31", type: "tr_local", title: "TR yerel seçim", scope: ["TR"] },
  { date: "2028-05-14", type: "tr_general", title: "TR genel seçim (planlanan; erken seçim olasılığı var)", scope: ["TR"], upcoming: true },
  // Bitcoin halving
  { date: "2012-11-28", type: "btc_halving", title: "BTC 1. halving", scope: ["CRYPTO"] },
  { date: "2016-07-09", type: "btc_halving", title: "BTC 2. halving", scope: ["CRYPTO"] },
  { date: "2020-05-11", type: "btc_halving", title: "BTC 3. halving", scope: ["CRYPTO"] },
  { date: "2024-04-20", type: "btc_halving", title: "BTC 4. halving", scope: ["CRYPTO"] },
  { date: "2028-04-15", type: "btc_halving", title: "BTC 5. halving (tahmini)", scope: ["CRYPTO"], upcoming: true },
  // Şoklar ve rejim değişiklikleri (takvim notu; olay çalışmasına dahil değil)
  { date: "2016-07-15", type: "shock", title: "15 Temmuz darbe girişimi", scope: ["TR"] },
  { date: "2018-08-10", type: "shock", title: "TL kur krizi (Ağustos 2018)", scope: ["TR"] },
  { date: "2020-03-12", type: "shock", title: "Covid-19 çöküşü", scope: ["GLOBAL", "US", "TR", "CRYPTO"] },
  { date: "2021-12-20", type: "shock", title: "TL kur şoku ve KKM", scope: ["TR"] },
  { date: "2022-03-16", type: "shock", title: "Fed faiz artırım döngüsü başladı", scope: ["US", "GLOBAL", "CRYPTO"] },
  { date: "2022-05-09", type: "shock", title: "Terra/LUNA çöküşü", scope: ["CRYPTO"] },
  { date: "2022-11-08", type: "shock", title: "FTX çöküşü", scope: ["CRYPTO"] },
  { date: "2023-02-06", type: "shock", title: "Kahramanmaraş depremleri", scope: ["TR"] },
  { date: "2023-06-22", type: "shock", title: "TCMB sıkılaşma döngüsü başladı", scope: ["TR"] },
  { date: "2024-01-10", type: "shock", title: "ABD spot Bitcoin ETF onayı", scope: ["CRYPTO"] },
  { date: "2024-09-18", type: "shock", title: "Fed faiz indirimlerine başladı", scope: ["US", "GLOBAL"] },
  { date: "2025-03-19", type: "shock", title: "İmamoğlu gözaltısı — BIST sert satış", scope: ["TR"] },
  { date: "2025-04-02", type: "shock", title: "ABD gümrük tarifeleri (2 Nisan)", scope: ["US", "GLOBAL", "CRYPTO"] },
];
