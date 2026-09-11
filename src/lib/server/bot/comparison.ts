import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { strategyVariants } from '../../bot/strategy';
import { validatedBacktest } from '../../bot/validation';
import { strategyModels, liveInterval } from '../../bot/strategy';
import { type BotSettings, type Interval, type Strategy } from '../../bot/types';
import type { BotComparison } from '../../bot/dashboard-types';
import { OkxClient } from '../okx/client';
import { getUniverse } from '../okx/market';
import { latestClosedTime, loadResearchData } from '../okx/research-data';
import type { OkxInterval } from '../okx/market';
import type { BotStore } from './store';

/**
 * The frames a set of variants actually needs.
 *
 * closedContext treats an empty bias series as missing data, not as an unused one, so a model that
 * requires the higher-timeframe bias reports "not ready" on every single bar when the weekly frame
 * was never fetched. That failure is silent: the run completes and every row reads "no trades",
 * which is indistinguishable from a model that simply found nothing.
 */
export function researchFrames(variants: { strategy: Strategy }[]): OkxInterval[] {
  // 15m is not fetched: the roster is 1H only, and OKX serves 15m over a far shorter span than the
  // coarser frames, so asking for it is what caps a multi-year comparison at a few months.
  const base: OkxInterval[] = ['1H', '4H', '1Dutc'];
  return variants.some(variant => variant.strategy.requireBias !== false) ? [...base, '1Wutc'] : base;
}

/** Thrown when the operator stops a run; it must escape the per-coin catch, not be logged as a coin failure. */
export class BotCancelled extends Error {}

/** The traded entry interval: the operator's explicit choice, otherwise the live strategy's own. */
export function selectedInterval(settings: BotSettings, live: Strategy): Interval {
  // Only 1H survived the three-year study, so 'auto' resolves to it rather than searching per coin:
  // picking an interval from each contract's own backtest is selection on past results, not evidence.
  if (settings.entryInterval === 'auto') return live.entryInterval ?? liveInterval;
  return settings.entryInterval;
}

export async function researchWindow(store: BotStore, ids: string[], days: number, client: OkxClient) {
  const latest = await latestClosedTime(client);
  const candidates = store.listBacktests().filter(r => r.from && r.to && r.to <= latest && latest - r.to < 86_400_000 && r.to - r.from === days * 86_400_000);
  const comparison = store.getComparison();
  if (comparison && comparison.to <= latest && latest - comparison.to < 86_400_000 && comparison.to - comparison.from === days * 86_400_000) candidates.unshift({ from: comparison.from, to: comparison.to } as typeof candidates[number]);
  const cached = candidates.map(r => ({ from: r.from!, to: r.to!, count: ids.filter(id => {
    const key = createHash('sha256').update(`v1:${id}:${r.from}:${r.to}`).digest('hex');
    return existsSync(resolve('.bot-data', 'market-cache', key + '.json'));
  }).length })).sort((a, b) => b.count - a.count || b.to - a.to)[0];
  return cached?.count ? { from: cached.from, to: cached.to } : { from: latest - days * 86_400_000, to: latest };
}

export async function runComparison(store: BotStore, owner: string, ids: string[], days: number, jobId = ''): Promise<BotComparison> {
  const client = new OkxClient({ mode: 'public' }), settings = store.getSettings();
  const variants = strategyVariants();
  const total = ids.length * variants.length;
  const progress = (message: string, current: number, state: 'running' | 'done' | 'failed' = 'running') => store.saveProgress(owner, { kind: 'comparison', state, message, current, total });
  progress('Karşılaştırma hazırlanıyor…', 0);
  const period = await researchWindow(store, ids, days, client);
  const comparison: BotComparison = { id: randomUUID(), createdAt: Date.now(), ...period, rows: [], errors: [] };
  store.saveComparison(owner, comparison);
  const universe = await getUniverse(client);
  let current = 0;
  for (const id of ids) {
    progress(`${id.replace('-USDT-SWAP', '')}: geçmiş veriler yükleniyor`, current);
    try {
      const instrument = universe.find(i => i.id === id);
      if (!instrument) throw new Error('Sözleşme aktif kripto evreninde bulunamadı.');
      // Only the frames the models read are fetched, which is also what lets a multi-year window
      // run at all: OKX serves 15m for a far shorter span than 1H and above.
      const data = await loadResearchData(client, id, { ...period, frames: researchFrames(variants) });
      for (const { model, interval, strategy } of variants) {
        if (jobId && store.cancelled(jobId)) throw new BotCancelled('Karşılaştırma durduruldu.');
        progress(`${id.replace('-USDT-SWAP', '')} · ${strategyModels[model].label} ${interval}`, current);
        // Fills are walked on the entry frame itself, which is what makes the same three-year window
        // the research script uses reproducible from this panel.
        const executed = { ...strategy, warmup: { ...strategy.warmup, '15m': 0 } };
        const result = validatedBacktest({ ...data, instrument, strategy: executed, settings, ...period, executionInterval: '1H' });
        result.warnings.push(...data.warnings, 'Bu sürüm geçmiş veride araştırma karşılaştırmasıdır; ileri paper doğrulaması gerekli.');
        comparison.rows.push(result);
        store.saveBacktest(owner, result);
        store.saveComparison(owner, comparison);
        progress(`${id.replace('-USDT-SWAP', '')} · ${interval}: ${result.metrics.trades} işlem`, ++current);
        // Yield for heartbeat and independent position monitoring.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } catch (error) {
      if (error instanceof BotCancelled) throw error;
      comparison.errors.push({ instrument: id, message: 'Geçmiş veri veya hesaplama tamamlanamadı; yeniden dene.' });
      current += variants.length - comparison.rows.filter(r => r.instrument === id).length;
      store.saveComparison(owner, comparison);
    }
  }
  progress(comparison.errors.length ? `${comparison.rows.length}/${total} sonuç hazır; ${comparison.errors.length} coin yeniden denenmeli.` : `${total} karşılaştırma tamamlandı.`, total, comparison.rows.length ? 'done' : 'failed');
  return comparison;
}
