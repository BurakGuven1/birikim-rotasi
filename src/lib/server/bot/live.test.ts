import { describe, expect, it } from 'vitest';
import { applyLeverage, liveContracts } from './live';
import { defaultBotSettings } from '../../bot/config';
import type { Instrument, Position } from '../../bot/types';
import type { OkxClient } from '../okx/client';

const instrument: Instrument = { id: 'BTC-USDT-SWAP', base: 'BTC', ctVal: 0.01, lotSz: 0.01, minSz: 0.01, tickSz: 0.1, maxLeverage: 100 };
const position = { instrument, quantity: 0.5 } as Position;

describe('live sizing gate', () => {
  it('sends the exchange minimum until one live cycle has been proven', () => {
    expect(liveContracts(position, { ...defaultBotSettings, liveVerified: false })).toBe(instrument.minSz);
  });

  it('sends the planned size once verification is complete', () => {
    // 0.5 base quantity over a 0.01 contract value is 50 contracts.
    expect(liveContracts(position, { ...defaultBotSettings, liveVerified: true })).toBeCloseTo(50, 9);
  });

  it('never sends more than planned even while unverified', () => {
    const tiny = { instrument, quantity: 0.0001 } as Position;
    expect(liveContracts(tiny, { ...defaultBotSettings, liveVerified: false })).toBeLessThanOrEqual(0.01);
  });

  it('defaults a stored account to paper so live is always an explicit choice', () => {
    expect(defaultBotSettings.executionMode).toBe('paper');
    expect(defaultBotSettings.liveVerified).toBe(false);
  });
});

describe('live leverage', () => {
  const clientWith = (rows: unknown[], seen: unknown[] = []) => ({ post: async (path: string, body: unknown) => { seen.push({ path, body }); return rows; } } as unknown as OkxClient);

  it('writes the sized leverage to the isolated net position before any order is sent', async () => {
    const seen: unknown[] = [];
    await applyLeverage(clientWith([{ instId: 'BTC-USDT-SWAP', lever: '10', mgnMode: 'isolated', posSide: 'net' }], seen), 'BTC-USDT-SWAP', 10);
    expect(seen).toEqual([{ path: '/api/v5/account/set-leverage', body: { instId: 'BTC-USDT-SWAP', lever: '10', mgnMode: 'isolated', posSide: 'net' } }]);
  });

  it('fails when the exchange acknowledges a different leverage than the one the size assumed', async () => {
    // Sizing derived the contract count from a 10x margin budget; at 3x the same order needs more
    // than three times the margin, so treating this as success would send an unsizeable position.
    await expect(applyLeverage(clientWith([{ instId: 'BTC-USDT-SWAP', lever: '3' }]), 'BTC-USDT-SWAP', 10)).rejects.toThrow('okx_leverage_not_applied');
    await expect(applyLeverage(clientWith([]), 'BTC-USDT-SWAP', 10)).rejects.toThrow('okx_leverage_not_applied');
  });
});
