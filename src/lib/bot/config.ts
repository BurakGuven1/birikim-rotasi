import { z } from 'zod';
import type { BotSettings } from './types';

export const settingsSchema = z.object({
  initialEquity: z.number().finite().min(10).max(1_000_000),
  leverage: z.number().int().min(5).max(10),
  riskPercentFloor: z.number().finite().min(.1).max(5).default(1.5),
  riskPercent: z.number().finite().min(.1).max(5),
  totalRiskPercent: z.number().finite().min(.1).max(25),
  dailyLossPercent: z.number().finite().min(.5).max(20),
  maxPositions: z.number().int().min(1).max(4),
  // Only the 1H variant is traded. A 15m or 4H choice stored by an older build migrates to 'auto'
  // instead of throwing, because getSettings parses strictly and a throw here takes the bot down.
  entryInterval: z.preprocess(v => v === '15m' || v === '4H' ? 'auto' : v, z.enum(['auto', '1H']).default('auto')),
  minRewardRisk: z.number().finite().min(1).max(10),
  feeBps: z.number().finite().min(0).max(100),
  slippageBps: z.number().finite().min(0).max(100),
  fundingBufferBps: z.number().finite().min(0).max(100),
  maxMarginPercent: z.number().finite().min(5).max(50),
  minVolumeUsdt: z.number().finite().min(0).max(1e12),
  maxSpreadBps: z.number().finite().min(1).max(100),
  scanLimit: z.number().int().min(1).max(50),
  // Round-trip cost may consume at most this share of the risk unit; below it no entry has an edge to defend.
  maxCostSharePercent: z.number().finite().min(1).max(50).default(12),
  // Risk per trade as a fixed USDT loss at the stop rather than a share of equity: the operator
  // names the amount the stop is allowed to cost and the position is sized backwards from it.
  // Settings saved before this existed load as 'percent' and size exactly as they did before.
  riskMode: z.enum(['percent', 'fixed']).default('percent'),
  fixedRiskUsdt: z.number().finite().min(1).max(500).default(10),
  // Real orders require an explicit mode change; older stored settings load as paper.
  executionMode: z.enum(['paper', 'live']).default('paper'),
  // Until one live trade has opened, been protected and closed, live sizing stays at the exchange
  // minimum so the order chain is proven with the smallest amount of real money possible.
  liveVerified: z.boolean().default(false),
}).strict().refine(s => s.totalRiskPercent >= s.riskPercent, 'Toplam risk işlem riskinden küçük olamaz.');

export const defaultBotSettings: BotSettings = {
  initialEquity: 264, leverage: 10, riskPercent: 2.5, riskPercentFloor: 1.5,
  // A fixed 10 USDT stop on four concurrent positions is 40 USDT of open risk, so the portfolio
  // caps are set to clear that: 16% of a 264 account is 42.24. The daily limit matches, which
  // means four full stop-outs in one day is exactly what it takes to halt the bot until tomorrow.
  riskMode: 'fixed', fixedRiskUsdt: 10, totalRiskPercent: 16, dailyLossPercent: 16, maxPositions: 4,
  // A minimum reward/risk of 2 measured after costs rejects every SuperTrend signal, because that
  // model's target is exactly twice its stop distance, so the strategy would silently never trade.
  minRewardRisk: 1.5, entryInterval: 'auto',
  // Every order this bot sends is ordType 'market', so it always pays the taker fee. OKX's standard
  // taker rate on USDT perpetuals is 5 bp; the 2 bp this used to default to is a maker rate the bot
  // can never earn, and it flattered every backtest that ran on it.
  feeBps: 5, slippageBps: 3, fundingBufferBps: 3,
  maxMarginPercent: 40, minVolumeUsdt: 5_000_000, maxSpreadBps: 10, scanLimit: 20,
  maxCostSharePercent: 12, executionMode: 'paper', liveVerified: false,
};
