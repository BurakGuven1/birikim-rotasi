import type { SwingStrategyId } from "../config.ts";
import type { Bar } from "../data/types.ts";
import { atr, donchian, rsi, sma } from "./indicators.ts";
import { maxDrawdown } from "./metrics.ts";

export type Side = 1 | -1;

export interface EntrySignal {
  side: Side;
  stop: number;
  target?: number;
  maxBars?: number;
  reason: string;
}

export interface OpenTrade {
  side: Side;
  entryIdx: number;
  entry: number;
  stop: number;
  initialStop: number;
  target?: number;
  maxBars?: number;
  units: number;
  reason: string;
}

export interface Trade {
  side: Side;
  entryDate: string;
  exitDate: string;
  entry: number;
  exit: number;
  /** Başlangıç stop seviyesi */
  stop: number;
  target?: number;
  pnl: number;
  r: number;
  bars: number;
  reason: string;
  exitReason: string;
}

export interface Strategy {
  id: SwingStrategyId;
  label: string;
  /** Sabit kesirli risk: işlem başına özsermaye riski. null ise tam nominal (maxLeverage). */
  riskPct: number | null;
  entry(i: number): EntrySignal | null;
  exit(i: number, t: OpenTrade): string | null;
}

export interface SwingOptions {
  costBps: number;
  carryAnnual: number;
  maxLeverage: number;
  initialEquity?: number;
}

export interface SwingResult {
  dates: string[];
  equity: number[];
  trades: Trade[];
  stats: TradeStats;
}

export interface TradeStats {
  trades: number;
  winRate: number;
  avgWinR: number;
  avgLossR: number;
  expectancyR: number;
  profitFactor: number;
  cagr: number;
  maxDrawdown: number;
  exposure: number;
  avgBars: number;
  /** İlk ve ikinci yarı kâr faktörü — kararlılık kontrolü */
  pfFirstHalf: number;
  pfSecondHalf: number;
}

// ------------------------------------------------------------------ stratejiler

/** Connors RSI(2) geri çekilme: yalnız uzun, fiyat SMA200 üstündeyken. */
export function rsi2Strategy(bars: Bar[]): Strategy {
  const c = bars.map((b) => b.close);
  const s200 = sma(c, 200);
  const s5 = sma(c, 5);
  const r2 = rsi(c, 2);
  const a = atr(bars, 14);
  return {
    id: "rsi2",
    label: "RSI(2) trend içi geri çekilme",
    riskPct: null,
    entry(i) {
      if (!(c[i] > s200[i]) || !(r2[i] < 10)) return null;
      return { side: 1, stop: c[i] - 3 * a[i], maxBars: 10, reason: `RSI2=${r2[i].toFixed(1)} < 10, fiyat > SMA200` };
    },
    exit(i) {
      return c[i] > s5[i] ? "kapanış > SMA5" : null;
    },
  };
}

/** Turtle benzeri Donchian 55/20 kırılım: iki yönlü, 2·ATR başlangıç stopu. */
export function donchianStrategy(bars: Bar[]): Strategy {
  const c = bars.map((b) => b.close);
  const d55 = donchian(bars, 55);
  const d20 = donchian(bars, 20);
  const a = atr(bars, 20);
  return {
    id: "donchian",
    label: "Donchian 55/20 trend kırılımı",
    riskPct: 0.02,
    entry(i) {
      if (!Number.isFinite(a[i])) return null;
      if (c[i] > d55.upper[i]) return { side: 1, stop: c[i] - 2 * a[i], reason: "55 günlük zirve kırıldı" };
      if (c[i] < d55.lower[i]) return { side: -1, stop: c[i] + 2 * a[i], reason: "55 günlük dip kırıldı" };
      return null;
    },
    exit(i, t) {
      if (t.side === 1 && c[i] < d20.lower[i]) return "20 günlük dip altı";
      if (t.side === -1 && c[i] > d20.upper[i]) return "20 günlük zirve üstü";
      return null;
    },
  };
}

