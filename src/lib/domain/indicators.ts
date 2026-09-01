export function simpleMovingAverage(values: number[], period: number): Array<number | null> {
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error("Pozitif bir SMA periyodu gerekli.");
  }
  let rolling = 0;
  return values.map((value, index) => {
    rolling += value;
    if (index >= period) rolling -= values[index - period];
    return index < period - 1 ? null : rolling / period;
  });
}

export function percentileRank(values: number[], value: number): number {
  if (values.length < 2) return 0.5;
  const below = values.filter((candidate) => candidate < value).length;
  const equal = values.filter((candidate) => candidate === value).length;
  return Math.min(1, Math.max(0, (below + Math.max(0, equal - 1) / 2) / (values.length - 1)));
}

export function volatilityNormalizedDistance(values: number[], period: number): number {
  if (values.length < period || period < 2) return 0;
  const window = values.slice(-period);
  const average = window.reduce((sum, current) => sum + current, 0) / window.length;
  if (average <= 0 || window.at(-1)! <= 0) return 0;
  const returns = window.slice(1).map((current, index) => Math.log(current / window[index]));
  const mean = returns.reduce((sum, current) => sum + current, 0) / returns.length;
  const variance = returns.reduce((sum, current) => sum + (current - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  const volatility = Math.sqrt(variance);
  const distance = Math.log(window.at(-1)! / average);
  if (volatility === 0) return distance === 0 ? 0 : Math.sign(distance);
  return distance / volatility;
}

export function annualizedVolatility(values: number[], periodsPerYear = 52): number {
  if (values.length < 3) return 0;
  const returns = values.slice(1).map((value, index) => value / values[index] - 1);
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(periodsPerYear);
}
