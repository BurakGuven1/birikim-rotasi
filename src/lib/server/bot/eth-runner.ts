import { OkxClient, OkxError } from '../okx/client';
import { getCandles, getHistoricalCandles, getUniverse } from '../okx/market';
import { latestClosedTime } from '../okx/research-data';
import { getCredentialStatus, type OkxEnv } from '../okx/config';
import { clearEthOrders, closeEthPosition, ethClientId, readEthExchange, setEthLeverage, submitEthEntry, syncEthProtection } from '../okx/eth-exchange';
import { decideEth, ETH_INSTRUMENT, ETH_LIVE_WINDOW, type EthLiveDecision } from '../../bot/eth-live';
import type { EthOpenTrade, EthRuntimeState, EthSettings, EthSnapshot } from '../../bot/eth-config';
import type { Candle, Instrument } from '../../bot/types';
import type { BotStore } from './store';

/**
 * The ETH Momentum Breakout bot's own loop: one instrument, one timeframe, one set of rules.
 *
 * It shares the worker process and the database with the scanner bot and nothing else. The rules
 * are not restated here — `decideEth` replays the tested engine and this module only carries what
 * that engine decided to the real account and reads back what the account actually did.
 *
 * Two invariants hold everything together. The exchange is the truth about money: if it says flat,
 * the bot is flat, whatever the replay believes. And the bot owns only what it opened: a position
 * or a resting order it has no record of placing is the account owner's, and is left alone.
 */
const SPAN_15M = 900_000;

interface Frames { bars15m: Candle[]; bars1H: Candle[]; barsDaily: Candle[]; loadedAt: number }
let frameCache: Frames | null = null;
let instrumentCache: { instrument: Instrument; loadedAt: number } | null = null;

const merge = (existing: Candle[], fresh: Candle[]): Candle[] => {
  const map = new Map(existing.map(bar => [bar.time, bar]));
  for (const bar of fresh) map.set(bar.time, bar);
  return [...map.values()].sort((a, b) => a.time - b.time);
};

/** ETH's contract spec, refreshed hourly. Lot size and contract value decide every order size. */
async function ethInstrument(client: OkxClient): Promise<Instrument> {
  if (instrumentCache && Date.now() - instrumentCache.loadedAt < 3_600_000) return instrumentCache.instrument;
  const found = (await getUniverse(client)).find(item => item.id === ETH_INSTRUMENT);
  if (!found) throw new Error('ETH-USDT-SWAP sözleşmesi OKX aktif listesinde bulunamadı.');
  instrumentCache = { instrument: found, loadedAt: Date.now() };
  return found;
}

/**
 * The bars the model reads, kept warm between cycles.
 *
 * The first load pages back far enough for the engine's own warmup; later cycles only ask for the
 * newest 300 of each frame and merge them in. Re-downloading twelve days of 15m candles once a
 * minute would rate-limit the account for no gain — the old bars do not change.
 */
export async function loadEthFrames(client: OkxClient, now: number): Promise<Frames> {
  const fresh = async () => ({
    bars15m: await getCandles(client, ETH_INSTRUMENT, '15m', 300),
    bars1H: await getCandles(client, ETH_INSTRUMENT, '1H', 300),
    barsDaily: await getCandles(client, ETH_INSTRUMENT, '1Dutc', 300),
  });
  if (frameCache && now - frameCache.loadedAt < 6 * 3_600_000 && frameCache.bars15m.length >= ETH_LIVE_WINDOW * .8) {
    const latest = await fresh();
    frameCache = {
      bars15m: merge(frameCache.bars15m, latest.bars15m).slice(-(ETH_LIVE_WINDOW + 200)),
      bars1H: merge(frameCache.bars1H, latest.bars1H).slice(-400),
      barsDaily: merge(frameCache.barsDaily, latest.barsDaily).slice(-400),
      loadedAt: frameCache.loadedAt,
    };
    return frameCache;
  }
  const history = await getHistoricalCandles(client, ETH_INSTRUMENT, '15m', {
    from: now - (ETH_LIVE_WINDOW + 100) * SPAN_15M, to: now, maxPages: 16,
  });
  const latest = await fresh();
  frameCache = {
    bars15m: merge(history, latest.bars15m).slice(-(ETH_LIVE_WINDOW + 200)),
    bars1H: latest.bars1H, barsDaily: latest.barsDaily, loadedAt: now,
  };
  return frameCache;
}

