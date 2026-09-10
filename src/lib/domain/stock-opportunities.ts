import type { StockFundamentals, StockRow, StockSnapshot } from "./stock-watchlist";

// Transparent baseline, not fitted weights or a probability of profit.
export const OPPORTUNITY_MODEL = "qvm-preview-1";
const DAY = 86_400_000;
const MIN_PEERS = 5;
const MAX_PER_SECTOR = 5;
type Model = "operating" | "bank";
export interface StockOpportunity {
  stock: StockRow; model: Model; score: number; value: number; quality: number; momentum: number;
  peers: number; recovery: "supported" | "waiting";
  momentum6: number; momentum12: number; debtEbitda: number | null; cashConversion: number | null;
  limitations: string[];
}
export interface OpportunityResult {
  candidates: StockOpportunity[];
  excluded: { symbol: string; reasons: string[] }[];
  assessed: number; universe: number; validation: "unvalidated"; modelVersion: string;
}
interface Prepared {
  stock: StockRow; model: Model; group: string;
  value: number[]; quality: number[]; momentum: number[];
  debtEbitda: number | null; cashConversion: number | null; gates: string[];
}
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const positive = (n: unknown): n is number => finite(n) && n > 0;
const mean = (ns: number[]) => ns.reduce((a, b) => a + b, 0) / ns.length;
function recent(date: string | null | undefined, now: Date, maxDays: number) {
  const stamp = date ? Date.parse(date) : NaN;
  return Number.isFinite(stamp) && now.getTime() - stamp >= -300_000 && now.getTime() - stamp <= maxDays * DAY;
}
export function skippedMonthReturn(total: number | null, latestMonth: number | null): number | null {
  if (!finite(total) || !finite(latestMonth) || total <= -100 || latestMonth <= -100) return null;
  const result = ((1 + total / 100) / (1 + latestMonth / 100) - 1) * 100;
  return finite(result) ? result : null;
}
// Mid-rank percentiles give ties equal credit and reduce the influence of outliers.
function percentile(n: number, peers: number[]) {
  return 100 * (peers.filter(p => p < n).length + .5 * peers.filter(p => p === n).length) / peers.length;
}
function modelFor(stock: StockRow): Model | null {
  const industry = stock.fundamentals?.industry ?? "";
  if (/bank/i.test(industry) && stock.sector === "Finance") return "bank";
  if (stock.sector === "Finance" || /REIT|investment trust|holding|insurance/i.test(industry)) return null;
  if (!stock.sector || stock.sector === "Diğer" || !industry) return null;
  return "operating";
}
function prepare(stock: StockRow, now: Date): Prepared | string[] {
  const f = stock.fundamentals;
  if (!f) return ["Temel veri eksik; güncelleme gerekli."];
  const model = modelFor(stock);
  if (!model) return ["Sektör için uzman değerleme modeli gerekli (finans/GYO/holding veya tanımsız sektör)."];
  const invalid: string[] = [];
  if (!positive(stock.price) || !recent(stock.priceAsOf ?? stock.priceUpdatedAt, now, 5)) invalid.push("Fiyat eksik, eski veya zamanı doğrulanamıyor.");
  if (!recent(f.reportedAt, now, 180)) invalid.push("Sonuç açıklama tarihi eksik, eski veya gelecekte.");
  const required: (keyof StockFundamentals)[] = model === "bank"
    ? ["roe", "roa", "netIncome", "epsGrowth", "revenueGrowth"]
    : ["roe", "roic", "debt", "ebitda", "priceFcf", "operatingCashflow", "netIncome", "epsGrowth", "revenueGrowth", "fScore"];
  if (required.some(key => !finite(f[key]))) invalid.push("Kalite, nakit veya bilanço verisi eksik.");
  if (!positive(stock.pe) || (model === "bank" ? !positive(stock.pb) : !positive(stock.evEbitda))) invalid.push("Pozitif, karşılaştırılabilir değerleme oranı eksik.");
  const m6 = skippedMonthReturn(f.perf6m, f.perf1m);
  const m12 = skippedMonthReturn(f.perf12m, f.perf1m);
  if (m6 === null || m12 === null) invalid.push("6–1 / 12–1 momentum verisi eksik.");
  if (invalid.length) return invalid;
  const gates: string[] = [];
  if (f.netIncome! <= 0 || f.roe! <= 0) gates.push("Pozitif kâr ve özkaynak kârlılığı şartı sağlanmıyor.");
  if (f.epsGrowth! < 0 || f.revenueGrowth! < 0) gates.push("Kâr veya gelir büyümesi bozuldu.");
  let debtEbitda: number | null = null;
  let cashConversion: number | null = null;
  let value: number[];
  let quality: number[];
  if (model === "bank") {
    if (f.roa! <= 0) gates.push("Banka aktif kârlılığı pozitif değil.");
    value = [1 / stock.pe!, 1 / stock.pb!];
    quality = [f.roe!, f.roa!];
  } else {
    if (f.roic! <= 0) gates.push("Yatırılan sermayenin kârlılığı pozitif değil.");
    if (f.priceFcf! <= 0 || f.operatingCashflow! <= 0) gates.push("Serbest veya faaliyet nakit akışı pozitif değil.");
    if (f.ebitda! <= 0 || f.debt! < 0) gates.push("Borç / FVAÖK hesabı anlamlı değil.");
    else {
      debtEbitda = f.debt! / f.ebitda!;
      if (debtEbitda > 4) gates.push("Toplam borç / FVAÖK 4× sınırını aşıyor.");
    }
    if (f.netIncome! > 0) {
      cashConversion = f.operatingCashflow! / f.netIncome!;
      if (cashConversion < .8) gates.push("Faaliyet nakit akışı / kâr 0,8× altında.");
    }
    if (!Number.isInteger(f.fScore) || f.fScore! < 0 || f.fScore! > 9) return ["Piotroski kalite verisi geçersiz."];
    if (f.fScore! < 5) gates.push("Piotroski F skoru 5/9 altında.");
    // PD/DD is displayed, but not included here: asset-light firms' book equity
    // is not comparable to banks. Cash flow yield adds an independent lens.
    value = [1 / stock.pe!, 1 / stock.evEbitda!, f.priceFcf! > 0 ? 1 / f.priceFcf! : -1];
    quality = [f.roe!, f.roic!, cashConversion ?? 0, f.fScore!];
  }
  return { stock, model, group: `${stock.market}:${model}:${stock.sector}`, value, quality, momentum: [m6!, m12!], debtEbitda, cashConversion, gates };
}

