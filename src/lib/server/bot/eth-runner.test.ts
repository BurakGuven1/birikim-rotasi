import { describe, expect, it } from 'vitest';
import { ethOrderSize, ethPublicError } from './eth-runner';
import { handleEthCommand, ethNeedsWorker } from './eth-service';
import { BotStore } from './store';
import { defaultEthSettings } from '../../bot/eth-config';
import { OkxError } from '../okx/client';
import type { Instrument } from '../../bot/types';

const instrument: Instrument = { id: 'ETH-USDT-SWAP', base: 'ETH', ctVal: .1, lotSz: .01, minSz: .01, tickSz: .01, maxLeverage: 100 };
const store = () => new BotStore(':memory:');

describe('eth order sizing', () => {
  it('sizes from the real balance and rounds down to the exchange lot', () => {
    const size = ethOrderSize({ equityUsdt: 300, price: 2000, instrument, settings: { ...defaultEthSettings, leverage: 3, maxNotionalUsdt: 10_000 } });
    // 300 × 100% × 3 = 900 USDT; at 2000 a contract is 200 USDT, so 4.5 contracts.
    expect(size.contracts).toBe(4.5);
    expect(size.notional).toBeCloseTo(900, 6);
  });

  it('never exceeds the configured notional ceiling, whatever the balance says', () => {
    const size = ethOrderSize({ equityUsdt: 50_000, price: 2000, instrument, settings: { ...defaultEthSettings, leverage: 10, maxNotionalUsdt: 500 } });
    expect(size.notional).toBeLessThanOrEqual(500);
  });

  it('refuses to trade a dust account rather than feeding it to commissions', () => {
    const size = ethOrderSize({ equityUsdt: 4, price: 2000, instrument, settings: { ...defaultEthSettings, minEquityUsdt: 20 } });
    expect(size.contracts).toBe(0);
    expect(size.reason).toMatch(/alt sınırının altında/);
  });

  it('refuses a size below the exchange minimum instead of sending a rejected order', () => {
    const size = ethOrderSize({ equityUsdt: 25, price: 2000, instrument: { ...instrument, minSz: 1, lotSz: 1 }, settings: { ...defaultEthSettings, leverage: 1 } });
    expect(size.contracts).toBe(0);
    expect(size.reason).toMatch(/asgari emrinin/);
  });

  it('never forwards an exchange body or a stack trace to the operator', () => {
    expect(ethPublicError(new OkxError('51008'))).toBe('OKX isteği tamamlanamadı (51008).');
    expect(ethPublicError(new Error('at C:\\secret\\path\\file.ts:12'))).toMatch(/tamamlanamadı/);
    expect(ethPublicError('boom')).toMatch(/tamamlanamadı/);
  });
});

describe('eth bot storage and commands', () => {
  it('keeps its settings, log and switch completely separate from the scanner bot', () => {
    const db = store();
    try {
      db.setEnabled(true);
      expect(db.ethEnabled()).toBe(false);
      db.setEthEnabled(true);
      expect(db.enabled()).toBe(true);
      db.event('info', 'tarayıcı botu');
      db.ethEvent('info', 'eth botu');
      expect(db.listEvents().map(e => e.message)).toEqual(['tarayıcı botu']);
      expect(db.listEthEvents().map(e => e.message)).toEqual(['eth botu']);
    } finally { db.close(); }
  });

  it('reserves an exchange action once, so a repeated cycle cannot send a second order', () => {
    const db = store();
    try {
      expect(db.reserveEthOrder('entry:1', { contracts: 5 })).toBe(true);
      expect(db.reserveEthOrder('entry:1', { contracts: 5 })).toBe(false);
      expect(db.reserveEthOrder('entry:2', { contracts: 5 })).toBe(true);
    } finally { db.close(); }
  });

  it('will not let settings change under a running bot or an open position', () => {
    const db = store();
    try {
      db.setEthEnabled(true);
      expect(() => db.saveEthSettings({ ...defaultEthSettings, leverage: 10 })).toThrow(/durdurun/);
      db.setEthEnabled(false);
      db.saveEthSettings({ ...defaultEthSettings, leverage: 10 });
      expect(db.getEthSettings().leverage).toBe(10);
    } finally { db.close(); }
  });

  it('turns panel commands into stored intent, never into an exchange call', () => {
    const db = store();
    try {
      expect(handleEthCommand(db, { action: 'enabled', enabled: true })).toEqual({ ok: true });
      expect(db.ethEnabled()).toBe(true);
      expect(db.ethCycleRequested()).toBe(true);
      handleEthCommand(db, { action: 'emergency' });
      expect(db.ethEnabled()).toBe(false);
      expect(db.ethEmergencyRequested()).toBe(true);
      expect(() => handleEthCommand(db, { action: 'settings', settings: { ...defaultEthSettings, leverage: 99 } })).toThrow(/Geçersiz/);
    } finally { db.close(); }
  });

  it('keeps the loop alive while a position is open even after the bot is switched off', () => {
    const db = store();
    try {
      expect(ethNeedsWorker(db)).toBe(false);
      db.setEthEnabled(true);
      expect(ethNeedsWorker(db)).toBe(true);
      db.setEthEnabled(false);
      db.acquireLease('owner');
      db.saveEthState('owner', { updatedAt: Date.now(), cycleAt: Date.now(), barTime: null, decision: null, exchange: null, actions: [], lastError: null,
        openTrade: { clientOrderId: 'eth1', barTime: 1, direction: 'long', contracts: 5, openedAt: 1, stop: 1900, tp1: 2100, tp2: 2300 } });
      // Stopping the bot means taking no new entries; a leveraged position still needs its stop trailed.
      expect(ethNeedsWorker(db)).toBe(true);
    } finally { db.close(); }
  });
});
