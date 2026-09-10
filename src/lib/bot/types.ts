export const intervals = ['15m', '1H', '4H'] as const;
export type Interval = typeof intervals[number];
export const duration: Record<Interval, number> = { '15m': 900_000, '1H': 3_600_000, '4H': 14_400_000 };
export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }
export interface BiasFrames { daily: Candle[]; weekly: Candle[] }
export type Frames = Record<Interval, Candle[]> & { bias?: BiasFrames };
export interface Instrument { id: string; base: string; ctVal: number; lotSz: number; minSz: number; tickSz: number; maxLeverage: number; volumeUsdt?: number | null; spreadBps?: number | null }
export interface Signal {
  direction: 'long' | 'short'; entry: number; stop: number;
  targets: { price: number; fraction: number }[];
  expiresAt: number; confirmations: Record<Interval, string>;
  breakEvenAtR?: number;
  trailing?: { activateAtR: number; distanceR: number };
  runnerFraction?: number;
  manageAfterTp1?: boolean;
  setupId?: string;
  model?: string;
  entryInterval?: Interval;
  maxHoldHours?: number;
  exitOnReversal?: boolean;
  /** 0..1 setup conviction; scales risk between riskPercentFloor and riskPercent. */
  confidence?: number;
}
export interface Context { now: number; frames: Frames; ready: boolean; reasons: string[]; instrument?: Instrument }
export interface Strategy { id: string; version: string; entryInterval?: Interval; requireBias?: boolean; warmup: Record<Interval, number>; evaluate(context: Context): Signal | null }
export interface BotSettings {
  initialEquity: number; leverage: number; riskPercent: number; totalRiskPercent: number;
  dailyLossPercent: number; maxPositions: number; minRewardRisk: number;
  feeBps: number; slippageBps: number; fundingBufferBps: number;
  maxMarginPercent: number; minVolumeUsdt: number; maxSpreadBps: number; scanLimit: number;
  maxCostSharePercent: number; riskPercentFloor: number;
  riskMode: 'percent' | 'fixed'; fixedRiskUsdt: number;
  executionMode: 'paper' | 'live'; liveVerified: boolean;
  entryInterval: Interval | 'auto';
}
export interface Account { equity: number; available: number; openRisk: number; openMargin: number; openPositions: number; dayStartEquity: number }
export interface Funding { time: number; rate: number; markPrice: number }
export interface Exit { time: number; price: number; quantity: number; pnl: number; fee: number; reason: 'stop' | 'target' | 'end' | 'emergency' | 'reversal' | 'timeout' | 'stagnation' }
export interface Position {
  id: string; instrument: Instrument; direction: 'long' | 'short'; entry: number; stop: number; initialStop: number;
  quantity: number; remaining: number; openedAt: number; processedThrough: number; realizedPnl: number; fees: number; funding: number;
  targets: { price: number; fraction: number; filled: boolean }[];
  breakEvenAtR?: number; trailing?: Signal['trailing']; exits: Exit[]; closedAt?: number;
  manageAfterTp1?: boolean; runnerFraction?: number; setupId?: string; model?: string;
  leverage?: number;
  entryInterval?: Interval; maxHoldHours?: number; exitOnReversal?: boolean; pendingExit?: 'reversal';
}
export interface BacktestResult {
  strategy: string; instrument: string; from: number | null; to: number | null;
  trades: Position[]; equityCurve: { time: number; equity: number }[];
  metrics: { trades: number; wins: number; losses: number; breakeven: number; winRate: number | null;
    winRateInterval: [number, number] | null; netPnl: number; expectancy: number | null; profitFactor: number | null;
    maxDrawdownPercent: number; fees: number; funding: number; averageWin: number | null; averageLoss: number | null };
  eligible: false; warnings: string[]; settings: BotSettings;
  entryInterval?: Interval;
  diagnostics?: { signals: number; rejected: Record<string, number> };
  validation?: { split: number; development: BacktestResult['metrics']; holdout: BacktestResult['metrics']; passed: boolean; reasons: string[] };
}