/**
 * Range sapması + geri alım (price-action "deviation/reclaim"; Efloud tarzı yaklaşımın
 * sistematik bir yorumu): büyük trend yönünde, fiyat 20 günlük range dibinin altına
 * iğne atıp (likidite süpürme) range içine geri kapanırsa → range tepesini hedefle.
 */
export function sweepStrategy(bars: Bar[]): Strategy {
  const c = bars.map((b) => b.close);
  const s200 = sma(c, 200);
  const d20 = donchian(bars, 20);
  const a = atr(bars, 14);
  return {
    id: "sweep",
    label: "Range sapma + geri alım (likidite süpürme)",
    riskPct: 0.015,
    entry(i) {
      const b = bars[i];
      if (!Number.isFinite(a[i]) || !Number.isFinite(s200[i])) return null;
      const lo = d20.lower[i];
      const hi = d20.upper[i];
      if (c[i] > s200[i] && b.low < lo && b.close > lo)
        return { side: 1, stop: b.low - 0.25 * a[i], target: hi, maxBars: 20, reason: "range dibi süpürüldü ve geri alındı" };
      if (c[i] < s200[i] && b.high > hi && b.close < hi)
        return { side: -1, stop: b.high + 0.25 * a[i], target: lo, maxBars: 20, reason: "range tepesi süpürüldü ve kaybedildi" };
      return null;
    },
    exit() {
      return null;
    },
  };
}

export function makeStrategy(id: SwingStrategyId, bars: Bar[]): Strategy {
  if (id === "rsi2") return rsi2Strategy(bars);
  if (id === "donchian") return donchianStrategy(bars);
  return sweepStrategy(bars);
}

// ------------------------------------------------------------------ simülatör

const DAY_MS = 86_400_000;

/**
 * Sinyaller bar KAPANIŞINDA değerlendirilir, bir sonraki barın AÇILIŞINDA uygulanır.
 * Stop/hedef bar içinde kontrol edilir; ikisi aynı barda tetiklenirse stop varsayılır
 * (muhafazakâr). Boşluklu açılışta dolum açılış fiyatından olur.
 */
