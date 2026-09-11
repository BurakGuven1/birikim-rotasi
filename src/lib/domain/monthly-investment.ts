import { investmentProfileIssues, type InvestmentPolicy } from "./investment-policy";
import type { AssetClass, MarketSnapshot, PricePoint, Transaction } from "./types";
import { assessOpportunity, allocateOpportunities, OPPORTUNITY_CAPS, OPPORTUNITY_VERSION, type OpportunityAssessment } from "./opportunity-investment";

export type InvestmentKey = AssetClass | "cash";
export type InvestmentValues = Record<InvestmentKey, number>;
export const INVESTMENT_ASSETS: { key: AssetClass; symbol: string; label: string; instrument: string; color: string }[] = [
  { key: "foreignEquity", symbol: "VTI", label: "ABD hisseleri", instrument: "VTI · geniş piyasa ETF örneği", color: "#3678dd" },
  { key: "commodity", symbol: "IAU", label: "Altın", instrument: "IAU · altın ETF örneği", color: "#bc892e" },
  { key: "turkishEquity", symbol: "BIST100", label: "Türk hisse / fon", instrument: "BIST 100 · gösterge endeks, fon seçimi ayrıca", color: "#219f88" },
  { key: "bitcoin", symbol: "BTC", label: "Bitcoin", instrument: "BTC · spot, kaldıraçsız", color: "#ba69cd" },
];
export const EMPTY_INVESTMENT_VALUES: InvestmentValues = { foreignEquity: 0, commodity: 0, turkishEquity: 0, bitcoin: 0, cash: 0 };
export interface InvestmentMarketData { quote?: MarketSnapshot; history: PricePoint[]; source: string; error?: string }
export type InvestmentMarket = Partial<Record<AssetClass, InvestmentMarketData>>;
export interface InvestmentRow {
  key: InvestmentKey; label: string; symbol?: string; color: string;
  targetWeight: number; currentWeight: number; afterWeight: number; contributionWeight: number;
  amountUsd: number; signal: number; usable: boolean; reason: string; asOf?: string; source?: string;
  opportunity?: OpportunityAssessment;
}
export interface MonthlyInvestment {
  budgetUsd: number; costUsd: number; portfolioUsd: number; rows: InvestmentRow[];
  status: "draft" | "blocked" | "ready"; warnings: string[]; generatedAt: string; method: string;
  totalDeployableUsd?: number; reserveUsedUsd?: number;
}

export function istanbulDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function nextContributionDate(start: string, day: number, now: Date): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isInteger(day) || day < 1 || day > 28) throw new Error("Geçersiz katkı takvimi.");
  const today = istanbulDate(now);
  if (today <= start) return start;
  const [year, month] = today.split("-").map(Number);
  const candidate = `${today.slice(0, 7)}-${String(day).padStart(2, "0")}`;
  return candidate >= today ? candidate : new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

function validQuote(quote: MarketSnapshot | undefined, crypto: boolean, now: Date) {
  if (!quote || quote.status === "stale" || quote.status === "unavailable" || !Number.isFinite(quote.price) || quote.price <= 0) return false;
  const age = now.getTime() - Date.parse(quote.asOf);
  return Number.isFinite(age) && age >= -300_000 && age <= (crypto ? 45 * 60_000 : 96 * 3_600_000);
}

