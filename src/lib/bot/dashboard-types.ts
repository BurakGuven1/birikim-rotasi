import type { PortfolioMetrics, DailyResult } from './cross-sectional';
import type { BotSettings, Candle, Instrument, Interval, Position, BacktestResult } from './types';
import type { DemoIntent } from '../server/okx/demo-broker';

export interface PaperState {
  cash: number; equity: number; day: string; dayStartEquity: number; dailyHalted: boolean;
  positions: Position[]; trades: Position[]; lastCycle: number | null;
}
export interface BotJob { id: string; kind: 'scan' | 'backtest' | 'connection' | 'comparison' | 'portfolio'; status: 'queued' | 'running' | 'done' | 'failed' | 'blocked'; createdAt: number; updatedAt: number; input: Record<string, unknown>; result: unknown }
export interface BotComparison { id: string; createdAt: number; from: number; to: number; rows: BacktestResult[]; errors: { instrument: string; message: string }[] }
export interface BotProgress { kind: 'scan' | 'backtest' | 'comparison' | 'portfolio'; state: 'running' | 'done' | 'failed'; message: string; current: number; total: number; updatedAt: number }
export interface BotPortfolio {
  id: string; createdAt: number; from: number; to: number; coins: string[]; skipped: string[]; costRate: number;
  walkForward: PortfolioMetrics | null;
  picks: { from: number; lookbackDays: number; positions: number }[];
  grid: { lookbackDays: number; positions: number; metrics: PortfolioMetrics }[];
  sensitivity: { universe: number; metrics: PortfolioMetrics }[];
  current: DailyResult | null;
}
export interface BotEvent { id: number; time: number; level: 'info' | 'warning' | 'error'; message: string }
export interface ScanResult {
  time: number; total: number; instruments: Instrument[];
  signals: { instrument: string; direction: string; reason: string }[]; warnings: string[];
  /** Closed bars of the traded contract at the traded interval, so the panel can draw what the
   *  model was looking at without fetching the same history a second time. */
  candles?: { instrument: string; interval: Interval; bars: Candle[] };
}
export interface BotSnapshot {
  settings: BotSettings; enabled: boolean; mode: BotSettings['executionMode']; strategy: { id: string; version: string } | null;
  credentials: { live: { configured: boolean; missing: string[] }; demo: { configured: boolean; missing: string[] } };
  worker: { online: boolean; heartbeat: number | null };
  paper: PaperState; scan: ScanResult | null; jobs: BotJob[]; events: BotEvent[];
  /** True while the account is still proving the order chain at the exchange minimum. */
  backtests: BacktestResult[]; liveLocked: boolean;
  /** Exchange order intents still being tracked; empty in paper mode. */
  intents: DemoIntent[];
  /** What the bot actually trades, so the panel never has to hardcode it. */
  live: { model: string; interval: Interval; instruments: string[] };
  comparison?: BotComparison | null; progress?: BotProgress | null; portfolio?: BotPortfolio | null;
}
