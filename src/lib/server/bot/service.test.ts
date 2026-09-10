import { describe, expect, it, vi } from 'vitest';
import * as strategyModule from '../../bot/strategy';
import { BotStore } from './store';
import { snapshot, handleCommand, processJob, emergencyQuote } from './service';
import { defaultBotSettings } from '../../bot/config';

describe('bot control service', () => {
  it('rejects missing, nonnumeric and future emergency quote timestamps', () => {
    expect(() => emergencyQuote({ bidPx: '100', askPx: '101' }, 'long', 100000)).toThrow();
    expect(() => emergencyQuote({ bidPx: '100', askPx: '101', ts: 'bad' }, 'long', 100000)).toThrow();
    expect(() => emergencyQuote({ bidPx: '100', askPx: '101', ts: '111000' }, 'long', 100000)).toThrow();
    expect(emergencyQuote({ bidPx: '100', askPx: '101', ts: '99000' }, 'short', 100000)).toBe(101);
  });
  it('blocks unknown live enable commands and never invents strategy results', async () => {
    const store = new BotStore(':memory:');
    const strategy = vi.spyOn(strategyModule, 'getStrategy').mockReturnValue(null);
    try {
      expect(() => handleCommand(store, { action: 'mode', mode: 'live' })).toThrow();
      const job = store.enqueue('backtest', { instrument: 'BTC-USDT-SWAP', days: 30 });
      store.acquireLease('worker');
      const claimed = store.claimJob('worker')!;
      await processJob(store, 'worker', claimed);
      expect(store.listJobs().find(j => j.id === job.id)?.status).toBe('blocked');
      expect(store.listBacktests()).toEqual([]);
      expect(snapshot(store).strategy).toBeNull();
    } finally { strategy.mockRestore(); store.close(); }
  });
  it('persists validated risk settings and rejects out-of-budget leverage', () => {
    const store = new BotStore(':memory:');
    try {
      handleCommand(store, { action: 'settings', settings: { ...defaultBotSettings, leverage: 10 } });
      expect(snapshot(store).settings.leverage).toBe(10);
      expect(() => handleCommand(store, { action: 'settings', settings: { ...defaultBotSettings, leverage: 50 } })).toThrow();
    } finally { store.close(); }
  });
  it('does not expose API values in status', () => {
    const store = new BotStore(':memory:');
    try {
      const result = snapshot(store, { OKX_API_KEY: 'secret-fixture-key', OKX_API_SECRET: 'secret-fixture-value' });
      expect(result.credentials.live.missing).toEqual(['OKX_API_PASSPHRASE']);
      expect(JSON.stringify(result)).not.toContain('secret-fixture');
    } finally { store.close(); }
  });
});
