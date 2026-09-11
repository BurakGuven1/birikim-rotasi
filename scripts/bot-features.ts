/**
 * Does any entry-bar feature separate winning trades from losing ones?
 *
 * This tests the core claim behind sweep/reclaim confirmation oscillators (wick quality, volume
 * expansion, sweep depth, volatility regime): that a "higher quality" setup follows through more
 * often. It reads trades that were already produced by a research run and recomputes the features
 * from the cached candles at each entry bar. No new data is fetched.
 *
 * A feature that does not separate expectancy across quintiles cannot improve the strategy, no
 * matter how elaborate the indicator that computes it.
 */
import { readFile } from 'node:fs/promises';
import { OkxClient } from '../src/lib/server/okx/client';
import { loadResearchData } from '../src/lib/server/okx/research-data';
import { priorAtr } from '../src/lib/bot/mpa';
import { intervals, duration, type Candle, type Interval, type Position } from '../src/lib/bot/types';

const client = new OkxClient({ mode: 'public' });
const ids = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP', 'XRP-USDT-SWAP', 'ADA-USDT-SWAP'];
const summary = JSON.parse(await readFile('artifacts/bot-research-mpa-365/summary.json', 'utf8')) as { from: number; to: number };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

type Sample = { R: number; features: Record<string, number> };
const samples: Sample[] = [];

for (const id of ids) {
  const data = await loadResearchData(client, id, { from: summary.from, to: summary.to });
  for (const interval of intervals) {
    let trades: Position[];
    try { trades = (JSON.parse(await readFile(`artifacts/bot-research/${id}-${interval}.json`, 'utf8')) as { trades: Position[] }).trades; }
    catch { continue; }
    const bars = data.frames[interval as Interval];
    const index = new Map(bars.map((bar, i) => [bar.time, i]));
    for (const trade of trades) {
      // The signal fires on the bar that closed immediately before the entry timestamp.
      const at = index.get(trade.openedAt - duration[interval]);
      if (at === undefined || at < 60) continue;
      const bar = bars[at], prior: Candle[] = bars.slice(at - 50, at);
      const atr = priorAtr(bars, at);
      const risk = Math.abs(trade.entry - trade.initialStop) * trade.quantity;
      if (!(atr > 0) || !(risk > 0)) continue;
      const sign = trade.direction === 'long' ? 1 : -1;
      const range = bar.high - bar.low;
      const volumes = prior.map(b => b.volume).filter(v => v > 0);
      const spread = mean(volumes.map(v => Math.abs(v - mean(volumes))));
      samples.push({ R: trade.realizedPnl / risk, features: {
        // Reclaim wick: how much of the entry bar rejected the swept side.
        fitilSkoru: range > 0 ? (sign > 0 ? bar.close - bar.low : bar.high - bar.close) / range : 0,
        // Sweep depth beyond the prior extreme, in ATR.
        sweepDerinligi: Math.abs(bar.low - Math.min(...prior.slice(-25).map(b => b.low))) / atr,
        // Volume expansion of the signal bar against its own recent regime.
        hacimZ: spread > 0 ? (bar.volume - mean(volumes)) / spread : 0,
        // Volatility regime: is the market moving enough to pay for costs?
        volatiliteRejimi: atr / mean(prior.map(b => priorAtr(bars, at - prior.length + prior.indexOf(b))).filter(Number.isFinite)),
        // Body dominance of the confirming candle.
        govdeOrani: range > 0 ? Math.abs(bar.close - bar.open) / range : 0,
        // Risk width relative to price: the cost-exposure proxy.
        stopGenisligi: Math.abs(trade.entry - trade.initialStop) / trade.entry * 100,
      } });
    }
  }
}

console.log(`Ornek sayisi: ${samples.length} islem`);
console.log(`Genel beklenti: ${mean(samples.map(s => s.R)).toFixed(3)}R, kazanan orani %${(100 * samples.filter(s => s.R > 0).length / samples.length).toFixed(1)}\n`);
for (const feature of Object.keys(samples[0].features)) {
  const valid = samples.filter(s => Number.isFinite(s.features[feature])).sort((a, b) => a.features[feature] - b.features[feature]);
  const size = Math.floor(valid.length / 5);
  if (size < 20) continue;
  const rows = Array.from({ length: 5 }, (_, q) => {
    const bucket = valid.slice(q * size, q === 4 ? valid.length : (q + 1) * size);
    return `Q${q + 1}: ${mean(bucket.map(s => s.R)).toFixed(3)}R (%${(100 * bucket.filter(s => s.R > 0).length / bucket.length).toFixed(0)} kazanma, deger<=${bucket.at(-1)!.features[feature].toFixed(2)})`;
  });
  const spread = Math.max(...rows.map((_, q) => mean(valid.slice(q * size, q === 4 ? valid.length : (q + 1) * size).map(s => s.R)))) -
                 Math.min(...rows.map((_, q) => mean(valid.slice(q * size, q === 4 ? valid.length : (q + 1) * size).map(s => s.R))));
  console.log(`${feature}  [Q1..Q5 beklenti farki: ${spread.toFixed(3)}R]`);
  for (const row of rows) console.log('   ' + row);
  console.log();
}
