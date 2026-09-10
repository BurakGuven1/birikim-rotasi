import { describe, expect, it } from 'vitest';
import { BotStore } from './store';
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DemoIntent } from '../okx/demo-broker';

describe('persistent worker coordination', () => {
  it('atomically versions demo intents and rejects immutable changes or stale workers', async () => {
    const store = new BotStore(':memory:');
    try {
      store.acquireLease('one');
      const repo = store.demoIntents('one');
      const intent: DemoIntent = { signalId: 's1', id: 'BTC-USDT-SWAP', direction: 'long', contracts: 1, stop: 90, takeProfit: 120, clientOrderId: 'bot123', state: 'prepared', filledContracts: 0, version: 0 };
      expect(await repo.save(intent, null)).toBe(true);
      expect(await repo.save(intent, null)).toBe(false);
      expect(await repo.save({ ...intent, state: 'submitted', version: 1 }, 0)).toBe(true);
      expect(await repo.save({ ...intent, state: 'unknown', version: 1 }, 0)).toBe(false);
      expect(await repo.save({ ...intent, contracts: 2, version: 2 }, 1)).toBe(false);
      expect((await repo.find('s1'))?.state).toBe('submitted');
      store.releaseLease('one');
      await expect(repo.save({ ...intent, version: 2 }, 1)).rejects.toThrow(/Worker/);
    } finally { store.close(); }
  });
  it('preserves queued jobs and signal deduplication across database reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bot-store-test-'));
    const file = join(dir, 'bot.sqlite');
    const first = new BotStore(file);
    const job = first.enqueue('scan', {});
    first.reserveSignal('persisted', {});
    first.close();
    const reopened = new BotStore(file);
    try {
      expect(reopened.listJobs()[0].id).toBe(job.id);
      expect(reopened.reserveSignal('persisted', {})).toBe(false);
    } finally { reopened.close(); unlinkSync(file); rmdirSync(dir); }
  });
  it('fences a stale worker after lease takeover', () => {
    const store = new BotStore(':memory:');
    try {
      expect(store.acquireLease('first', 1000, 100)).toBe(true);
      expect(store.acquireLease('second', 1050, 100)).toBe(false);
      expect(store.acquireLease('second', 1101, 100)).toBe(true);
      expect(store.heartbeat('first', 1110, 100)).toBe(false);
      expect(() => store.commitCycle('first', store.getPaper(), [], 1110)).toThrow(/worker/i);
      expect(store.heartbeat('second', 1110, 100)).toBe(true);
    } finally { store.close(); }
  });
  it('deduplicates order intent before any side effect', () => {
    const store = new BotStore(':memory:');
    try {
      expect(store.reserveSignal('signal-1', { symbol: 'BTC-USDT-SWAP' })).toBe(true);
      expect(store.reserveSignal('signal-1', { symbol: 'BTC-USDT-SWAP' })).toBe(false);
    } finally { store.close(); }
  });
  it('claims each queued job once and requires current lease to finish', () => {
    const store = new BotStore(':memory:');
    try {
      store.acquireLease('worker', 1000, 1000);
      const job = store.enqueue('scan', {});
      expect(store.claimJob('worker', 1100)?.id).toBe(job.id);
      expect(store.claimJob('worker', 1101)).toBeNull();
      expect(() => store.finishJob('stranger', job.id, 'done', {}, 1102)).toThrow(/worker/i);
      store.finishJob('worker', job.id, 'done', { count: 1 }, 1102);
      expect(store.listJobs()[0].status).toBe('done');
    } finally { store.close(); }
  });
  it('expires sessions without storing their bearer value', () => {
    const store = new BotStore(':memory:');
    try {
      const token = store.createSession(1000);
      expect(store.validSession(token, 1100)).toBe(true);
      expect(store.validSession(token, 1000 + 86_400_001)).toBe(false);
      expect(store.validSession('fake', 1100)).toBe(false);
    } finally { store.close(); }
  });
});