export function cleanInvestmentHistory(history: PricePoint[], now: Date) {
  const unique = new Map<string, PricePoint>();
  for (const point of history) {
    if (Number.isFinite(point.close) && point.close > 0 && Number.isFinite(Date.parse(point.date)) && Date.parse(point.date) <= now.getTime()) unique.set(point.date.slice(0, 10), point);
  }
  return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function assessInvestmentData(data: InvestmentMarketData | undefined, key: AssetClass, now: Date) {
  if (!data || !validQuote(data.quote, key === "bitcoin", now)) return { usable: false, reason: "Fiyat eksik, eski veya zaman damgası geçersiz; bu pay nakitte bekler.", signal: 0 };
  const points = cleanInvestmentHistory(data.history, now);
  const recent = points.slice(-200);
  const span = recent.length ? (Date.parse(recent.at(-1)!.date) - Date.parse(recent[0].date)) / 86400000 : Infinity;
  if (recent.length < 200 || span > 340 || now.getTime() - Date.parse(recent.at(-1)!.date) > 96 * 3_600_000) return { usable: false, reason: "Güncel 200 günlük gözlem yok; haftalık veriden günlük sinyal üretilmez.", signal: 0 };
  const latest = recent.at(-1)!.close;
  const average = recent.reduce((sum, p) => sum + p.close, 0) / recent.length;
  const sixMonthsAgo = new Date(recent.at(-1)!.date);
  sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 6);
  const anchor = points.filter(point => Date.parse(point.date) <= sixMonthsAgo.getTime()).at(-1);
  if (!anchor || sixMonthsAgo.getTime() - Date.parse(anchor.date) > 7 * 86400000) return { usable: false, reason: "Altı aylık takvim tarihinde yeterli fiyat geçmişi yok.", signal: 0 };
  const momentum = latest / anchor.close - 1;
  const signal = (latest > average ? 0.5 : -0.5) + (momentum > 0 ? 0.5 : -0.5);
  return { usable: true, signal, reason: signal > 0 ? "200 günlük ortalama ve 6 aylık fiyat momentumu pozitif; sınırlı ağırlık desteği." : signal < 0 ? "Uzun trend ve momentum zayıf; hedef pay azaltıldı, fark nakitte." : "Trend ve momentum farklı yönde; politika ağırlığı korunuyor." };
}

function usdHistory(history: PricePoint[], fxHistory: PricePoint[], now: Date): PricePoint[] {
  const fx = cleanInvestmentHistory(fxHistory, now);
  let cursor = -1;
  return cleanInvestmentHistory(history, now).flatMap(point => {
    while (cursor + 1 < fx.length && fx[cursor + 1].date.slice(0, 10) <= point.date.slice(0, 10)) cursor++;
    const rate = fx[cursor];
    if (!rate || Date.parse(point.date) - Date.parse(rate.date) > 4 * 86400000) return [];
    return [{ ...point, close: point.close / rate.close }];
  });
}

export function valueInvestmentHoldings(transactions: Transaction[], quotes: Record<string, MarketSnapshot>, usdTry: number | undefined, cash: number, now: Date) {
  const values = { ...EMPTY_INVESTMENT_VALUES, cash };
  const missing: string[] = [];
  const positions = new Map<string, { quantity: number; key: AssetClass }>();
  for (const t of [...transactions].sort((a, b) => a.date.localeCompare(b.date))) {
    if (t.date.slice(0, 10) > istanbulDate(now)) { missing.push(`${t.symbol} ileri tarihli işlem`); continue; }
    if (!Number.isFinite(t.quantity) || t.quantity <= 0) { missing.push(t.symbol); continue; }
    const position = positions.get(t.symbol) ?? { quantity: 0, key: t.assetClass };
    position.quantity += t.type === "buy" ? t.quantity : -t.quantity;
    if (position.quantity < -1e-8) missing.push(`${t.symbol} geçersiz satış adedi`);
    positions.set(t.symbol, position);
  }
  for (const [symbol, position] of positions) {
    if (position.quantity <= 1e-8) continue;
    const quote = quotes[symbol];
    if (!validQuote(quote, position.key === "bitcoin", now) || (quote.currency !== "USD" && (quote.currency !== "TRY" || !usdTry || usdTry <= 0 || !Number.isFinite(usdTry)))) { missing.push(symbol); continue; }
    values[position.key] += position.quantity * quote.price / (quote.currency === "TRY" ? usdTry! : 1);
  }
  return { values, complete: missing.length === 0, missing: [...new Set(missing)] };
}

const BASE_WEIGHTS: Record<InvestmentPolicy["riskLevel"], InvestmentValues> = {
  cautious: { foreignEquity: .30, commodity: .25, turkishEquity: .05, bitcoin: 0, cash: .40 },
  balanced: { foreignEquity: .55, commodity: .20, turkishEquity: .10, bitcoin: .05, cash: .10 },
  growth: { foreignEquity: .60, commodity: .15, turkishEquity: .10, bitcoin: .10, cash: .05 },
};

