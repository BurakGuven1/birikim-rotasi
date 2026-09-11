import { describe, expect, it } from 'vitest';
import { applyStagedExit, planStagedExit, stagedAlgoId, type StagedAlgo, type StagedPort } from './staged-exit';
import type { Instrument, Position } from '../../bot/types';

const instrument: Instrument = { id: 'BTC-USDT-SWAP', base: 'BTC', ctVal: .01, lotSz: .01, minSz: .01, tickSz: .1, maxLeverage: 100 };
const clientOrderId = 'bot0123456789abcdef0123456789abc';
const filledContracts = 100;

/** A protected long: 100 contracts filled, 40% at 62000, 40% at 64000, a 20% runner. */
function open(overrides: Partial<Position> = {}): Position {
  return {
    id: 'Efloud 1H:BTC-USDT-SWAP:1700000000000', instrument, direction: 'long', entry: 60_000, stop: 59_000, initialStop: 59_000,
    quantity: 1, remaining: 1, openedAt: 1_700_000_000_000, processedThrough: 1_700_000_000_000, realizedPnl: 0, fees: 0, funding: 0,
    targets: [{ price: 62_000, fraction: .4, filled: false }, { price: 64_000, fraction: .4, filled: false }],
    runnerFraction: .2, exits: [], ...overrides,
  };
}
const stopAlgo = (triggerPrice = 59_000): StagedAlgo => ({ algoId: '901', algoClOrdId: stagedAlgoId(clientOrderId, 'sl'), kind: 'stop', triggerPrice, contracts: filledContracts });
const targetAlgo = (index: number, triggerPrice: number, contracts = 40): StagedAlgo => ({ algoId: `80${index}`, algoClOrdId: stagedAlgoId(clientOrderId, `t${index}`), kind: 'target', triggerPrice, contracts });
const plan = (position: Position, exposure: number, existing: StagedAlgo[]) => planStagedExit({ position, filledContracts, exposure, existing, clientOrderId });

describe('staged exit plan', () => {
  it('rests one reduce-only take profit per target, sized to that target’s share of the fill', () => {
    const result = plan(open(), 100, [stopAlgo()]);
    expect(result.place).toEqual([
      { algoClOrdId: stagedAlgoId(clientOrderId, 't0'), triggerPrice: 62_000, contracts: 40 },
      { algoClOrdId: stagedAlgoId(clientOrderId, 't1'), triggerPrice: 64_000, contracts: 40 },
    ]);
    // The runner has no target of its own; it is left to the stop and the trailing rule.
    expect(result.place.reduce((sum, order) => sum + order.contracts, 0)).toBe(80);
    expect(result.marketExit).toBeNull();
    expect(result.cancel).toEqual([]);
  });

  it('leaves an already resting plan untouched, so a cycle that changed nothing sends nothing', () => {
    const result = plan(open(), 100, [stopAlgo(), targetAlgo(0, 62_000), targetAlgo(1, 64_000)]);
    expect(result).toMatchObject({ place: [], cancel: [], amendStop: null, marketExit: null });
  });

  it('moves the exchange stop when the model moves it to break even', () => {
    const breakEven = open({ stop: 60_072 });
    const result = plan(breakEven, 100, [stopAlgo(59_000), targetAlgo(0, 62_000), targetAlgo(1, 64_000)]);
    expect(result.amendStop).toEqual({ algoClOrdId: stagedAlgoId(clientOrderId, 'sl'), triggerPrice: 60_072 });
    // Amended in place: the position is never left without a stop while the new one is placed.
    expect(result.cancel).toEqual([]);
  });

  it('ignores a stop difference smaller than one tick', () => {
    expect(plan(open({ stop: 59_000.04 }), 100, [stopAlgo(59_000)]).amendStop).toBeNull();
  });

  it('cancels a target the model has booked and closes exposure the exchange still holds', () => {
    // Paper filled TP1 at 62000; the exchange algo has not reported, so 40 contracts are stranded.
    const afterTp1 = open({ remaining: .6, targets: [{ price: 62_000, fraction: .4, filled: true }, { price: 64_000, fraction: .4, filled: false }], exits: [{ time: 1, price: 62_000, quantity: .4, pnl: 800, fee: 1, reason: 'target' }] });
    const result = plan(afterTp1, 100, [stopAlgo(), targetAlgo(0, 62_000), targetAlgo(1, 64_000)]);
    expect(result.cancel).toEqual(['800']);
    expect(result.marketExit).toEqual({ clientOrderId: `${afterTp1.id}:sync:1`, contracts: 40 });
  });

  it('sends nothing extra once the exchange has caught up with the booked target', () => {
    const afterTp1 = open({ remaining: .6, targets: [{ price: 62_000, fraction: .4, filled: true }, { price: 64_000, fraction: .4, filled: false }], exits: [{ time: 1, price: 62_000, quantity: .4, pnl: 800, fee: 1, reason: 'target' }] });
    const result = plan(afterTp1, 60, [stopAlgo(), targetAlgo(1, 64_000)]);
    expect(result.marketExit).toBeNull();
    expect(result.place).toEqual([]);
  });

  it('closes a reversal or timeout exit at market, because no resting order expresses it', () => {
    // The model exited the whole position on structure; nothing on the exchange knows that.
    const reversed = open({ remaining: 0, closedAt: 2, exits: [{ time: 2, price: 61_000, quantity: 1, pnl: 900, fee: 2, reason: 'reversal' }] });
    const result = plan(reversed, 100, [stopAlgo(), targetAlgo(0, 62_000), targetAlgo(1, 64_000)]);
    expect(result.marketExit).toEqual({ clientOrderId: `${reversed.id}:sync:1`, contracts: 100 });
    // Every resting order goes with it: a reduce-only leftover would point at the next position.
    expect(result.cancel.sort()).toEqual(['800', '801', '901']);
    expect(result.place).toEqual([]);
  });

  it('replaces a target resting at a price the plan no longer holds', () => {
    const result = plan(open(), 100, [stopAlgo(), targetAlgo(1, 63_000)]);
    expect(result.cancel).toEqual(['801']);
    expect(result.place).toContainEqual({ algoClOrdId: stagedAlgoId(clientOrderId, 't1'), triggerPrice: 64_000, contracts: 40 });
  });

  it('rests no partial orders while the proving phase sends the exchange minimum', () => {
    // One contract filled: 40% of it floors below minSz, so the staged targets cannot exist and
    // the market backstop books them instead. The position is still protected by its stop.
    const result = planStagedExit({ position: open(), filledContracts: .01, exposure: .01, existing: [stopAlgo()], clientOrderId });
    expect(result.place).toEqual([]);
    expect(result.marketExit).toBeNull();
  });

  it('sizes a short’s staged exit the same way and says so when the stop is missing', () => {
    const short = open({ direction: 'short', entry: 60_000, stop: 61_000, initialStop: 61_000, targets: [{ price: 58_000, fraction: .4, filled: false }, { price: 56_000, fraction: .4, filled: false }] });
    const result = plan(short, 100, []);
    expect(result.place.map(order => order.triggerPrice)).toEqual([58_000, 56_000]);
    expect(result.reasons.join(' ')).toContain('stop bulunamadı');
  });

  it('refuses to act on unreadable exchange numbers rather than guessing a size', () => {
    const result = planStagedExit({ position: open(), filledContracts: NaN, exposure: 100, existing: [stopAlgo()], clientOrderId });
    expect(result).toMatchObject({ place: [], cancel: [], marketExit: null });
    expect(result.reasons.join(' ')).toContain('Geçersiz');
  });
});

