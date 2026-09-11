import { describe, expect, it, vi } from 'vitest';
import * as strategyModule from '../../bot/strategy';
import { BotStore } from './store';
import { runWorker } from './worker';

describe('standalone worker lifecycle', () => {
  it('processes a missing-strategy job without network and releases its lease', async () => {
    const store = new BotStore(':memory:');
    const strategy = vi.spyOn(strategyModule, 'getStrategy').mockReturnValue(null);
    try {
      store.enqueue('backtest', { instrument: 'BTC-USDT-SWAP', days: 30 });
      await runWorker({ store, once: true });
      expect(store.listJobs()[0].status).toBe('blocked');
      expect(store.workerStatus().online).toBe(false);
    } finally { strategy.mockRestore(); store.close(); }
  });
  it('does not displace another healthy worker', async () => {
    const store = new BotStore(':memory:');
    try {
      store.acquireLease('other');
      await expect(runWorker({ store, once: true })).rejects.toThrow(/zaten/);
      expect(store.workerStatus().online).toBe(true);
    } finally { store.close(); }
  });
});