export interface MonthlyInvestmentInput { budgetUsd: number; policy: InvestmentPolicy; market: InvestmentMarket; currentValues: InvestmentValues; valuationComplete: boolean; now: Date; fxHistory?: PricePoint[]; reserveAvailableUsd?: number; btcDerivativeExposureUsd?: number }

export function buildMonthlyInvestment(input: MonthlyInvestmentInput): MonthlyInvestment {
  const { policy, now, market, currentValues } = input;
  if (!Number.isFinite(input.budgetUsd) || input.budgetUsd < 0 || (input.budgetUsd === 0 && policy.allocationMode === "legacy") || input.budgetUsd > 1e8) throw new Error("Katkı 0 ile 100 milyon USD arasında olmalı.");
  if (Object.values(currentValues).some(value => !Number.isFinite(value) || value < 0)) throw new Error("Portföy değerleri geçersiz.");
  if (policy.allocationMode === "opportunity") return buildOpportunityMonthly(input);
  if (policy.allocationMode === "dca") return buildDcaMonthly(input);
  const budgetCents = Math.round(input.budgetUsd * 100);
  const budgetUsd = budgetCents / 100;
  const portfolioUsd = Object.values(currentValues).reduce((a, b) => a + b, 0);
  const profile = investmentProfileIssues(policy);
  const warnings = [...profile.blockers, ...profile.missing];
  if (!input.valuationComplete) warnings.push("Portföyün tamamı değerlenemedi; eksik fiyatlar tamamlanana kadar yeni alım dağıtılmaz.");
  const blocked = profile.blockers.length > 0 || !input.valuationComplete;
  // A modest loss tolerance overrides a more aggressive selector; it is not a loss guarantee.
  const level = policy.maxDrawdown !== null && policy.maxDrawdown <= .25 ? "cautious" : policy.riskLevel;
  if (level !== policy.riskLevel) warnings.push("Düşüş toleransın nedeniyle temkinli politika uygulandı. Bu oran bir zarar garantisi değildir.");
  const base = BASE_WEIGHTS[level];
  const assessments = INVESTMENT_ASSETS.map(asset => {
    let data = market[asset.key];
    if (data && asset.key === "turkishEquity") data = { ...data, history: usdHistory(data.history, input.fxHistory ?? [], now) };
    const result = assessInvestmentData(data, asset.key, now);
    const tilt = asset.key === "bitcoin" ? .02 : .03;
    const cap = asset.key === "bitcoin" ? base.bitcoin : asset.key === "turkishEquity" ? .15 : asset.key === "commodity" ? .30 : .65;
    return { asset, ...result, target: result.usable ? Math.min(cap, Math.max(0, base[asset.key] + result.signal * tilt)) : 0 };
  });
  const requested = assessments.reduce((sum, a) => sum + a.target, 0);
  const scale = requested > 1 - base.cash ? (1 - base.cash) / requested : 1;
  const targets: InvestmentValues = { ...EMPTY_INVESTMENT_VALUES };
  for (const a of assessments) targets[a.asset.key] = a.target * scale;
  targets.cash = 1 - Object.values(targets).reduce((a, b) => a + b, 0);
  if (portfolioUsd > 0 && currentValues.bitcoin / portfolioUsd > base.bitcoin + .005) warnings.push("Bitcoin mevcut ağırlığı politika tavanının üzerinde. Yeni katkı diğer sınıflara yönelir; düşüş riski devam eder.");
  const deficits = assessments.map(a => Math.max(0, targets[a.asset.key] * (portfolioUsd + budgetUsd) - currentValues[a.asset.key]));
  const reserveDeficit = Math.max(0, targets.cash * (portfolioUsd + budgetUsd) - currentValues.cash);
  const allDeficits = deficits.reduce((a, b) => a + b, reserveDeficit);
  // Fees are paid from the same contribution, never on top of the stated budget.
  const costRate = policy.feeBps / 10000;
  const factor = allDeficits > 0 ? Math.min(1, budgetUsd / (allDeficits + deficits.reduce((a, b) => a + b, 0) * costRate)) : 0;
  const amounts = deficits.map(deficit => {
    const cents = blocked ? 0 : Math.floor((deficit * factor + 1e-10) * 100);
    return cents < policy.minOrderUsd * 100 ? 0 : cents;
  });
  const investedCents = amounts.reduce((a, b) => a + b, 0);
  const feeCents = Math.min(budgetCents - investedCents, Math.ceil(investedCents * costRate - 1e-8));
  const cashCents = budgetCents - investedCents - feeCents;
  const afterTotal = portfolioUsd + budgetUsd - feeCents / 100;
  const rows: InvestmentRow[] = assessments.map((a, i) => ({
    key: a.asset.key, label: a.asset.label, symbol: a.asset.symbol, color: a.asset.color,
    targetWeight: targets[a.asset.key], currentWeight: portfolioUsd ? currentValues[a.asset.key] / portfolioUsd : 0,
    afterWeight: (currentValues[a.asset.key] + amounts[i] / 100) / afterTotal,
    contributionWeight: amounts[i] / budgetCents, amountUsd: amounts[i] / 100,
    signal: a.signal, usable: a.usable, asOf: market[a.asset.key]?.quote?.asOf, source: market[a.asset.key]?.quote?.source,
    reason: `${a.reason}${a.asset.key === "turkishEquity" ? " Sinyal tarihsel USD/TRY ile dolar bazında; TEFAS fon fiyatı değildir." : ""}${a.usable && !amounts[i] && !blocked ? " Hedef zaten dolu veya tutar minimum işlemin altında; yeni alım yok." : ""}`,
  }));
  rows.push({ key: "cash", label: "Nakit / kısa vadeli rezerv", color: "#8795a8", targetWeight: targets.cash, currentWeight: portfolioUsd ? currentValues.cash / portfolioUsd : 0, afterWeight: (currentValues.cash + cashCents / 100) / afterTotal, contributionWeight: cashCents / budgetCents, amountUsd: cashCents / 100, signal: 0, usable: true, reason: "Alınmayan pay ve küçük tutarlar burada kalır. Faiz/para piyasası fonu getirisi varsayılmadı. TL faizinde dolar karşısındaki kur riski sürer." });
  if (!assessments.some(a => a.usable)) warnings.push("Yeterli piyasa verisi yok; katkı nakitte bekler.");
  return { budgetUsd, portfolioUsd, costUsd: feeCents / 100, rows, status: blocked || !assessments.some(a => a.usable) ? "blocked" : profile.missing.length ? "draft" : "ready", warnings, generatedAt: now.toISOString(), method: "monthly-policy-v1" };
}

