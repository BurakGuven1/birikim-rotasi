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
export function exponentialMovingAverage(values: number[], period: number): Array<number | null> {
  if (!Number.isInteger(period) || period < 1) throw new Error("Invalid EMA period");
  let previous = 0;
  return values.map((value, index) => {
    if (index < period - 1) return null;
    previous = index === period - 1 ? values.slice(0, period).reduce((a,b)=>a+b,0)/period : value*2/(period+1)+previous*(1-2/(period+1));
    return previous;
  });
}

export function relativeStrengthIndex(values: number[], period = 14): Array<number | null> {
  let gain=0, loss=0;
  return values.map((v,i)=>{
    if (!i) return null;
    const d=v-values[i-1];
    if(i<=period){gain+=Math.max(d,0)/period;loss+=Math.max(-d,0)/period;}
    else {gain=(gain*(period-1)+Math.max(d,0))/period;loss=(loss*(period-1)+Math.max(-d,0))/period;}
    return i<period ? null : loss===0 ? gain===0 ? 50 : 100 : 100-100/(1+gain/loss);
  });
}

export function averageTrueRange(bars: {high:number;low:number;close:number}[], period=14): Array<number|null> {
  let atr=0;
  return bars.map((bar,i)=>{
    const tr=i ? Math.max(bar.high-bar.low,Math.abs(bar.high-bars[i-1].close),Math.abs(bar.low-bars[i-1].close)) : bar.high-bar.low;
    atr=i<period ? atr+tr/period : (atr*(period-1)+tr)/period;
    return i<period-1 ? null : atr;
  });
}

export function movingAverageConvergenceDivergence(values:number[], fast=12, slow=26, signalPeriod=9) {
  const f=exponentialMovingAverage(values,fast), s=exponentialMovingAverage(values,slow);
  const macd=values.map((_,i)=>f[i]===null||s[i]===null?null:f[i]!-s[i]!);
  const valid=macd.filter((v):v is number=>v!==null), signalValues=exponentialMovingAverage(valid,signalPeriod);
  let cursor=0;
  const signal=macd.map(v=>v===null?null:signalValues[cursor++]);
  return {macd,signal,histogram:macd.map((v,i)=>v===null||signal[i]===null?null:v-signal[i]!)};
}
