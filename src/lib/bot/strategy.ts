import { type Interval, type Strategy } from './types';
import { createSupertrendStrategy } from './supertrend';
import { createTrendFilteredMpaStrategy } from './combined';
import { createEfloudStrategy } from './efloud';
// Off the traded roster but still importable, so a research run can put it back on the bench.
export { createMpaStrategy } from './mpa-v2';
export { createSupertrendStrategy } from './supertrend';
export { createTrendFilteredMpaStrategy } from './combined';
export { createEfloudStrategy } from './efloud';

/** Models the research tools and the comparison table can run side by side on identical data.
 *  MPA v2 was dropped from the roster: over the same three-year window it was negative on every
 *  contract at every interval, so keeping it only invited reading a loss as a choice. */
export const strategyModels = {
  supertrend: { label: 'SuperTrend · trend takibi', create: createSupertrendStrategy },
  combined: { label: 'MPA + Trend · yapı girişi, trend yönü', create: createTrendFilteredMpaStrategy },
  efloud: { label: 'Efloud Beast · puanlı rejim + kademeli çıkış', create: createEfloudStrategy },
} as const;
export type StrategyModel = keyof typeof strategyModels;
export const strategyModelIds = Object.keys(strategyModels) as StrategyModel[];
export const isStrategyModel = (value: unknown): value is StrategyModel => typeof value === 'string' && value in strategyModels;

export function createStrategy(model: StrategyModel, interval: Interval): Strategy {
  return strategyModels[model].create(interval);
}

/** The entry intervals the roster is allowed to run. 15m never produced a trade that survived the
 *  cost guard and 4H never accumulated a holdout sample worth reading, so the bot is 1H only. */
export const rosterIntervals = ['1H'] as const satisfies readonly Interval[];

/** Every model at every traded entry interval, used by the comparison table. */
export function strategyVariants(models: StrategyModel[] = strategyModelIds) {
  return models.flatMap(model => rosterIntervals.map(interval => ({ model, interval, strategy: createStrategy(model, interval) })));
}

// Efloud on the 1H close is the variant the current study left standing on BTC: 231 trades over
// three years, profit factor 1.27, and a holdout third that stayed positive (77 trades, PF 1.31).
// It is not a validated edge — the holdout sample is under the 100-trade bar, the win rate is under
// 60%, and the same model loses money on ETH — so the roster is deliberately one contract wide.
export const liveModel: StrategyModel = 'efloud';
export const liveInterval: Interval = '1H';
/** The contracts the bot may open a position in. Evidence exists for BTC and nowhere else: the
 *  identical model was negative on ETH over the same window, so a wider universe would be trading
 *  on an untested assumption rather than on a measured one. */
export const liveInstruments: readonly string[] = ['BTC-USDT-SWAP'];
export function getStrategy(): Strategy | null { return createStrategy(liveModel, liveInterval); }
