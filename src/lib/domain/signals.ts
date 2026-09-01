import { volatilityNormalizedDistance } from "./indicators";

export interface PriceSignal {
  score: number;
  confidence: number;
  distanceFromLongAverage: number;
  drawdownFromAth: number;
  mediumTrend: number;
  fallingKnife: boolean;
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