export function rankStockOpportunities(snapshot: StockSnapshot | undefined, now = new Date()): OpportunityResult {
  const result: OpportunityResult = { candidates: [], excluded: [], assessed: 0, universe: 0, validation: "unvalidated", modelVersion: OPPORTUNITY_MODEL };
  if (!snapshot) return result;
  const rows = [...new Map(snapshot.rows.map(row => [row.symbol, row])).values()];
  result.universe = rows.length;
  const prepared: Prepared[] = [];
  for (const stock of rows) {
    let item: Prepared | string[];
    if (stock.market !== snapshot.market || stock.currency !== (snapshot.market === "US" ? "USD" : "TRY")) item = ["Piyasa veya para birimi uyumsuz."];
    else if (!recent(snapshot.fetchedAt, now, 5)) item = ["Piyasa kaydı eski; yeniden güncelle."];
    else item = prepare(stock, now);
    if (Array.isArray(item)) result.excluded.push({ symbol: stock.symbol, reasons: item });
    else prepared.push(item);
  }
  result.assessed = prepared.length;
  const scored: StockOpportunity[] = [];
  for (const p of prepared) {
    const peers = prepared.filter(other => other.group === p.group);
    if (p.gates.length) { result.excluded.push({ symbol: p.stock.symbol, reasons: p.gates }); continue; }
    if (peers.length < MIN_PEERS) { result.excluded.push({ symbol: p.stock.symbol, reasons: [`Karşılaştırma için en az ${MIN_PEERS} tam verili sektör emsali gerekli (${peers.length} var).`] }); continue; }
    const value = mean(p.value.map((n, i) => percentile(n, peers.map(other => other.value[i]))));
    const quality = mean(p.quality.map((n, i) => percentile(n, peers.map(other => other.quality[i]))));
    const momentumParts = p.momentum.map((n, i) => percentile(n, prepared.map(other => other.momentum[i])));
    const momentum = mean(momentumParts);
    const reasons = [];
    if (value < 50) reasons.push("Sektör içi değerleme puanı 50 altında; göreli iskonto zayıf.");
    if (quality < 50) reasons.push("Sektör içi kalite puanı 50 altında.");
    if (reasons.length) { result.excluded.push({ symbol: p.stock.symbol, reasons }); continue; }
    scored.push({ stock: p.stock, model: p.model, score: mean([value, quality, momentum]), value, quality, momentum, peers: peers.length,
      recovery: p.momentum.every(n => n > 0) && momentumParts.every(n => n >= 50) ? "supported" : "waiting",
      momentum6: p.momentum[0], momentum12: p.momentum[1], debtEbitda: p.debtEbitda, cashConversion: p.cashConversion,
      limitations: p.model === "bank" ? ["Banka sermaye yeterliliği ve takipteki kredi oranı doğrulanmadı."] : [],
    });
  }
  scored.sort((a, b) => b.score - a.score || b.quality - a.quality || a.stock.symbol.localeCompare(b.stock.symbol, "en"));
  const sectorCounts = new Map<string, number>();
  for (const candidate of scored) {
    const count = sectorCounts.get(candidate.stock.sector) ?? 0;
    if (count >= MAX_PER_SECTOR || result.candidates.length >= 20) {
      result.excluded.push({ symbol: candidate.stock.symbol, reasons: [count >= MAX_PER_SECTOR ? "Sektör başına 5 aday sınırı; kalite ihlali değil." : "İlk 20 dışında kaldı; kalite ihlali değil."] });
    } else { result.candidates.push(candidate); sectorCounts.set(candidate.stock.sector, count + 1); }
  }
  return result;
}

export function opportunityChanges(previous: StockSnapshot | undefined, current: StockSnapshot | undefined, now = new Date()): { symbol: string; reason: string }[] {
  if (!previous || !current || previous.market !== current.market || previous.fetchedAt >= current.fetchedAt) return [];
  // Evaluate the previous snapshot as it was known then, not against today's age.
  const before = rankStockOpportunities(previous, new Date(previous.fetchedAt));
  const after = rankStockOpportunities(current, now);
  return before.candidates.filter(c => !after.candidates.some(next => next.stock.symbol === c.stock.symbol))
    .map(c => ({ symbol: c.stock.symbol, reason: after.excluded.find(e => e.symbol === c.stock.symbol)?.reasons.join(" ") ?? "Güncel tarama evreninde yok; şirketin durumu hakkında tek başına sonuç çıkarılamaz." }));
}