/** Contracts to send, from the account's own equity. Never more than the configured ceiling. */
export function ethOrderSize(input: { equityUsdt: number; price: number; instrument: Instrument; settings: EthSettings }): { contracts: number; notional: number; reason: string | null } {
  const { equityUsdt, price, instrument, settings } = input;
  if (!Number.isFinite(equityUsdt) || equityUsdt < settings.minEquityUsdt) return { contracts: 0, notional: 0, reason: `Hesap bakiyesi ${settings.minEquityUsdt} USDT alt sınırının altında.` };
  if (!Number.isFinite(price) || price <= 0) return { contracts: 0, notional: 0, reason: 'Geçerli ETH fiyatı okunamadı.' };
  const notional = Math.min(equityUsdt * settings.equityPercent / 100 * settings.leverage, settings.maxNotionalUsdt);
  const raw = notional / (instrument.ctVal * price);
  const lot = instrument.lotSz > 0 ? instrument.lotSz : 1;
  const contracts = Number((Math.floor(raw / lot) * lot).toFixed(8));
  if (contracts < instrument.minSz || contracts <= 0) return { contracts: 0, notional, reason: `Hesaplanan büyüklük borsanın asgari emrinin (${instrument.minSz} kontrat) altında.` };
  return { contracts, notional: contracts * instrument.ctVal * price, reason: null };
}

function emptyState(): EthRuntimeState {
  return { updatedAt: Date.now(), cycleAt: null, barTime: null, decision: null, exchange: null, openTrade: null, actions: [], lastError: null };
}

export function ethPublicError(error: unknown): string {
  if (error instanceof OkxError) return `OKX isteği tamamlanamadı (${error.code}).`;
  if (error instanceof Error && /^[^<>]{0,200}$/.test(error.message) && !/[\\/]/.test(error.message)) return error.message;
  return 'ETH bot döngüsü tamamlanamadı. Bağlantıyı ve veri kapsamını kontrol edin.';
}

/**
 * One full pass: read the market, ask the model, then make the account match the answer.
 *
 * Every exchange write is reserved in the database first, keyed by the bar and the exact prices it
 * carries. A cycle that dies halfway and runs again cannot therefore send a second entry for the
 * same bar, and a worker restarted mid-order picks up where it left off instead of doubling down.
 */
