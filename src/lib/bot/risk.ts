import { settingsSchema } from './config';
import { intervals, type Account, type BotSettings, type Instrument, type Signal } from './types';

export type Sizing = { ok: true; contracts: number; quantity: number; risk: number; margin: number; rewardRisk: number; notional: number } | { ok: false; reason: string };
export const floorStep = (value: number, step: number) => Number((Math.floor((value + step * 1e-9) / step) * step).toFixed(12));
/** Every target filling must still return more than the risk unit staked; a plan below this is a
 *  losing trade even when it works. Structural, so it is not exposed as a tunable setting. */
const planRewardRiskFloor = 1;
const aligned = (value: number, step: number) => Math.abs(value / step - Math.round(value / step)) < 1e-6;

/** Round partial exits down; the residual stays in the runner, never increases risk. */
export function allocatedTargets(i: Instrument, s: Signal, contracts: number) {
  return s.targets.map(t => ({ ...t, fraction: s.runnerFraction ? floorStep(contracts * t.fraction, i.lotSz) / contracts : t.fraction }));
}

export function sizeTrade(i: Instrument, s: Signal, a: Account, settings: BotSettings): Sizing {
  const reject = (reason: string): Sizing => ({ ok: false, reason });
  if (!settingsSchema.safeParse(settings).success || !Object.values(a).every(Number.isFinite) ||
      ![i.ctVal, i.lotSz, i.minSz, i.tickSz, i.maxLeverage, s.entry, s.stop, s.expiresAt].every(v => Number.isFinite(v) && v > 0)) return reject('Geçersiz risk girdisi.');
  if (!['long', 'short'].includes(s.direction) || intervals.some(tf => !s.confirmations?.[tf]?.trim())) return reject('Üç zaman diliminin teyidi gerekli.');
  if (settings.leverage > i.maxLeverage) return reject('Sözleşmenin kaldıraç sınırı aşılıyor.');
  if (a.equity <= 0 || a.available <= 0 || a.dayStartEquity <= 0 || a.openRisk < 0 || a.openMargin < 0 || a.openPositions < 0) return reject('Kullanılabilir bakiye yok veya hesap verisi geçersiz.');
  if (a.equity <= a.dayStartEquity * (1 - settings.dailyLossPercent / 100)) return reject('Günlük kayıp sınırına ulaşıldı.');
  if (a.openPositions >= settings.maxPositions) return reject('Açık pozisyon sınırı dolu.');
  const sign = s.direction === 'long' ? 1 : -1;
  if ((s.entry - s.stop) * sign <= 0 || !aligned(s.stop, i.tickSz)) return reject('Stop yönü veya fiyat adımı geçersiz.');
  if (!s.targets.length || s.targets.some(t => !Number.isFinite(t.price) || !Number.isFinite(t.fraction) || t.fraction <= 0 || (t.price - s.entry) * sign <= 0 || !aligned(t.price, i.tickSz)) ||
      !Number.isFinite(s.runnerFraction ?? 0) || (s.runnerFraction ?? 0) < 0 || (s.runnerFraction ?? 0) >= 1 ||
      Math.abs(s.targets.reduce((sum, t) => sum + t.fraction, 0) + (s.runnerFraction ?? 0) - 1) > 1e-8) return reject('TP yönü, fiyat adımı veya dağılımı geçersiz.');
  if (s.breakEvenAtR !== undefined && (!Number.isFinite(s.breakEvenAtR) || s.breakEvenAtR <= 0)) return reject('Başabaş tetikleyicisi geçersiz.');
  if (s.trailing && (![s.trailing.activateAtR, s.trailing.distanceR].every(v => Number.isFinite(v) && v > 0))) return reject('Takip stopu geçersiz.');
  const distance = Math.abs(s.entry - s.stop);
  // Conservative margin-distance proxy, not an exchange liquidation calculation.
  if (distance / s.entry >= .5 / settings.leverage) return reject('Stop mesafesi marjin tamponunu aşıyor.');
  const costRate = (settings.feeBps + settings.slippageBps) / 10_000;
  const fundingReserve = s.entry * settings.fundingBufferBps / 10_000;
  const lossPerUnit = distance + (s.entry + s.stop) * costRate + fundingReserve;
  // Costs are a fixed headwind on every round trip. When they own a large share of the risk unit the
  // entry must be exceptionally accurate merely to break even, so refuse the trade instead of sizing it.
  if (lossPerUnit <= 0 || (lossPerUnit - distance) / lossPerUnit > settings.maxCostSharePercent / 100) return reject('İşlem maliyeti risk biriminin izin verilen payını aşıyor.');
  // Conviction scales the per-trade risk between the floor and the ceiling; an unscored signal
  // is treated as fully convicted, so existing strategies keep their previous sizing behaviour.
  const confidence = s.confidence === undefined ? 1 : s.confidence;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return reject('Güven skoru geçersiz.');
  // Settings saved before the conviction band existed carry a ceiling below the default floor, so
  // the floor is clamped rather than rejected; a stored account must never block the whole bot.
  // Fixed mode stakes a named USDT loss at the stop instead of a share of equity and sizes the
  // position backwards from the stop distance. It keeps the same conviction band by holding the
  // floor/ceiling ratio the percent mode uses, so a weak setup still risks proportionally less.
  const ratio = Math.min(1, settings.riskPercentFloor / settings.riskPercent);
  const ceiling = settings.riskMode === 'fixed' ? settings.fixedRiskUsdt : a.equity * settings.riskPercent / 100;
  const perTradeRisk = ceiling * (ratio + (1 - ratio) * confidence);
  // The portfolio caps stay a share of equity in both modes: as the account shrinks a fixed stake
  // is throttled by them rather than growing into an ever larger fraction of what is left.
  const riskBudget = Math.max(0, Math.min(perTradeRisk, a.equity * settings.totalRiskPercent / 100 - a.openRisk));
  const marginBudget = Math.max(0, Math.min(a.available * .95, a.equity * settings.maxMarginPercent / 100 - a.openMargin));
  const contracts = floorStep(Math.min(riskBudget / lossPerUnit, marginBudget / (s.entry / settings.leverage + s.entry * costRate)) / i.ctVal, i.lotSz);
  if (contracts < i.minSz || contracts <= 0) return reject('Risk bütçesi borsanın minimum miktarını karşılamıyor.');
  const quantity = contracts * i.ctVal;
  const targets = allocatedTargets(i, s, contracts);
  const runner = 1 - targets.reduce((sum, t) => sum + t.fraction, 0);
  if (s.manageAfterTp1 && s.runnerFraction && (targets[0].fraction < .8 - 1e-8 || targets[0].fraction > .9 + 1e-8)) return reject('Kontrat adımı TP1 için %80–90 dağılımını karşılamıyor.');
  if (targets.some(t => floorStep(contracts * t.fraction, i.lotSz) < i.minSz || !aligned(contracts * t.fraction, i.lotSz)) ||
      (s.runnerFraction && floorStep(contracts * runner, i.lotSz) < i.minSz)) return reject('Kısmi TP miktarı sözleşme adımına uymuyor.');
  // A staged exit's weighted reward is structurally smaller than the trade's own final target:
  // Efloud's 40% at 1.2R, 40% at 2.2R and a runner booked at zero averages 1.36R, so gating that
  // average on a 1.5 minimum silently rejected every scale-out signal the model ever produced.
  // The two questions are therefore asked separately, against the same cost model.
  const netRewardPerUnit = (price: number) => (price - s.entry) * sign - (s.entry + price) * costRate;
  // 1. Reach: the trade's furthest target must still pay minRewardRisk after costs. This is what a
  //    trader means by "at least 1.5R" and it is measured on the target the plan actually holds for.
  const finalTarget = targets.reduce((far, t) => (t.price - far.price) * sign > 0 ? t : far, targets[0]);
  const finalRewardRisk = (netRewardPerUnit(finalTarget.price) - fundingReserve) / lossPerUnit;
  if (finalRewardRisk + 1e-9 < settings.minRewardRisk) return reject('Maliyet sonrası ödül/risk yetersiz.');
  // 2. Plan: if every target fills the whole position must return more than the one risk unit it
  //    stakes. The runner contributes no assumed gain and still pays its round trip, so this floor
  //    is structural rather than tunable — below it the staged exit cannot pay for its own stop.
  const rewardPerUnit = targets.reduce((sum, t) => sum + t.fraction * netRewardPerUnit(t.price), 0) - runner * s.entry * costRate * 2 - fundingReserve;
  const rewardRisk = rewardPerUnit / lossPerUnit;
  if (rewardRisk <= planRewardRiskFloor + 1e-9) return reject('Kademeli çıkış planı maliyet sonrası risk birimini karşılamıyor.');
  const risk = quantity * lossPerUnit, margin = quantity * s.entry / settings.leverage;
  if (risk > riskBudget + 1e-8 || margin > marginBudget + 1e-8) return reject('Yuvarlama sonrası risk sınırı aşılıyor.');
  return { ok: true, contracts, quantity, risk, margin, notional: quantity * s.entry, rewardRisk };
}
