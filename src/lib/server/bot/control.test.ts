import { describe, expect, it } from 'vitest';
import { BotStore } from './store';

describe('observable bot jobs', () => {
  it('deduplicates repeated scans and prioritizes emergency over historical work', () => {
    const store = new BotStore(':memory:');
    try {
      const first = store.enqueue('scan', {});
      expect(store.enqueue('scan', {}).id).toBe(first.id);
      store.enqueue('comparison', { days: 90 });
      const emergency = store.enqueue('scan', { emergency: true });
      store.acquireLease('worker');
      expect(store.claimJob('worker')?.id).toBe(emergency.id);
      expect(store.claimJob('worker', Date.now(), true)?.kind).toBe('scan');
      expect(store.claimJob('worker', Date.now(), true)).toBeNull();
    } finally { store.close(); }
  });
  it('persists bounded start requests and lease-fenced progress', () => {
    const store = new BotStore(':memory:');
    try {
      expect(store.requestWorkerStart()).toBe(true);
      expect(store.requestWorkerStart()).toBe(false);
      store.acquireLease('worker');
      const progress = { kind: 'scan' as const, state: 'running' as const, current: 1, total: 5, message: 'BTC inceleniyor' };
      store.saveProgress('worker', progress);
      expect(store.getProgress()).toMatchObject(progress);
      expect(() => store.saveProgress('other', progress)).toThrow();
    } finally { store.close(); }
  });
});
