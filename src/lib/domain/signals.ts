import { percentileRank, simpleMovingAverage, volatilityNormalizedDistance } from "./indicators";
import type { PricePoint } from "./types";

export interface PriceSignal {
  score: number;
  confidence: number;
  distanceFromLongAverage: number;
  drawdownFromAth: number;
  mediumTrend: number;
  fallingKnife: boolean;
  weeklySma200?: number;
  m2Percentile?: number;
  crossedAboveSma200?: boolean;
  reasons: string[];
}

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const clamp = (value: number, min = -1, max = 1) => Math.min(max, Math.max(min, value));

export function derivePriceSignal(closes: number[], volatilityScale = 1): PriceSignal {
  const valid = closes.filter((value) => Number.isFinite(value) && value > 0);
  if (valid.length < 20) return { score: 0, confidence: valid.length / 20, distanceFromLongAverage: 0, drawdownFromAth: 0, mediumTrend: 0, fallingKnife: false, reasons: ["Uzun dönem sinyali için veri yetersiz."] };
  const longPeriod = Math.min(200, valid.length);
  const mediumPeriod = Math.min(40, Math.floor(valid.length / 2));
  const current = valid.at(-1)!;
  const longAverage = average(valid.slice(-longPeriod));
  const currentMedium = average(valid.slice(-mediumPeriod));
  const priorMedium = average(valid.slice(-mediumPeriod * 2, -mediumPeriod));
  const mediumTrend = priorMedium > 0 ? currentMedium / priorMedium - 1 : 0;
  const ath = Math.max(...valid);
  const drawdownFromAth = current / ath - 1;
  const rawDistance = volatilityNormalizedDistance(valid.slice(-longPeriod), longPeriod) / Math.max(0.5, volatilityScale);
  const distanceFromLongAverage = current / longAverage - 1;
  const valueScore = Math.abs(distanceFromLongAverage) < 0.05 ? 0 : clamp(-rawDistance / 3);
  const drawdownScore = clamp(-drawdownFromAth / 0.45, 0, 1);
  const trendScore = clamp(mediumTrend / 0.15);
  const fallingKnife = current < longAverage * 0.9 && mediumTrend < -0.04;
  let score = valueScore * 0.55 + drawdownScore * 0.25 + trendScore * 0.2;
  if (fallingKnife) score = Math.min(score, 0.3);
  const reasons = [
    `Uzun ortalamaya uzaklık %${(distanceFromLongAverage * 100).toFixed(1)}.`,
    `Zirveden değişim %${(drawdownFromAth * 100).toFixed(1)}.`,
    `Orta vadeli eğim %${(mediumTrend * 100).toFixed(1)}.`,
  ];
  if (fallingKnife) reasons.push("Düşen bıçak filtresi alım artışını sınırladı.");
  return { score: clamp(score), confidence: Math.min(1, valid.length / 200), distanceFromLongAverage, drawdownFromAth, mediumTrend, fallingKnife, reasons };
}

export function deriveBitcoinMacroSignal(weeklyPrices: PricePoint[], m2Series: PricePoint[]): PriceSignal {
  const prices = [...weeklyPrices].filter((point) => point.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  const m2 = [...m2Series].filter((point) => point.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  const priceOnly = derivePriceSignal(prices.map((point) => point.close), 1.8);
  if (prices.length < 200 || m2.length < 12) return { ...priceOnly, reasons: [...priceOnly.reasons, "BTC/M2 için yeterli tarihsel veri yok."] };

  let m2Index = 0;
  let lastM2: PricePoint | undefined;
  const ratios: number[] = [];
  prices.forEach((point) => {
    const priceTime = new Date(point.date).getTime();
    while (m2Index < m2.length && new Date(m2[m2Index].date).getTime() + 45 * 86_400_000 <= priceTime) {
      lastM2 = m2[m2Index];
      m2Index += 1;
    }
    if (lastM2) ratios.push(point.close / lastM2.close);
  });
  if (ratios.length < 20) return { ...priceOnly, reasons: [...priceOnly.reasons, "BTC/M2 eşleşmesi yetersiz."] };

  const currentRatio = ratios.at(-1)!;
  const m2Percentile = percentileRank(ratios, currentRatio);
  const m2ValueScore = clamp((0.5 - m2Percentile) * 2);
  const closes = prices.map((point) => point.close);
  const smaSeries = simpleMovingAverage(closes, 200);
  const weeklySma200 = smaSeries.at(-1)!;
  const aboveSma200 = closes.at(-1)! >= weeklySma200!;
  const crossedAboveSma200 = aboveSma200 && closes.slice(-12).some((close, index) => {
    const sma = smaSeries[smaSeries.length - 12 + index];
    return sma != null && close <= sma;
  });
  const regimeScore = aboveSma200 ? 0.35 : -0.35;
  let score = priceOnly.score * 0.55 + m2ValueScore * 0.3 + regimeScore * 0.15 + (crossedAboveSma200 ? 0.12 : 0);
  if (priceOnly.fallingKnife) score = Math.min(score, 0.25);
  const reasons = [
    ...priceOnly.reasons,
    m2Percentile <= 0.35
      ? `BTC/M2 tarihsel yüzdesi %${(m2Percentile * 100).toFixed(0)}; düşük dilim göreli ucuzluğu destekliyor (M2 verisi 45 gün gecikmeli kullanıldı).`
      : m2Percentile >= 0.65
        ? `BTC/M2 tarihsel yüzdesi %${(m2Percentile * 100).toFixed(0)}; yüksek dilim tarihsel olarak ucuz görünmüyor (M2 verisi 45 gün gecikmeli kullanıldı).`
        : `BTC/M2 tarihsel yüzdesi %${(m2Percentile * 100).toFixed(0)}; gösterge nötr bölgede (M2 verisi 45 gün gecikmeli kullanıldı).`,
    `Fiyat 200 haftalık ortalamanın %${((closes.at(-1)! / weeklySma200! - 1) * 100).toFixed(1)} ${aboveSma200 ? "üzerinde" : "altında"}.`,
  ];
  if (crossedAboveSma200) reasons.push("200 haftalık ortalama son 12 haftada yukarı aşıldı.");
  return {
    ...priceOnly,
    score: clamp(score),
    confidence: Math.min(priceOnly.confidence, ratios.length / 200),
    weeklySma200: weeklySma200!,
    m2Percentile,
    crossedAboveSma200,
    reasons,
  };
}
