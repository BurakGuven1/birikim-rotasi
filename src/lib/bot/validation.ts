import { runBacktest } from './backtest';
import type { BacktestResult } from './types';

/** Fixed chronological split. No parameter search or test-period coin selection. */
export function validatedBacktest(input: Parameters<typeof runBacktest>[0]): BacktestResult {
  const result = runBacktest(input);
  const from = input.from ?? result.from!, to = input.to ?? result.to!;
  const split = Math.floor((from + (to - from) * 2 / 3) / 3_600_000) * 3_600_000;
  const development = runBacktest({ ...input, from, to: split }).metrics;
  const holdout = runBacktest({ ...input, from: split, to }).metrics;
  const reasons: string[] = [];
  if (holdout.trades < 100) reasons.push('Ayrılmış testte en az 100 işlem gerekli.');
  if (holdout.winRate === null) reasons.push('İşlem olmadığından kazanma oranı ölçülemedi.');
  else if (holdout.winRate < 60) reasons.push('Ayrılmış test kazanma oranı %60 altında.');
  if (!(holdout.expectancy !== null && holdout.expectancy > 0)) reasons.push('Maliyet sonrası pozitif beklenti kanıtlanmadı.');
  if (!(holdout.profitFactor !== null && holdout.profitFactor >= 1.3)) reasons.push('Kâr faktörü 1,30 eşiğini doğrulamadı.');
  if (holdout.maxDrawdownPercent > 10) reasons.push('Maksimum düşüş %10 sınırını aştı.');
  if (!input.fundingComplete) reasons.push('Funding maliyet geçmişi eksik.');
  result.validation = { split, development, holdout, passed: reasons.length === 0, reasons };
  // Historical screening alone never authorizes real exchange orders.
  result.eligible = false;
  return result;
}