export async function runEthCycle(store: BotStore, owner: string, env: OkxEnv = process.env): Promise<EthRuntimeState> {
  const settings = store.getEthSettings();
  const enabled = store.ethEnabled();
  const previous = store.getEthState() ?? emptyState();
  const state: EthRuntimeState = { ...previous, updatedAt: Date.now(), cycleAt: Date.now(), actions: [], lastError: null };

  const publicClient = new OkxClient({ mode: 'public', env });
  const now = await latestClosedTime(publicClient);
  const instrument = await ethInstrument(publicClient);
  const frames = await loadEthFrames(publicClient, now);

  let decision: EthLiveDecision;
  try {
    decision = decideEth({
      instrument, bars15m: frames.bars15m, bars1H: frames.bars1H, barsDaily: frames.barsDaily, now,
      settings: { initialEquity: Math.max(settings.minEquityUsdt, 100), leverage: settings.leverage, equityPercent: settings.equityPercent,
        commissionPercent: settings.commissionPercent, slippageTicks: settings.slippageTicks, direction: settings.direction },
    });
  } catch (error) {
    // A decision that cannot be made is not a decision to do nothing quietly: the previous plan
    // stays on the exchange, protecting whatever is open, and the failure is stated.
    state.lastError = ethPublicError(error);
    store.ethEvent('error', state.lastError);
    store.saveEthState(owner, state);
    return state;
  }
  state.decision = decision;
  state.barTime = decision.state.barTime;

  const credentials = getCredentialStatus(env).live;
  if (settings.mode !== 'live') {
    state.exchange = null;
    store.saveEthState(owner, state);
    return state;
  }
  if (!credentials.configured) {
    state.lastError = `Canlı mod seçili ama API anahtarı eksik: ${credentials.missing.join(', ')}.`;
    store.saveEthState(owner, state);
    return state;
  }

  const client = new OkxClient({ mode: 'live', env });
  const exchange = await readEthExchange(client, ETH_INSTRUMENT, !!state.openTrade);
  state.exchange = exchange;

  // ---- Reconcile first: the exchange decides what is true. ----
  if (!exchange.position && state.openTrade) {
    const cleared = await clearEthOrders(client, ETH_INSTRUMENT);
    store.ethEvent('info', `Pozisyon borsada kapandı. Kalan ${cleared} koruma emri iptal edildi.`);
    state.actions.push('Pozisyon kapandı; koruma emirleri temizlendi.');
    state.openTrade = null;
  }
  if (exchange.foreign) {
    state.lastError = 'Hesapta bota ait olmayan bir ETH pozisyonu var. Bot ona dokunmaz; kapatana kadar yeni işlem açmaz.';
    store.saveEthState(owner, state);
    return state;
  }

  const plan = decision.state.position;
  const pending = decision.state.pending;

  // ---- An open position the bot owns: keep the exchange holding the model's current plan. ----
  if (exchange.position && state.openTrade) {
    const held = exchange.position.contracts;
    if (!plan) {
      // The replay has already exited this trade — its stop or target filled in the candle data
      // even though the exchange has not reported it. Nothing is left managing the position, so it
      // is closed at market rather than left running without a plan.
      const clientOrderId = ethClientId('exit', ETH_INSTRUMENT, state.openTrade.barTime, held, 'model-flat');
      if (store.reserveEthOrder(clientOrderId, { reason: 'model-flat', held })) {
        await closeEthPosition(client, { id: ETH_INSTRUMENT, direction: exchange.position.direction, contracts: held, clientOrderId });
        await clearEthOrders(client, ETH_INSTRUMENT);
        store.ethEvent('warning', 'Model bu işlemden çıktı; borsadaki pozisyon piyasa emriyle kapatıldı.');
        state.actions.push('Model çıkışı: pozisyon kapatıldı.');
        state.openTrade = null;
      }
    } else if (pending?.kind === 'close') {
      const reason = pending.reason === 'timeout' ? 'süre sınırı' : pending.reason === 'stagnation' ? 'duraklama' : pending.reason;
      const clientOrderId = ethClientId('exit', ETH_INSTRUMENT, decision.state.barTime, held, pending.reason);
      if (store.reserveEthOrder(clientOrderId, { reason: pending.reason, held })) {
        await closeEthPosition(client, { id: ETH_INSTRUMENT, direction: exchange.position.direction, contracts: held, clientOrderId });
        await clearEthOrders(client, ETH_INSTRUMENT);
        store.ethEvent('info', `Model kapatma kuralı (${reason}); pozisyon piyasa emriyle kapatıldı.`);
        state.actions.push(`Kapatma kuralı: ${reason}.`);
        state.openTrade = null;
      }
    } else {
      const lot = instrument.lotSz > 0 ? instrument.lotSz : 1;
      const partial = plan.partialFilled ? 0 : Number((Math.floor(held * plan.tp1Fraction / lot) * lot).toFixed(8));
      const target = partial >= instrument.minSz && partial < held ? { price: plan.tp1, contracts: partial } : null;
      const runnerSize = target ? Number((held - target.contracts).toFixed(8)) : 0;
      const runner = target && runnerSize >= instrument.minSz ? { price: plan.tp2, contracts: runnerSize } : null;
      const notes = await syncEthProtection(client, { id: ETH_INSTRUMENT, direction: plan.direction, contracts: held, stop: plan.stop, target, runner });
      state.actions.push(...notes);
      if (notes.length) store.ethEvent('info', notes.join(' '));
      state.openTrade = { ...state.openTrade, stop: plan.stop, tp1: plan.tp1, tp2: plan.tp2, contracts: held };
    }
    store.saveEthState(owner, state);
    return state;
  }

  // ---- Flat: take the entry the model decided at the last close, if the bot is running. ----
  if (!enabled) { store.saveEthState(owner, state); return state; }
  if (pending?.kind !== 'entry') { store.saveEthState(owner, state); return state; }

  const size = ethOrderSize({ equityUsdt: exchange.balanceUsdt ?? NaN, price: decision.state.close, instrument, settings });
  if (!size.contracts) {
    state.lastError = `Sinyal var ama emir gönderilemedi: ${size.reason}`;
    store.ethEvent('warning', state.lastError);
    store.saveEthState(owner, state);
    return state;
  }

  const clientOrderId = ethClientId('entry', ETH_INSTRUMENT, decision.state.barTime, pending.direction, size.contracts);
  if (!store.reserveEthOrder(clientOrderId, { barTime: decision.state.barTime, direction: pending.direction, contracts: size.contracts, stop: pending.stop })) {
    // Already sent for this bar; the next cycle will see the position and start managing it.
    store.saveEthState(owner, state);
    return state;
  }
  await setEthLeverage(client, ETH_INSTRUMENT, settings.leverage);
  await submitEthEntry(client, { id: ETH_INSTRUMENT, direction: pending.direction, contracts: size.contracts, stop: pending.stop, clientOrderId });
  const trade: EthOpenTrade = { clientOrderId, barTime: decision.state.barTime, direction: pending.direction, contracts: size.contracts, openedAt: Date.now(), stop: pending.stop, tp1: pending.tp1, tp2: pending.tp2 };
  state.openTrade = trade;
  state.actions.push(`Giriş: ${pending.direction === 'long' ? 'Long' : 'Short'} ${size.contracts} kontrat · stop ${pending.stop.toFixed(2)}`);
  store.ethEvent('info', `ETH ${pending.direction === 'long' ? 'LONG' : 'SHORT'} açıldı · ${size.contracts} kontrat · ~${size.notional.toFixed(0)} USDT büyüklük · stop ${pending.stop.toFixed(2)} · TP1 ${pending.tp1.toFixed(2)}`);
  store.saveEthState(owner, state);
  store.pruneEthOrders();
  return state;
}