describe('staged exit execution', () => {
  function fakePort(exposures: number[], pending: StagedAlgo[]) {
    const calls: string[] = [];
    let reads = 0;
    const port: StagedPort = {
      pending: async () => { calls.push('pending'); return pending; },
      exposure: async () => { calls.push('exposure'); return exposures[Math.min(reads++, exposures.length - 1)]; },
      cancel: async (_id, algoIds) => { if (algoIds.length) calls.push(`cancel:${algoIds.join(',')}`); },
      placeTarget: async (_position, order) => { calls.push(`place:${order.triggerPrice}`); },
      amendStop: async (_id, order) => { calls.push(`amend:${order.triggerPrice}`); },
      marketExit: async (_position, order) => { calls.push(`exit:${order.contracts}`); },
    };
    return { port, calls };
  }

  it('cancels and places before it reads exposure again, then closes only what is left', async () => {
    const afterTp1 = open({ remaining: .6, targets: [{ price: 62_000, fraction: .4, filled: true }, { price: 64_000, fraction: .4, filled: false }], exits: [{ time: 1, price: 62_000, quantity: .4, pnl: 800, fee: 1, reason: 'target' }] });
    const { port, calls } = fakePort([100, 100], [stopAlgo(), targetAlgo(0, 62_000), targetAlgo(1, 64_000)]);
    await applyStagedExit(port, afterTp1, filledContracts, clientOrderId);
    expect(calls).toEqual(['exposure', 'pending', 'cancel:800', 'exposure', 'pending', 'exit:40']);
  });

  it('does not close contracts a target algo took while the sync was running', async () => {
    // First read says 100 stranded contracts; by the second the exchange algo has filled and the
    // position is already down to 60. Sending the market exit anyway would open a 40-contract short.
    const afterTp1 = open({ remaining: .6, targets: [{ price: 62_000, fraction: .4, filled: true }, { price: 64_000, fraction: .4, filled: false }], exits: [{ time: 1, price: 62_000, quantity: .4, pnl: 800, fee: 1, reason: 'target' }] });
    const { port, calls } = fakePort([100, 60], [stopAlgo(), targetAlgo(1, 64_000)]);
    await applyStagedExit(port, afterTp1, filledContracts, clientOrderId);
    expect(calls.some(call => call.startsWith('exit:'))).toBe(false);
  });

  it('reports a stop that could not be moved instead of failing the whole cycle', async () => {
    const { port, calls } = fakePort([100], [stopAlgo(59_000), targetAlgo(0, 62_000), targetAlgo(1, 64_000)]);
    port.amendStop = async () => { throw new Error('okx_amend_rejected'); };
    const warnings = await applyStagedExit(port, open({ stop: 60_072 }), filledContracts, clientOrderId);
    expect(warnings.join(' ')).toContain('taşınamadı');
    expect(calls.some(call => call.startsWith('exit:'))).toBe(false);
  });
});
