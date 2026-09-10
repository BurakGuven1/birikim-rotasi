import { mkdir, writeFile } from 'node:fs/promises';
import { OkxClient } from '../src/lib/server/okx/client';
import { getUniverse } from '../src/lib/server/okx/market';
import { latestClosedTime, loadResearchData } from '../src/lib/server/okx/research-data';
import { runEthMomentum, defaultEthMomentumSettings } from '../src/lib/bot/eth-momentum';

const arg = (name: string, fallback: number) => {
  const raw = process.argv.find(a => a.startsWith(`--${name}=`));
  return raw ? Number(raw.slice(name.length + 3)) : fallback;
};
const client = new OkxClient({ mode: 'public' });
const id = 'ETH-USDT-SWAP';
const days = arg('days', 365);
// Floored to the UTC day unless pinned. Taking the exchange clock straight would move the window
// every fifteen minutes, changing the market-cache key and re-downloading a year of 15m candles on
// every run — and quietly measuring a different period each time.
const pinned = process.argv.find(a => a.startsWith('--to='))?.slice(5);
const latest = await latestClosedTime(client);
const to = pinned ? Date.parse(pinned) : Math.floor(latest / 86_400_000) * 86_400_000;
if (!Number.isSafeInteger(to) || to <= 0 || to > latest) throw new Error('--to geçersiz veya borsa saatinin ilerisinde');
const from = to - days * 86_400_000;
const instrument = (await getUniverse(client)).find(i => i.id === id);
if (!instrument) throw new Error('ETH-USDT-SWAP bulunamadı');
console.log(`${id} · ${days} gün · ${new Date(from).toISOString().slice(0, 10)} → ${new Date(to).toISOString().slice(0, 10)}`);
const data = await loadResearchData(client, id, { from, to, frames: ['15m', '1H', '1Dutc'] });
// The daily regime needs a 200-bar EMA and a 100-bar average of a 14-bar ATR before it says
// anything at all. The shared loader only prefetches 80 daily bars, so the first four months of
// any window would sit blocked with no entries and the study would quietly measure a shorter
// period than it claims. The daily series is therefore fetched again with its own lookback.
const deep = await loadResearchData(client, id, { from: from - 320 * 86_400_000, to, frames: ['1Dutc'] });
const barsDaily = deep.frames.bias!.daily;
console.log(`mumlar: 15m=${data.frames['15m'].length} 1H=${data.frames['1H'].length} günlük=${barsDaily.length} (rejim ısınması için ${barsDaily.length - data.frames.bias!.daily.length} ek gün)`);

const f = (v: number | null, d = 2) => v === null ? '   -  ' : v.toFixed(d).padStart(8);
for (const [label, overrides] of [
  ['script varsayımı · komisyon %0,1', { commissionPercent: .1 }],
  ['OKX taker · komisyon %0,05', { commissionPercent: .05 }],
] as const) {
  for (const leverage of [1, 5]) {
    const settings = { ...defaultEthMomentumSettings, initialEquity: 356.31, leverage, ...overrides };
    const result = runEthMomentum({ instrument, bars15m: data.frames['15m'], bars1H: data.frames['1H'], barsDaily, settings, from, to });
    const m = result.metrics;
    console.log(`${label} · ${leverage}x  n=${String(m.trades).padStart(3)} net=${f(m.netPnl, 1)} (%${f(m.returnPercent, 1)}) PF=${f(m.profitFactor)} WR=${f(m.winRate, 1)} DD=%${f(m.maxDrawdownPercent, 1)} komisyon=${f(m.fees, 1)}`);
    if (leverage === 5 && overrides.commissionPercent === .1) {
      await mkdir('artifacts/eth-momentum', { recursive: true });
      await writeFile('artifacts/eth-momentum/result.json', JSON.stringify(result, null, 2));
      console.log('  engeller:', Object.entries(result.blocked).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '));
    }
  }
}
