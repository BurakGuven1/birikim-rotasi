import { settingsSchema } from './config';
import { closedContext } from './market';
import { advancePosition, closePosition, openPosition } from './position';
import { sizeTrade } from './risk';
import { duration, type BacktestResult, type BotSettings, type Frames, type Funding, type Instrument, type Interval, type Position, type Strategy } from './types';

interface Input { instrument: Instrument; frames: Frames; strategy: Strategy | null; settings: BotSettings; funding: Funding[]; fundingComplete: boolean; from?: number; to?: number;
  /** Bars the fills are walked on. 15m is the most faithful; a coarser frame trades intrabar
   *  precision for a far longer usable history, because OKX serves 15m for a limited window only. */
  executionInterval?: Interval }

export function runBacktest(input: Input): BacktestResult {
  const { strategy, settings, frames, instrument, funding } = input;
  const execution = input.executionInterval ?? '15m';
  const step = duration[execution];
  if (!strategy) throw new Error('Strateji henüz tanımlanmadı.');
  settingsSchema.parse(settings);
  const bars = frames[execution].filter(b => b.time >= (input.from ?? 0) && b.time + step <= (input.to ?? Infinity)).toSorted((a, b) => a.time - b.time);
  if (bars.length < 2) throw new Error('Backtest için yeterli mum yok.');
  if (bars.some((b, i) => ![b.time, b.open, b.high, b.low, b.close, b.volume].every(Number.isFinite) || b.low <= 0 || b.volume < 0 || b.low > Math.min(b.open, b.close) || b.high < Math.max(b.open, b.close) || (i > 0 && b.time - bars[i - 1].time !== step))) throw new Error(`${execution} verisi geçersiz veya kesintili.`);
  if (funding.some(f => ![f.time, f.rate, f.markPrice].every(Number.isFinite) || f.markPrice <= 0) || new Set(funding.map(f => f.time)).size !== funding.length) throw new Error('Funding verisi geçersiz veya yinelenmiş.');
  const trades: Position[] = [], equityCurve: BacktestResult['equityCurve'] = [];
  const usedSetups = new Set<string>();
  const diagnostics = { signals: 0, rejected: {} as Record<string, number> };
  let cash = settings.initialEquity, position: Position | null = null;
  let day = '', dayStartEquity = cash, peak = cash, drawdown = 0, dailyHalted = false;
  const warnings = [
    'Bu sonuç tek enstrüman replay sonucudur; ayrılmış test ve coin seçim doğrulaması olmadan canlıya geçiş kanıtı değildir.',
    'OHLC modeli: aynı mumda stop önce; funding mum başı miktarına uygulanır. Likidasyon için marjin tamponu kullanılır, gerçek borsa likidasyonu modellenmez.',
    'Güncel sözleşme kuralları kullanılır; tarihsel sözleşme değişimleri ve delist evreni doğrulanmış değildir.',
  ];
  if (!input.fundingComplete) warnings.push('Funding geçmişi eksik; maliyet sonucu tamamlanmamış.');
  for (let index = 1; index < bars.length; index++) {
    const bar = bars[index];
    const date = new Date(bar.time).toISOString().slice(0, 10);
    const equityAtOpen = cash + (position ? position.realizedPnl + position.remaining * (bar.open - position.entry) * (position.direction === 'long' ? 1 : -1) : 0);
    if (date !== day) { day = date; dayStartEquity = equityAtOpen; dailyHalted = false; }
    if (equityAtOpen <= dayStartEquity * (1 - settings.dailyLossPercent / 100)) dailyHalted = true;
    if (!position && !dailyHalted) {
      const context = closedContext(frames, bar.time, strategy.warmup, strategy.requireBias !== false);
      context.instrument = instrument;
      if (context.ready) {
        const proposed = strategy.evaluate(context);
        if (proposed && proposed.expiresAt > bar.time && (!proposed.setupId || !usedSetups.has(proposed.setupId))) {
          diagnostics.signals++;
          const signal = { ...proposed, entry: bar.open * (1 + (proposed.direction === 'long' ? 1 : -1) * settings.slippageBps / 10_000) };
          const sizing = sizeTrade(instrument, signal, { equity: cash, available: cash, openRisk: 0, openMargin: 0, openPositions: 0, dayStartEquity }, settings);
          if (sizing.ok) {
            position = openPosition(`${strategy.id}:${instrument.id}:${bar.time}`, instrument, signal, sizing.contracts, bar.time, settings);
            if (proposed.setupId) usedSetups.add(proposed.setupId);
          } else diagnostics.rejected[sizing.reason] = (diagnostics.rejected[sizing.reason] ?? 0) + 1;
        }
      }
    }
    if (position) {
      position = advancePosition(position, bar, settings, funding, closedContext(frames, bar.time + step, strategy.warmup, strategy.requireBias !== false).frames[position.entryInterval ?? '1H']);
      if (position.remaining === 0) { cash += position.realizedPnl; trades.push(position); position = null; }
    }
    const equity = cash + (position ? position.realizedPnl + position.remaining * (bar.close - position.entry) * (position.direction === 'long' ? 1 : -1) : 0);
    if (equity <= dayStartEquity * (1 - settings.dailyLossPercent / 100)) dailyHalted = true;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak > 0 ? (peak - equity) / peak * 100 : 0);
    equityCurve.push({ time: bar.time + step, equity });
  }
  if (position) {
    position = closePosition(position, bars.at(-1)!.close, bars.at(-1)!.time + step, settings);
    cash += position.realizedPnl; trades.push(position);
    const last = equityCurve.at(-1)!; last.equity = cash;
    drawdown = Math.max(drawdown, peak > 0 ? (peak - cash) / peak * 100 : 0);
    warnings.push('Dönem sonunda açık pozisyon son kapanış fiyatından maliyetle kapatıldı.');
  }
  const winners = trades.filter(t => t.realizedPnl > 1e-8), losers = trades.filter(t => t.realizedPnl < -1e-8);
  const gains = winners.reduce((s, t) => s + t.realizedPnl, 0), losses = -losers.reduce((s, t) => s + t.realizedPnl, 0);
  const n = trades.length, p = n ? winners.length / n : 0, z = 1.96;
  const center = n ? (p + z * z / (2 * n)) / (1 + z * z / n) : 0;
  const half = n ? z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n) : 0;
  return { strategy: `${strategy.id}@${strategy.version}`, instrument: instrument.id, from: bars[0]?.time ?? null, to: bars.at(-1)!.time + step,
    trades, equityCurve, eligible: false, warnings, settings, diagnostics, entryInterval: strategy.entryInterval,
    metrics: { trades: n, wins: winners.length, losses: losers.length, breakeven: n - winners.length - losers.length,
      winRate: n ? p * 100 : null, winRateInterval: n ? [(center - half) * 100, (center + half) * 100] : null,
      netPnl: cash - settings.initialEquity, expectancy: n ? (cash - settings.initialEquity) / n : null,
      profitFactor: losses ? gains / losses : null, maxDrawdownPercent: drawdown,
      fees: trades.reduce((s, t) => s + t.fees, 0), funding: trades.reduce((s, t) => s + t.funding, 0),
      averageWin: winners.length ? gains / winners.length : null, averageLoss: losers.length ? losses / losers.length : null } };
}