function buildOpportunityMonthly(input: MonthlyInvestmentInput): MonthlyInvestment {
  const { policy, now, market, currentValues } = input;
  const budgetUsd = Math.round(input.budgetUsd * 100) / 100;
  const portfolioUsd = Object.values(currentValues).reduce((a,b) => a+b,0);
  const profile = investmentProfileIssues(policy);
  const warnings = [...profile.blockers, ...profile.missing];
  if (!input.valuationComplete) warnings.push("Portföy veya rezerv tam değerlenemedi; alım bütçesi kullanılmıyor.");
  const blocked = profile.blockers.length > 0 || !input.valuationComplete;
  const assessments = INVESTMENT_ASSETS.map(asset => {
    const raw = market[asset.key];
    const data = raw && asset.key === "turkishEquity" ? { ...raw, history: usdHistory(raw.history,input.fxHistory ?? [],now) } : raw;
    const quality = assessInvestmentData(data,asset.key,now);
    const opportunity = assessOpportunity(data?.history ?? [],now);
    return { asset, quality, opportunity };
  });
  const reserveUsd = Math.min(currentValues.cash, Math.max(0,input.reserveAvailableUsd ?? 0));
  const allocation = allocateOpportunities({ budgetUsd, reserveUsd, portfolioUsd, feeBps: policy.feeBps, minOrderUsd: policy.minOrderUsd,
    candidates: blocked ? [] : assessments.filter(a => a.quality.usable).map(a => ({ key:a.asset.key, score:a.opportunity.score, stage:a.opportunity.stage, currentUsd:currentValues[a.asset.key], cap:OPPORTUNITY_CAPS[a.asset.key], grossExtraUsd:a.asset.key === "bitcoin" ? input.btcDerivativeExposureUsd ?? 0 : 0 })) });
  const afterTotal = portfolioUsd + budgetUsd - allocation.costUsd;
  const rows: InvestmentRow[] = assessments.map(a => {
    const amountUsd = allocation.amounts[a.asset.key] ?? 0;
    return { key:a.asset.key, label:a.asset.label, symbol:a.asset.symbol, color:a.asset.color,
      targetWeight:OPPORTUNITY_CAPS[a.asset.key], currentWeight:portfolioUsd ? currentValues[a.asset.key]/portfolioUsd : 0,
      afterWeight:afterTotal ? (currentValues[a.asset.key]+amountUsd)/afterTotal : 0, contributionWeight: allocation.totalUsd ? amountUsd/allocation.totalUsd : 0,
      amountUsd, signal:a.opportunity.score, usable:a.quality.usable, opportunity:a.opportunity,
      reason:!a.quality.usable ? a.quality.reason : a.opportunity.reasons.join(" "), asOf:market[a.asset.key]?.quote?.asOf, source:market[a.asset.key]?.source };
  });
  const reserveUsedUsd = Math.max(0,allocation.investedUsd+allocation.costUsd-budgetUsd);
  rows.push({ key:"cash", label:"USDT / fırsat rezervi", color:"#8795a8", targetWeight:0,
    currentWeight:portfolioUsd ? currentValues.cash/portfolioUsd : 0,
    afterWeight:afterTotal ? (currentValues.cash+budgetUsd-allocation.investedUsd-allocation.costUsd)/afterTotal : 0,
    contributionWeight:allocation.totalUsd ? allocation.remainingUsd/allocation.totalUsd : 0, amountUsd:allocation.remainingUsd, signal:0, usable:true,
    reason:"Koşulları karşılamayan tutar rezervde kalır. Earn'e aktarım ve gerçek ödüller ayrıca kaydedilir; buradaki tutar yeni katkı ile seçilen mevcut kullanılabilir rezervin toplamından kalandır." });
  if (currentValues.bitcoin+(input.btcDerivativeExposureUsd ?? 0) > (portfolioUsd+budgetUsd)*.4) warnings.push("Bitcoin brüt maruziyeti %40 tavanını aşıyor; yeni BTC alımı yapılmaz. Mevcut pozisyon otomatik satılmaz.");
  if (!allocation.investedUsd && !blocked) warnings.push("Bugün doğrulanmış uygun fiyat girişi yok. Yeni katkı ve kullanılabilir rezerv fırsat bekliyor.");
  warnings.push("Yıllık ek katkı tahmini takvimdir; ödeme gelmeden bugünkü sermayeye eklenmez.");
  return { budgetUsd,portfolioUsd,costUsd:allocation.costUsd,rows,status:blocked ? "blocked" : profile.missing.length ? "draft" : "ready",warnings,generatedAt:now.toISOString(),method:OPPORTUNITY_VERSION,totalDeployableUsd:allocation.totalUsd,reserveUsedUsd };
}