/** Closes whatever the bot holds and takes its orders off the book. The panel's kill switch. */
export async function ethEmergencyClose(store: BotStore, owner: string, env: OkxEnv = process.env): Promise<string[]> {
  const settings = store.getEthSettings();
  const notes: string[] = [];
  store.setEthEnabled(false);
  if (settings.mode !== 'live' || !getCredentialStatus(env).live.configured) return ['Canlı mod kapalı; borsaya emir gönderilmedi.'];
  const client = new OkxClient({ mode: 'live', env });
  const state = store.getEthState() ?? emptyState();
  const exchange = await readEthExchange(client, ETH_INSTRUMENT, !!state.openTrade);
  if (exchange.position && state.openTrade) {
    const clientOrderId = ethClientId('exit', ETH_INSTRUMENT, Date.now(), exchange.position.contracts, 'emergency');
    await closeEthPosition(client, { id: ETH_INSTRUMENT, direction: exchange.position.direction, contracts: exchange.position.contracts, clientOrderId });
    notes.push(`${exchange.position.contracts} kontrat için kapatma emri gönderildi.`);
  } else if (exchange.position) notes.push('Borsadaki ETH pozisyonu bota ait değil; kapatılmadı.');
  const cleared = await clearEthOrders(client, ETH_INSTRUMENT);
  notes.push(`${cleared} koruma emri iptal edildi.`);
  store.ethEvent('warning', `Acil kapatma: ${notes.join(' ')}`);
  const after = await readEthExchange(client, ETH_INSTRUMENT, false);
  if (after.position) { notes.push('UYARI: pozisyon hâlâ açık görünüyor; OKX üzerinden elle kontrol edin.'); store.ethEvent('error', 'Acil kapatma sonrası pozisyon düz doğrulanamadı.'); }
  else store.saveEthState(owner, { ...state, updatedAt: Date.now(), openTrade: null, exchange: after, actions: notes, lastError: null });
  return notes;
}

export function ethSnapshot(store: BotStore, env: OkxEnv = process.env): EthSnapshot {
  return {
    settings: store.getEthSettings(),
    enabled: store.ethEnabled(),
    credentials: getCredentialStatus(env).live,
    worker: store.workerStatus(),
    state: store.getEthState(),
    events: store.listEthEvents(),
    instrument: ETH_INSTRUMENT,
    strategy: { id: 'ETH Momentum Breakout v15', interval: '15m' },
  };
}