export function simulate(bars: Bar[], strat: Strategy, opt: SwingOptions): SwingResult {
  const cost = opt.costBps / 10_000;
  let cashEq = opt.initialEquity ?? 10_000;
  let pos: OpenTrade | null = null;
  let pendingEntry: EntrySignal | null = null;
  let pendingExit: string | null = null;
  const trades: Trade[] = [];
  const equity: number[] = [];
  let inMarket = 0;

  const close = (i: number, price: number, why: string) => {
    if (!pos) return;
    const fill = price * (1 - pos.side * cost);
    const pnl = pos.side * (fill - pos.entry) * pos.units;
    cashEq += pnl;
    const risk = Math.abs(pos.entry - pos.initialStop) * pos.units;
    trades.push({
      side: pos.side,
      entryDate: bars[pos.entryIdx].date,
      exitDate: bars[i].date,
      entry: pos.entry,
      exit: fill,
      stop: pos.initialStop,
      target: pos.target,
      pnl,
      r: risk > 0 ? pnl / risk : 0,
      bars: i - pos.entryIdx,
      reason: pos.reason,
      exitReason: why,
    });
    pos = null;
  };

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (pendingExit && pos) close(i, b.open, pendingExit);
    pendingExit = null;
    if (pendingEntry && !pos) {
      const s = pendingEntry;
      const fill = b.open * (1 + s.side * cost);
      const dist = s.side === 1 ? fill - s.stop : s.stop - fill;
      if (dist > 0 && cashEq > 0) {
        const maxUnits = (cashEq * opt.maxLeverage) / fill;
        const units = strat.riskPct === null ? maxUnits : Math.min(maxUnits, (cashEq * strat.riskPct) / dist);
        pos = { side: s.side, entryIdx: i, entry: fill, stop: s.stop, initialStop: s.stop, target: s.target, maxBars: s.maxBars, units, reason: s.reason };
      }
    }
    pendingEntry = null;

    if (pos) {
      const p: OpenTrade = pos;
      // Perp fonlaması (takvim günü): uzun pozisyon öder. Kısa pozisyonun genelde aldığı
      // fonlama muhafazakâr olarak sıfır sayılır.
      if (i > 0 && p.side === 1) {
        const days = (Date.parse(b.date) - Date.parse(bars[i - 1].date)) / DAY_MS;
        cashEq -= (p.units * b.close * opt.carryAnnual * days) / 365;
      }
      const stopHit = p.side === 1 ? b.low <= p.stop : b.high >= p.stop;
      const tgtHit = p.target !== undefined && (p.side === 1 ? b.high >= p.target : b.low <= p.target);
      if (stopHit) {
        const px = p.side === 1 ? Math.min(b.open, p.stop) : Math.max(b.open, p.stop);
        close(i, px, "stop");
      } else if (tgtHit && p.target !== undefined) {
        const px = p.side === 1 ? Math.max(b.open, p.target) : Math.min(b.open, p.target);
        close(i, px, "hedef");
      }
    }

    if (pos) {
      const p: OpenTrade = pos;
      inMarket++;
      const why = strat.exit(i, p);
      if (why) pendingExit = why;
      else if (p.maxBars !== undefined && i - p.entryIdx + 1 >= p.maxBars) pendingExit = "zaman stopu";
    } else if (i < bars.length - 1) {
      pendingEntry = strat.entry(i);
    }

    const open = pos as OpenTrade | null;
    const unreal = open ? open.side * (b.close - open.entry) * open.units : 0;
    equity.push(cashEq + unreal);
  }
  if (pos) close(bars.length - 1, bars[bars.length - 1].close, "test sonu");

  return { dates: bars.map((b) => b.date), equity, trades, stats: tradeStats(trades, bars, equity, inMarket) };
}

function profitFactor(ts: Trade[]): number {
  const gw = ts.filter((t) => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
  const gl = -ts.filter((t) => t.pnl <= 0).reduce((a, t) => a + t.pnl, 0);
  return gl === 0 ? (gw > 0 ? Infinity : NaN) : gw / gl;
}

export function tradeStats(trades: Trade[], bars: Bar[], equity: number[], inMarket: number): TradeStats {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const years = (Date.parse(bars[bars.length - 1].date) - Date.parse(bars[0].date)) / (365.25 * DAY_MS);
  const daily = equity.slice(1).map((e, k) => e / equity[k] - 1);
  const mid = bars[Math.floor(bars.length / 2)].date;
  return {
    trades: trades.length,
    winRate: trades.length ? wins.length / trades.length : NaN,
    avgWinR: mean(wins.map((t) => t.r)),
    avgLossR: mean(losses.map((t) => t.r)),
    expectancyR: mean(trades.map((t) => t.r)),
    profitFactor: profitFactor(trades),
    cagr: (equity[equity.length - 1] / equity[0]) ** (1 / years) - 1,
    maxDrawdown: maxDrawdown(daily),
    exposure: inMarket / bars.length,
    avgBars: mean(trades.map((t) => t.bars)),
    pfFirstHalf: profitFactor(trades.filter((t) => t.entryDate < mid)),
    pfSecondHalf: profitFactor(trades.filter((t) => t.entryDate >= mid)),
  };
}

/** Günlük özsermaye eğrisinden ay sonu getirileri */
export function monthlyReturnsFromEquity(dates: string[], equity: number[]): Map<string, number> {
  const last = new Map<string, number>();
  dates.forEach((d, i) => last.set(d.slice(0, 7), equity[i]));
  const out = new Map<string, number>();
  let prev: number | undefined;
  for (const [m, v] of last) {
    if (prev !== undefined) out.set(m, v / prev - 1);
    prev = v;
  }
  return out;
}