function buildDcaMonthly(input: MonthlyInvestmentInput): MonthlyInvestment {
  const {policy, now, market, currentValues} = input;
  const budgetUsd = Math.round(input.budgetUsd * 100) / 100;
  const portfolioUsd = Object.values(currentValues).reduce((a,b)=>a+b,0);
  const reserveUsd = Math.min(currentValues.cash, Math.max(0,input.reserveAvailableUsd ?? 0));
  const totalCents = Math.round((budgetUsd + reserveUsd)*100);
  const profile = investmentProfileIssues(policy);
  const blocked = profile.blockers.length > 0 || !input.valuationComplete;
  const warnings = [...profile.blockers,...profile.missing];
  if (!input.valuationComplete) warnings.push("Mevcut portföy değerlenemedi; dağılım için fiyatları yenile.");
  const rate = policy.feeBps / 10000;
  const netCents = Math.floor(totalCents / (1+rate));
  const finalEquity = portfolioUsd + budgetUsd - Math.ceil(netCents*rate)/100;
  const deficits = INVESTMENT_ASSETS.map(a=>Math.max(0,finalEquity*policy.dcaWeights[a.key]-currentValues[a.key]));
  const totalDeficit = deficits.reduce((a,b)=>a+b,0);
  const amounts = INVESTMENT_ASSETS.map((a,i)=>blocked ? 0 : Math.floor(netCents*(policy.dcaAllocation === "rebalance" && totalDeficit>0 ? deficits[i]/totalDeficit : policy.dcaWeights[a.key])));
  const btcIndex = INVESTMENT_ASSETS.findIndex(a=>a.key === "bitcoin");
  const btcCapacity = Math.max(0,Math.floor((finalEquity*.4-currentValues.bitcoin-(input.btcDerivativeExposureUsd??0))*100));
  if (amounts[btcIndex] > btcCapacity) {
    const excess = amounts[btcIndex]-btcCapacity;
    amounts[btcIndex] = btcCapacity;
    const otherWeight = 1-policy.dcaWeights.bitcoin;
    INVESTMENT_ASSETS.forEach((a,i)=>{if(a.key!=="bitcoin" && otherWeight>0) amounts[i]+=Math.floor(excess*policy.dcaWeights[a.key]/otherWeight);});
    warnings.push("BTC brüt %40 sınırı nedeniyle yeni katkının aşan kısmı sepetin diğer varlıklarına dağıtıldı.");
  }
  amounts.forEach((n,i)=>{if(n<policy.minOrderUsd*100) amounts[i]=0;});
  const investedCents = amounts.reduce((a,b)=>a+b,0);
  const feeCents = Math.ceil(investedCents*rate-1e-8);
  const cashCents = totalCents-investedCents-feeCents;
  const after = portfolioUsd+budgetUsd-feeCents/100;
  const rows:InvestmentRow[] = INVESTMENT_ASSETS.filter(a=>policy.dcaWeights[a.key]>0 || currentValues[a.key]>0).map(a=>{
    const i=INVESTMENT_ASSETS.findIndex(item=>item.key===a.key),quote=market[a.key]?.quote;
    const usable=validQuote(quote,a.key==="bitcoin",now);
    return {key:a.key,label:a.label,symbol:a.symbol,color:a.color,targetWeight:policy.dcaWeights[a.key],currentWeight:portfolioUsd?currentValues[a.key]/portfolioUsd:0,afterWeight:after?(currentValues[a.key]+amounts[i]/100)/after:0,contributionWeight:totalCents?amounts[i]/totalCents:0,amountUsd:amounts[i]/100,signal:0,usable,asOf:quote?.asOf,source:quote?.source,
      reason:`${policy.dcaAllocation === "rebalance" ? `Hedef portföy payı %${+(policy.dcaWeights[a.key]*100).toFixed(2)}; mevcut pay %${+(portfolioUsd?currentValues[a.key]/portfolioUsd*100:0).toFixed(2)}. Yeni para hedefe uzaklığa göre bölünür; hedefin üzerindeki varlığa daha az alınır.` : `Her katkının %${+(policy.dcaWeights[a.key]*100).toFixed(2)} payı bu varlığa ayrılır.`} Düşüş veya teknik sinyal düzenli alımı tek başına durdurmaz.${usable?"":" Bu bir tutar planıdır; adet ve alım için güncel fiyatı doğrula."}`};
  });
  rows.push({key:"cash",label:"Kalan tutar",color:"#8795a8",targetWeight:0,currentWeight:portfolioUsd?currentValues.cash/portfolioUsd:0,afterWeight:after?(currentValues.cash+budgetUsd-(investedCents+feeCents)/100)/after:0,contributionWeight:totalCents?cashCents/totalCents:0,amountUsd:cashCents/100,signal:0,usable:true,reason:blocked?"Alımı engelleyen profil veya değerleme sorunu giderilene kadar bekler.":"Yalnız yuvarlama ve minimum işlem tutarından kalan bakiye. Düzenli USDT payı ayrılmaz."});
  return {budgetUsd,portfolioUsd,costUsd:feeCents/100,totalDeployableUsd:totalCents/100,reserveUsedUsd:Math.max(0,(investedCents+feeCents)/100-budgetUsd),rows,status:blocked?"blocked":profile.missing.length||rows.some(r=>!r.usable)?"draft":"ready",warnings,generatedAt:now.toISOString(),method:"monthly-dca-v2"};
}
