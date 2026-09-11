import { z } from 'zod';
import type { EthLiveDecision } from './eth-live';

/**
 * The ETH bot's own settings. They are deliberately separate from `BotSettings`: this model does
 * not go through the shared risk engine, so a reward/risk floor or a fixed-dollar stake would be a
 * setting that changes nothing. What it does have is a stake, a leverage and two hard ceilings.
 */
export const ethSettingsSchema = z.object({
  /** 'paper' keeps every decision on paper. 'live' sends real orders to the real OKX account. */
  mode: z.enum(['paper', 'live']).default('paper'),
  leverage: z.number().int().min(1).max(10).default(3),
  /** Share of account equity used as the base of the notional, before leverage. */
  equityPercent: z.number().finite().min(1).max(100).default(100),
  direction: z.enum(['long', 'short', 'both']).default('long'),
  /** OKX taker on USDT perpetuals is 5 bp; every order this model sends is a market order. */
  commissionPercent: z.number().finite().min(0).max(1).default(.05),
  slippageTicks: z.number().int().min(0).max(20).default(2),
  /** Hard ceiling on one order's notional, so a mis-read balance cannot become a huge position. */
  maxNotionalUsdt: z.number().finite().min(10).max(1_000_000).default(500),
  /** Below this equity the bot refuses to open: fees would eat a position this small. */
  minEquityUsdt: z.number().finite().min(5).max(100_000).default(20),
}).strict();

export type EthSettings = z.infer<typeof ethSettingsSchema>;
export const defaultEthSettings: EthSettings = ethSettingsSchema.parse({});

export interface EthPositionView {
  contracts: number; direction: 'long' | 'short'; entryPrice: number | null; markPrice: number | null;
  unrealizedPnl: number | null; leverage: number | null; margin: number | null; liquidationPrice: number | null;
}
export interface EthAlgoView { algoId: string; clientId: string; kind: 'stop' | 'target'; trigger: number; contracts: number; state: string }
export interface EthFillView { time: number; side: 'buy' | 'sell'; price: number; contracts: number; fee: number; orderId: string; pnl: number | null }

export interface EthExchangeView {
  balanceUsdt: number | null;
  position: EthPositionView | null;
  algos: EthAlgoView[];
  fills: EthFillView[];
  /** True when the exchange holds an ETH position this bot has no record of opening. */
  foreign: boolean;
}

/** What the bot recorded when it sent an entry, so a position it did not open is never touched. */
export interface EthOpenTrade { clientOrderId: string; barTime: number; direction: 'long' | 'short'; contracts: number; openedAt: number; stop: number; tp1: number; tp2: number }

export interface EthRuntimeState {
  updatedAt: number;
  cycleAt: number | null;
  /** Open time of the 15m bar the last decision was made on. */
  barTime: number | null;
  decision: EthLiveDecision | null;
  exchange: EthExchangeView | null;
  openTrade: EthOpenTrade | null;
  /** Actions this cycle actually took at the exchange, in plain language. */
  actions: string[];
  lastError: string | null;
}

export interface EthEvent { id: number; time: number; level: 'info' | 'warning' | 'error'; message: string }

export interface EthSnapshot {
  settings: EthSettings;
  enabled: boolean;
  credentials: { configured: boolean; missing: string[] };
  worker: { online: boolean; heartbeat: number | null };
  state: EthRuntimeState | null;
  events: EthEvent[];
  instrument: string;
  /** The rules this bot trades, named so the panel never has to guess. */
  strategy: { id: string; interval: string };
}
