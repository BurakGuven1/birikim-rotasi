import type { Transaction } from "./types";

export type StockMarket = "US" | "TR";
export interface StockIdentity { symbol: string; ticker: string; name: string; market: StockMarket; sector: string; scannerSymbol: string }
export interface StockFundamentals {
  industry: string;
  roe: number | null; roa: number | null; roic: number | null;
  debt: number | null; ebitda: number | null; priceFcf: number | null;
  operatingCashflow: number | null; netIncome: number | null;
  epsGrowth: number | null; revenueGrowth: number | null;
  perf1m: number | null; perf6m: number | null; perf12m: number | null;
  reportedAt: string | null; fScore: number | null;
}
export interface StockRow extends StockIdentity {
  currency: "USD" | "TRY"; price: number | null; change: number | null;
  pe: number | null; pb: number | null; evEbitda: number | null;
  sma200Weekly: number | null; smaDistance: number | null; marketCap: number | null;
  priceAsOf: string | null; delayMinutes: number | null;
  priceUpdatedAt?: string | null;
  fundamentals?: StockFundamentals;
}
export interface StockSnapshot { market: StockMarket; rows: StockRow[]; fetchedAt: string; source: string; cached?: boolean; fundamentalsWarning?: string }

export const BASE_SCANNER_COLUMNS = ["name", "description", "close", "currency", "price_earnings_ttm", "price_book_fq", "enterprise_value_ebitda_ttm", "SMA200|1W", "market_cap_basic", "sector", "update_mode", "lp_time", "change"];
export const FUNDAMENTAL_COLUMNS = ["industry", "return_on_equity", "return_on_assets", "return_on_invested_capital", "total_debt_fq", "ebitda_ttm", "price_free_cash_flow_ttm", "cash_f_operating_activities_ttm", "net_income_ttm", "earnings_per_share_diluted_yoy_growth_ttm", "total_revenue_yoy_growth_ttm", "Perf.1M", "Perf.6M", "Perf.Y", "earnings_release_date", "piotroski_f_score_ttm", "update_time"];
export const SCANNER_COLUMNS = [...BASE_SCANNER_COLUMNS, ...FUNDAMENTAL_COLUMNS];
export function scannerRequest(market: StockMarket, withFundamentals = true) {
  return {
    symbols: market === "TR" ? { symbolset: ["SYML:BIST;XU100"] } : { query: { types: ["stock"] } },
    ...(market === "US" ? { filter: [{ left: "is_primary", operation: "equal", right: true }, { left: "country", operation: "equal", right: "United States" }] } : {}),
    columns: withFundamentals ? SCANNER_COLUMNS : BASE_SCANNER_COLUMNS, sort: { sortBy: "market_cap_basic", sortOrder: "desc" }, range: [0, 100],
  };
}
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const positive = (value: unknown): number | null => { const result = number(value); return result !== null && result > 0 ? result : null; };
function timestamp(value: unknown): string | null {
  const stamp = positive(value);
  return stamp !== null && stamp < 8_640_000_000_000 ? new Date(stamp * 1000).toISOString() : null;
}
function parseFundamentals(d: unknown[]): StockFundamentals | undefined {
  if (d.length <= BASE_SCANNER_COLUMNS.length) return undefined;
  const f = d.slice(BASE_SCANNER_COLUMNS.length);
  return { industry: typeof f[0] === "string" ? f[0] : "", roe: number(f[1]), roa: number(f[2]), roic: number(f[3]), debt: number(f[4]), ebitda: number(f[5]), priceFcf: number(f[6]), operatingCashflow: number(f[7]), netIncome: number(f[8]), epsGrowth: number(f[9]), revenueGrowth: number(f[10]), perf1m: number(f[11]), perf6m: number(f[12]), perf12m: number(f[13]), reportedAt: timestamp(f[14]), fScore: number(f[15]) };
}

export function parseScannerRows(payload: unknown, market: StockMarket): StockRow[] {
  if (!payload || typeof payload !== "object" || !("data" in payload) || !Array.isArray(payload.data)) throw new Error("Hisse verisinin biçimi geçersiz.");
  const seen = new Set<string>();
  return payload.data.flatMap((entry: unknown): StockRow[] => {
    if (!entry || typeof entry !== "object" || !("s" in entry) || !("d" in entry) || typeof entry.s !== "string" || !Array.isArray(entry.d)) return [];
    const d = entry.d;
    if (typeof d[0] !== "string" || typeof d[1] !== "string" || !/^[A-Z0-9._-]{1,20}$/.test(d[0])) return [];
    if (market === "TR" ? !entry.s.startsWith("BIST:") || d[3] !== "TRY" : !/^(NASDAQ|NYSE|AMEX):/.test(entry.s) || d[3] !== "USD") return [];
    const symbol = market === "TR" ? `${d[0]}.IS` : d[0].replaceAll(".", "-");
    if (seen.has(symbol)) return [];
    seen.add(symbol);
    const price = positive(d[2]); const sma200Weekly = positive(d[7]);
    const stamp = positive(d[11]);
    const delay = typeof d[10] === "string" ? /^delayed_streaming_(\d+)$/.exec(d[10]) : null;
    return [{ symbol, ticker: d[0], name: d[1], market, sector: typeof d[9] === "string" ? d[9] : "Diğer", scannerSymbol: entry.s,
      currency: market === "TR" ? "TRY" : "USD", price, change: number(d[12]), pe: positive(d[4]), pb: positive(d[5]), evEbitda: d[9] === "Finance" ? null : positive(d[6]),
      sma200Weekly, smaDistance: price !== null && sma200Weekly !== null ? Math.round((price / sma200Weekly - 1) * 1e10) / 1e8 : null,
      marketCap: positive(d[8]), priceAsOf: stamp && stamp < 8_640_000_000_000 ? new Date(stamp * 1000).toISOString() : null,
      delayMinutes: delay ? Number(delay[1]) / 60 : d[10] === "streaming" ? 0 : null,
      fundamentals: parseFundamentals(d),
      priceUpdatedAt: timestamp(d[BASE_SCANNER_COLUMNS.length + FUNDAMENTAL_COLUMNS.indexOf("update_time")]),
    }];
  }).slice(0, 100);
}

export function validateWatchlistTrade(existing: Transaction[], trade: Transaction, today: string) {
  if (![trade.quantity, trade.unitPrice, trade.commission].every(Number.isFinite) || trade.quantity <= 0 || trade.unitPrice <= 0 || trade.commission < 0) throw new Error("Pozitif adet ve fiyat, geçerli komisyon gir.");
  const stamp = Date.parse(trade.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trade.date) || !Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== trade.date || trade.date > today) throw new Error("Geçerli bir geçmiş tarih veya bugünü seç.");
  if (trade.type === "sell" && trade.commission > trade.quantity * trade.unitPrice) throw new Error("Komisyon satış tutarını aşamaz.");
  let quantity = 0;
  for (const row of [...existing.filter(t => t.symbol === trade.symbol), trade].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    quantity += row.type === "buy" ? row.quantity : -row.quantity;
    if (quantity < -1e-9) throw new Error("Bu tarihte satılabilir adetten fazla satış girilemez.");
  }
}
