import { describe, expect, it } from 'vitest';
import { sizeTrade } from './risk';
import { defaultBotSettings } from './config';
import type { Signal, Instrument } from './types';

const instrument: Instrument = { id: 'TEST-USDT-SWAP', base: 'TEST', ctVal: 1, lotSz: .1, minSz: .1, tickSz: .01, maxLeverage: 10 };
const signal: Signal = { direction: 'long', entry: 100, stop: 99, targets: [{ price: 103, fraction: 1 }], expiresAt: 10_000, confirmations: { '15m': 'entry', '1H': 'trend', '4H': 'bias' } };
// Pinned to the percent band so these assertions test the sizing rules, not whatever risk mode
// and portfolio caps the shipped account defaults happen to carry.
const settings = { ...defaultBotSettings, feeBps: 0, slippageBps: 0, fundingBufferBps: 0, riskMode: 'percent' as const, riskPercent: .5, riskPercentFloor: .5, totalRiskPercent: 2, dailyLossPercent: 2, leverage: 5 };
const account = { equity: 200, available: 200, openRisk: 0, openMargin: 0, openPositions: 0, dayStartEquity: 200 };

describe('bot risk budget', () => {
  it('keeps stop risk constant when leverage doubles', () => {
    const five = sizeTrade(instrument, signal, account, settings);
    const ten = sizeTrade(instrument, signal, account, { ...settings, leverage: 10 });
    expect(five).toMatchObject({ ok: true, contracts: 1, risk: 1, margin: 20 });
    expect(ten).toMatchObject({ ok: true, contracts: 1, risk: 1, margin: 10 });
  });
  it('scales risk between the floor and the ceiling with setup conviction', () => {
    const band = { ...settings, riskPercentFloor: 1.5, riskPercent: 2.5, totalRiskPercent: 5, leverage: 10 };
    const low = sizeTrade(instrument, { ...signal, confidence: 0 }, account, band);
    const high = sizeTrade(instrument, { ...signal, confidence: 1 }, account, band);
    const mid = sizeTrade(instrument, { ...signal, confidence: .5 }, account, band);
    // 200 equity: 1.5% floor is 3.0, 2.5% ceiling is 5.0, midpoint 4.0, and 1 unit of risk per contract.
    expect(low).toMatchObject({ ok: true, risk: 3 });
    expect(mid).toMatchObject({ ok: true, risk: 4 });
    expect(high).toMatchObject({ ok: true, risk: 5 });
  });
  it('treats an unscored signal as fully convicted so existing strategies keep their sizing', () => {
    const band = { ...settings, riskPercentFloor: 1.5, riskPercent: 2.5, totalRiskPercent: 5, leverage: 10 };
    expect(sizeTrade(instrument, signal, account, band)).toMatchObject({ ok: true, risk: 5 });
  });
  it('rejects a conviction score outside the unit interval', () => {
    expect(sizeTrade(instrument, { ...signal, confidence: 1.4 }, account, settings).ok).toBe(false);
  });
  it('still sizes when a stored account has a ceiling below the default floor', () => {
    // Accounts saved before the conviction band existed keep riskPercent .5 while the floor
    // defaults to 1.5; that must clamp, never reject, or every bot command fails validation.
    const legacy = { ...settings, riskPercent: .5, riskPercentFloor: 1.5 };
    expect(sizeTrade(instrument, signal, account, legacy)).toMatchObject({ ok: true, risk: 1 });
  });
  it('refuses a stop so tight that round-trip cost owns most of the risk unit', () => {
    // 1% stop against 5 bp fee + 5 bp slippage each way: cost is ~19% of the risk unit.
    const costed = { ...settings, feeBps: 5, slippageBps: 5, fundingBufferBps: 3 };
    expect(sizeTrade(instrument, signal, account, costed)).toMatchObject({ ok: false, reason: 'İşlem maliyeti risk biriminin izin verilen payını aşıyor.' });
  });
  it('accepts the same costs once the stop is wide enough to carry them', () => {
    const costed = { ...settings, feeBps: 5, slippageBps: 5, fundingBufferBps: 3 };
    const wide: Signal = { ...signal, stop: 97, targets: [{ price: 107, fraction: 1 }] };
    expect(sizeTrade(instrument, wide, account, costed).ok).toBe(true);
  });
  it('does not round up to exchange minimum at the expense of risk', () => {
    expect(sizeTrade({ ...instrument, minSz: 2 }, signal, account, settings).ok).toBe(false);
  });
  it('rejects a target on the wrong side and reward below the configured minimum', () => {
    expect(sizeTrade(instrument, { ...signal, targets: [{ price: 99, fraction: 1 }] }, account, settings).ok).toBe(false);
    // Pinned to 2 so the assertion tests the filter, not whatever the account default happens to be.
    const strict = { ...defaultBotSettings, minRewardRisk: 2 };
    expect(sizeTrade(instrument, { ...signal, targets: [{ price: 102, fraction: 1 }] }, account, strict).ok).toBe(false);
  });
  it('accepts a staged exit on its final target instead of its weighted average', () => {
    // 40% at 1.2R, 40% at 2.2R and a 20% runner averages 1.36R, which the old single gate scored
    // against a 1.5 minimum and rejected — the reason every Efloud signal produced zero trades.
    const staged: Signal = { ...signal, targets: [{ price: 101.2, fraction: .4 }, { price: 102.2, fraction: .4 }], runnerFraction: .2 };
    expect(sizeTrade(instrument, staged, account, settings)).toMatchObject({ ok: true });
  });
  it('still rejects a staged exit whose furthest target misses the minimum', () => {
    const shallow: Signal = { ...signal, targets: [{ price: 100.6, fraction: .4 }, { price: 101.4, fraction: .4 }], runnerFraction: .2 };
    expect(sizeTrade(instrument, shallow, account, settings)).toMatchObject({ ok: false, reason: 'Maliyet sonrası ödül/risk yetersiz.' });
  });
  it('rejects a staged plan that returns less than the risk unit even when every target fills', () => {
    // Reaches 2R at the end, but taking 40% at 0.2R drags the filled plan to 0.88R of a 1R stop.
    const frontLoaded: Signal = { ...signal, targets: [{ price: 100.2, fraction: .4 }, { price: 102, fraction: .4 }], runnerFraction: .2 };
    expect(sizeTrade(instrument, frontLoaded, account, settings)).toMatchObject({ ok: false, reason: 'Kademeli çıkış planı maliyet sonrası risk birimini karşılamıyor.' });
  });
  it('stakes the named USDT loss at the stop when risk is fixed rather than a share of equity', () => {
    // A 2.00 stop distance carries the 10 USDT stake in 5 contracts, whatever the equity is.
    const fixed = { ...settings, riskMode: 'fixed' as const, fixedRiskUsdt: 10, riskPercentFloor: 1.5, riskPercent: 2.5, totalRiskPercent: 16, leverage: 10 };
    const wide: Signal = { ...signal, stop: 98, targets: [{ price: 105, fraction: 1 }] };
    expect(sizeTrade(instrument, wide, account, fixed)).toMatchObject({ ok: true, risk: 10, contracts: 5 });
    // Doubling equity does not double the stake, which is the whole point of the fixed mode.
    expect(sizeTrade(instrument, wide, { ...account, equity: 400, available: 400, dayStartEquity: 400 }, fixed)).toMatchObject({ ok: true, risk: 10 });
    // A weak setup still risks proportionally less: the 1.5/2.5 band floor is 60% of the stake.
    expect(sizeTrade(instrument, { ...wide, confidence: 0 }, account, fixed)).toMatchObject({ ok: true, risk: 6 });
  });
  it('throttles a fixed stake through the portfolio cap as the account shrinks', () => {
    const fixed = { ...settings, riskMode: 'fixed' as const, fixedRiskUsdt: 10, totalRiskPercent: 3, leverage: 10 };
    const wide: Signal = { ...signal, stop: 98, targets: [{ price: 105, fraction: 1 }] };
    // 3% of a 200 USDT account is 6, so the 10 USDT stake is cut to what the portfolio cap allows.
    expect(sizeTrade(instrument, wide, account, fixed)).toMatchObject({ ok: true, risk: 6 });
  });
  it('sizes shorts in exchange contracts and floors fractional steps', () => {
    const result = sizeTrade({ ...instrument, ctVal: 10, lotSz: .01, minSz: .01 }, { ...signal, direction: 'short', stop: 101, targets: [{ price: 97, fraction: 1 }] }, account, settings);
    expect(result).toMatchObject({ ok: true, contracts: .1, quantity: 1, risk: 1 });
  });
  it('blocks entries after daily equity loss including unrealized loss', () => {
    expect(sizeTrade(instrument, signal, { ...account, equity: 196 }, settings).ok).toBe(false);
  });
  it('rejects NaN, invalid target allocation, exhausted risk and missing confirmations', () => {
    expect(sizeTrade(instrument, signal, { ...account, available: NaN }, settings).ok).toBe(false);
    expect(sizeTrade(instrument, { ...signal, targets: [{ price: 103, fraction: .4 }] }, account, settings).ok).toBe(false);
    expect(sizeTrade(instrument, signal, { ...account, openRisk: account.equity * settings.totalRiskPercent / 100 }, settings).ok).toBe(false);
    expect(sizeTrade(instrument, { ...signal, confirmations: { ...signal.confirmations, '4H': '' } }, account, settings).ok).toBe(false);
  });
});
