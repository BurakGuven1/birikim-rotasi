import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { OkxClient } from '../src/lib/server/okx/client';
import { getUniverse } from '../src/lib/server/okx/market';
import { latestClosedTime, loadResearchData } from '../src/lib/server/okx/research-data';
import { validatedBacktest } from '../src/lib/bot/validation';
import { createMpaStrategy } from '../src/lib/bot/strategy';
import { createDonchianStrategy } from '../src/lib/bot/reference';
import { createSupertrendStrategy } from '../src/lib/bot/supertrend';
import { createTrendFilteredMpaStrategy } from '../src/lib/bot/combined';
import { createEfloudStrategy } from '../src/lib/bot/efloud';
import { intervals } from '../src/lib/bot/types';
import { defaultBotSettings } from '../src/lib/bot/config';
import { BotStore } from '../src/lib/server/bot/store';

const client = new OkxClient({ mode: 'public' });
const previous = process.argv.includes('--fresh') ? null : await readFile('artifacts/bot-research/summary.json', 'utf8').then(text => JSON.parse(text) as { to: number }).catch(() => null);
const daysArg = process.argv.find(a => a.startsWith('--days='));
const days = daysArg ? Number(daysArg.slice(7)) : 90;
if (!Number.isFinite(days) || days < 7 || days > 1200) throw new Error('--days must be 7..1200');
const numberArg = (name: string, fallback: number) => {
  const raw = process.argv.find(a => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.slice(name.length + 3));
  if (!Number.isFinite(value)) throw new Error(`--${name} must be numeric`);
  return value;
};
// Cost assumptions are the dominant lever, so they are explicit inputs of a research run.
const settings = { ...defaultBotSettings, feeBps: numberArg('fee', defaultBotSettings.feeBps), slippageBps: numberArg('slip', defaultBotSettings.slippageBps), maxCostSharePercent: numberArg('costshare', defaultBotSettings.maxCostSharePercent), minRewardRisk: numberArg('minrr', defaultBotSettings.minRewardRisk) };
const to = previous?.to ?? await latestClosedTime(client), from = to - days * 86_400_000;
const universe = await getUniverse(client);
const listArg = process.argv.find(a => a.startsWith('--symbols='))?.slice(10);
const defaultIds = listArg
  ? listArg.split(',').map(v => `${v.trim().toUpperCase()}-USDT-SWAP`)
  : ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP', 'XRP-USDT-SWAP', 'ADA-USDT-SWAP'];
// A wider universe is the only way to grow the sample enough to judge a low-frequency 4H model.
const coinCount = numberArg('coins', 0);
const ids = coinCount > 0
  ? universe.filter(i => (i.volumeUsdt ?? 0) > 0).sort((a, b) => (b.volumeUsdt ?? 0) - (a.volumeUsdt ?? 0)).slice(0, coinCount).map(i => i.id)
  : defaultIds;
const results: Record<string, unknown>[] = [];
await mkdir('artifacts/bot-research', { recursive: true });
console.log(JSON.stringify({ period: { from: new Date(from).toISOString(), to: new Date(to).toISOString() }, entryIntervals: intervals, settings }));
for (const id of ids) {
  console.log(`${id}: public history loading`);
  try {
    const instrument = universe.find(i => i.id === id);
    if (!instrument) throw new Error('instrument_missing');
    // A 4H study only needs 4H context plus its execution frame, and OKX serves those far further
    // back than 15m, so the usable history and the usable universe both grow.
    const execution = (process.argv.find(a => a.startsWith('--exec='))?.slice(7) ?? '15m') as '15m' | '1H';
    // Weekly is part of the bias set a strategy may require, so it is always fetched; leaving it out
    // makes closedContext report "not ready" for every bar and the study reports a silent zero.
    const frames: ('15m' | '1H' | '4H' | '1Dutc' | '1Wutc')[] = execution === '15m'
      ? ['15m', '1H', '4H', '1Dutc', '1Wutc']
      : ['1H', '4H', '1Dutc', '1Wutc'];
    const data = await loadResearchData(client, id, { from, to, frames });
    // One dataset per coin replays all three entry timeframes over the identical period and settings.
    // The reference control runs on the identical dataset, period and settings as the traded model.
    const models = process.argv.includes('--efloud') ? [{ name: 'efloud', make: createEfloudStrategy }]
      : process.argv.includes('--all') ? [{ name: 'supertrend', make: createSupertrendStrategy }, { name: 'combined', make: createTrendFilteredMpaStrategy }, { name: 'mpa', make: createMpaStrategy }]
      : process.argv.includes('--supertrend') ? [{ name: 'supertrend', make: createSupertrendStrategy }]
      : process.argv.includes('--reference') ? [{ name: 'donchian', make: createDonchianStrategy }]
      : [{ name: 'mpa', make: createMpaStrategy }];
    const only = process.argv.find(a => a.startsWith('--intervals='))?.slice(12).split(',').map(v => v.trim());
    const chosen = only?.length ? intervals.filter(i => only.includes(i)) : intervals;
    for (const { name, make } of models) for (const interval of chosen) {
      const built = make(interval);
      // A frame that was never fetched cannot be a readiness requirement, or the context is never
      // ready and the study silently reports zero trades instead of failing loudly.
      const strategy = execution === '15m' ? built : { ...built, warmup: { ...built.warmup, '15m': 0 } };
      const result = validatedBacktest({ ...data, instrument, strategy, settings, from, to, executionInterval: execution });
      result.warnings.push(...data.warnings);
      await writeFile(`artifacts/bot-research/${id}-${name}-${interval}.json`, JSON.stringify(result, null, 2));
      const store = new BotStore(), owner = `research:${randomUUID()}`;
      try {
        if (store.acquireLease(owner)) { store.saveBacktest(owner, result); store.releaseLease(owner); }
        else console.log(`${id} ${name} ${interval}: worker busy; result saved to artifact only`);
      } finally { store.close(); }
      const row = { instrument: id, model: name, entryInterval: interval, metrics: result.metrics, validation: result.validation, diagnostics: result.diagnostics, warnings: result.warnings };
      results.push(row); console.log(JSON.stringify(row));
    }
  } catch (error) {
    const failure = { instrument: id, error: error instanceof Error ? error.message : 'unknown' };
    results.push(failure); console.log(JSON.stringify(failure));
  }
  await writeFile('artifacts/bot-research/summary.json', JSON.stringify({ from, to, results }, null, 2));
}
process.exitCode = results.some(result => typeof result.error === 'string') ? 1 : 0;
