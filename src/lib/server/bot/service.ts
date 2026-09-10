import { z } from 'zod';
import { getCredentialStatus, type OkxEnv } from '../okx/config';
import { OkxClient, OkxError } from '../okx/client';
import { getUniverse } from '../okx/market';
import { getLiveFrames, getPaperFunding, latestClosedTime, loadResearchData } from '../okx/research-data';
import { BotStore } from './store';
import { settingsSchema } from '../../bot/config';
import { createStrategy, getStrategy, liveInstruments, liveInterval, liveModel } from '../../bot/strategy';
import { researchWindow, runComparison, selectedInterval } from './comparison';
import { runPortfolioStudy } from './portfolio';
import { emergencyCloseLive, mirrorLive } from './live';
import { validatedBacktest } from '../../bot/validation';
import { closedContext } from '../../bot/market';
import { closePosition } from '../../bot/position';
import { replayPaperCycle, type PaperInput } from '../../bot/paper';
import { duration, intervals } from '../../bot/types';
import type { BotJob, BotSnapshot, ScanResult } from '../../bot/dashboard-types';

const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('settings'), settings: settingsSchema }).strict(),
  z.object({ action: z.literal('enabled'), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal('scan') }).strict(),
  z.object({ action: z.literal('worker') }).strict(),
  z.object({ action: z.literal('comparison'), instruments: z.array(z.string().regex(/^[A-Z0-9]+-USDT-SWAP$/)).min(1).max(20), days: z.number().int().min(7).max(1095) }).strict(),
  z.object({ action: z.literal('connection'), mode: z.enum(['live', 'demo']) }).strict(),
  z.object({ action: z.literal('backtest'), instrument: z.string().regex(/^[A-Z0-9]+-USDT-SWAP$/), days: z.number().int().min(7).max(90) }).strict(),
  z.object({ action: z.literal('portfolio'), coins: z.number().int().min(10).max(60), days: z.number().int().min(120).max(400) }).strict(),
  z.object({ action: z.literal('cancel') }).strict(),
  z.object({ action: z.literal('emergency') }).strict(),
]);

export function snapshot(store: BotStore, env: OkxEnv = process.env): BotSnapshot {
  const strategy = getStrategy();
  const settings = store.getSettings();
  return { settings, enabled: store.enabled(), mode: settings.executionMode, strategy: strategy ? { id: strategy.id, version: strategy.version } : null,
    credentials: getCredentialStatus(env), worker: store.workerStatus(), paper: store.getPaper(), scan: store.getScan(), jobs: store.listJobs(), events: store.listEvents(), backtests: store.listBacktests().slice(0, 10), comparison: store.getComparison(), portfolio: store.getPortfolio(), progress: store.getProgress(), intents: store.openIntents(), live: { model: liveModel, interval: liveInterval, instruments: [...liveInstruments] }, liveLocked: settings.executionMode !== 'live' || !settings.liveVerified };
}

export function handleCommand(store: BotStore, value: unknown) {
  const parsed = commandSchema.safeParse(value);
  if (!parsed.success) throw new Error('Geçersiz bot komutu veya ayar aralığı.');
  const command = parsed.data;
  if (command.action === 'worker') return { ok: true };
  if (command.action === 'comparison') return { ok: true, job: store.enqueue('comparison', { instruments: [...new Set(command.instruments)], days: command.days }) };
  if (command.action === 'portfolio') return { ok: true, job: store.enqueue('portfolio', { coins: command.coins, days: command.days }) };
  if (command.action === 'settings') { store.saveSettings(command.settings); return { ok: true }; }
  if (command.action === 'enabled') { store.setEnabled(command.enabled); store.event('info', command.enabled ? 'Otomatik paper tarama açıldı.' : 'Yeni paper girişleri durduruldu; açık pozisyon takibi sürer.'); return { ok: true }; }
  if (command.action === 'cancel') {
    const stopped = store.cancelJobs();
    store.event('warning', `${stopped} iş kullanıcı tarafından durduruldu.`);
    return { ok: true };
  }
  if (command.action === 'emergency') {
    // Queue behind worker fencing; this does not issue any exchange mutation.
    store.setEnabled(false);
    return { ok: true, job: store.enqueue('scan', { emergency: true }) };
  }
  return { ok: true, job: store.enqueue(command.action, command.action === 'backtest' ? { instrument: command.instrument, days: command.days } : command.action === 'connection' ? { mode: command.mode } : {}) };
}

/** An error whose message we wrote ourselves and is therefore safe to show to the operator. */
export class BotError extends Error {}

export function publicError(error: unknown): string {
  if (error instanceof BotError) return error.message;
  if (error instanceof OkxError) return `OKX isteği tamamlanamadı (${error.code}).`;
  // Never forward arbitrary exchange bodies, credentials, request URLs or stack traces.
  return 'İş tamamlanamadı. Bağlantıyı, veri kapsamını ve ayarları kontrol edin.';
}

export function emergencyQuote(quote: { bidPx?: string; askPx?: string; ts?: string } | undefined, direction: 'long' | 'short', now = Date.now()): number {
  const price = Number(direction === 'long' ? quote?.bidPx : quote?.askPx);
  const timestamp = Number(quote?.ts);
  if (!quote || !Number.isFinite(price) || price <= 0 || !Number.isSafeInteger(timestamp) || timestamp <= 0 || now - timestamp > 60_000 || timestamp - now > 10_000) throw new Error('Güncel kapatma fiyatı yok.');
  return price;
}

export async function scanMarket(store: BotStore, owner: string, emergency = false, reportProgress = true): Promise<ScanResult> {
  const client = new OkxClient({ mode: 'public' });
  const settings = store.getSettings(), strategy = getStrategy();
  const progress = (message: string, current: number, total: number, state: 'running' | 'done' | 'failed' = 'running') => {
    if (reportProgress) store.saveProgress(owner, { kind: 'scan', state, message, current, total });
  };
  progress('Piyasa listesi alınıyor…', 0, settings.scanLimit);
  const universe = await getUniverse(client);
  // The liquidity and spread filters still apply, but they narrow an allowlist rather than rank a
  // whole exchange: the traded model has evidence on those contracts and on no others.
  const selected = universe.filter(i => liveInstruments.includes(i.id) && i.maxLeverage >= settings.leverage && i.volumeUsdt !== null && i.volumeUsdt >= settings.minVolumeUsdt && i.spreadBps !== null && i.spreadBps <= settings.maxSpreadBps)
    .sort((a, b) => (b.volumeUsdt ?? 0) - (a.volumeUsdt ?? 0)).slice(0, settings.scanLimit);
  const result: ScanResult = { time: Date.now(), total: universe.length, instruments: selected, signals: [], warnings: [] };
  if (!strategy) result.warnings.push('Strateji bekleniyor; liste likidite ve spread filtresidir, işlem önerisi değildir.');
  if (!selected.length) result.warnings.push(`Filtreleri karşılayan sözleşme yok; bot yalnızca ${liveInstruments.join(', ')} üzerinde işlem açar.`);
  const previous = store.getPaper();
  if (emergency) {
    // Use a fresh executable-side quote, never a stale cached entry/close.
    const tickers = await client.get<{ instId: string; bidPx: string; askPx: string; ts: string }>('/api/v5/market/tickers?instType=SWAP');
    for (const position of previous.positions) {
      const quote = tickers.find(t => t.instId === position.instrument.id);
      const price = emergencyQuote(quote, position.direction);
      const closed = closePosition(position, price, Date.now(), settings, 'emergency');
      previous.cash += closed.realizedPnl; previous.trades.push(closed);
    }
    previous.positions = []; previous.equity = previous.cash;
    store.commitCycle(owner, previous, []);
    if (settings.executionMode === 'live') {
      // The exchange is flattened before the ledger is trusted, and any unconfirmed close is
      // escalated rather than swallowed: an open live position must never look closed here.
      const live = await emergencyCloseLive(store, settings);
      for (const message of live.critical) { store.event('error', `CANLI KRİTİK · ${message}`); result.warnings.push(message); }
      store.event(live.critical.length ? 'error' : 'warning', live.critical.length
        ? `Acil kapatma tamamlanamadı; ${live.critical.length} pozisyon borsadan elle kontrol edilmeli.`
        : `Canlı pozisyonlar için ${live.submitted} kapatma emri gönderildi ve düz olduğu doğrulandı.`);
    } else store.event('warning', 'Paper pozisyonlar güncel kotasyon ile kapatıldı. Borsaya emir gönderilmedi.');
  } else if (strategy || previous.positions.length) {
    if (!strategy) throw new Error('Açık pozisyonun stratejisi bulunamadı.');
    if (intervals.some(tf => strategy.warmup[tf] > 299)) throw new Error('Strateji ısınma gereksinimi canlı mum kapsamını aşıyor.');
    const instruments = [...selected];
    for (const p of previous.positions) if (!instruments.some(i => i.id === p.instrument.id)) {
      const current = universe.find(i => i.id === p.instrument.id);
      if (!current) throw new Error('Açık pozisyon sözleşmesi kayıp.');
      instruments.push(current);
    }
    const inputs: PaperInput[] = [];
    const now = await latestClosedTime(client);
    let fundingComplete = true;
    let examined = 0;
    for (const instrument of instruments) {
      progress(`${instrument.id.replace('-USDT-SWAP', '')} inceleniyor`, examined, instruments.length);
      try {
        const interval = selectedInterval(settings, strategy);
        const coinStrategy = createStrategy(liveModel, interval);
        const frames = await getLiveFrames(client, instrument.id);
        const context = closedContext(frames, now, coinStrategy.warmup, coinStrategy.requireBias !== false);
        context.instrument = instrument;
        if (!context.ready && !previous.positions.some(p => p.instrument.id === instrument.id)) {
          result.warnings.push(`${instrument.id}: ${context.reasons.join(' · ')}`);
          continue;
        }
        const costs = previous.lastCycle === now ? { funding: [], complete: true } : await getPaperFunding(client, instrument.id, previous.lastCycle ?? now - 900_000, now);
        fundingComplete &&= costs.complete;
        if (!costs.complete && previous.positions.some(p => p.instrument.id === instrument.id)) throw new Error('Açık pozisyonun funding kapsamı eksik; hesap ilerletilmedi.');
        if (!costs.complete) result.warnings.push(`${instrument.id}: funding kapsamı eksik; yeni girişler durduruldu.`);
        inputs.push({ instrument, frames, funding: costs.funding, strategy: coinStrategy });
        // The panel draws the traded contract from the same bars the model just read, so the chart
        // can never show a different history than the decision was made on.
        if (!result.candles) result.candles = { instrument: instrument.id, interval, bars: frames[interval].filter(bar => bar.time + duration[interval] <= now).slice(-240) };
        // The displayed signal must come from the strategy actually being traded, not a fixed model.
        const signal = context.ready ? coinStrategy.evaluate(context) : null;
        if (signal && signal.expiresAt > now) result.signals.push({ instrument: instrument.id, direction: signal.direction, reason: Object.values(signal.confirmations).join(' · ') });
      } catch (error) {
        if (previous.positions.some(p => p.instrument.id === instrument.id)) throw error;
        result.warnings.push(`${instrument.id}: veri kapsamı doğrulanamadı; tarama dışı.`);
      } finally { examined++; }
    }
    const replay = replayPaperCycle(previous, inputs, settings, strategy, now, store.enabled() && fundingComplete);
    store.commitCycle(owner, replay.state, replay.signals);
    result.warnings.push('Paper: kapanmış mum replay; funding için 15m mark açılışı yaklaşık fiyat olarak kullanılır. Gerçek dolum kanıtı değildir.');
    if (settings.executionMode === 'live') {
      // The paper cycle already decided and sized; live execution only mirrors and reconciles it.
      const known = new Set(previous.positions.map(position => position.id));
      const opened = replay.state.positions.filter(position => !known.has(position.id));
      // Closed trades are passed alongside the open ones so a position the model has finished can
      // still have its resting exchange orders cancelled and any stranded exposure closed. An
      // intent drops out of openIntents once it is verified flat, so this stays bounded.
      const live = await mirrorLive(store, owner, settings, opened, !!strategy, [...replay.state.trades, ...replay.state.positions]);
      result.warnings.push(...live.warnings);
      for (const message of live.critical) store.event('error', `CANLI KRİTİK · ${message}`);
      if (live.submitted || live.reconciled || live.synced) store.event('info', `Canlı: ${live.submitted} emir gönderildi, ${live.reconciled} pozisyon mutabakatı yapıldı, ${live.synced} pozisyonun kademeli çıkışı borsayla eşitlendi.`);
      if (!settings.liveVerified && live.submitted) result.warnings.push('Canlı doğrulama aşaması: emirler borsanın asgari kontrat boyutuyla gönderiliyor.');
      result.warnings.push('Canlı emirler modelin kademeli planını taşır: tam boy stop, hedef başına kısmi kâr emri ve her döngüde borsaya yazılan stop taşıması. Dolum fiyatları yine de borsanın gerçekleşmesine bağlıdır; geçmiş test bir dolum kanıtı değildir.');
    }
  }
  store.saveScan(owner, result);
  progress(`${selected.length} coin incelendi · ${result.signals.length} sinyal · ${store.getPaper().positions.length} açık paper işlem`, selected.length, selected.length || 1, 'done');
  return result;
}

export async function processJob(store: BotStore, owner: string, job: BotJob) {
  try {
    if (job.kind === 'scan') {
      const result = await scanMarket(store, owner, job.input.emergency === true);
      store.finishJob(owner, job.id, 'done', { message: `${result.instruments.length} sözleşme filtreyi geçti.`, total: result.total });
    } else if (job.kind === 'comparison') {
      const ids = job.input.instruments as string[], days = Number(job.input.days);
      if (!Array.isArray(ids) || !ids.length || ids.length > 20 || ids.some(id => !/^[A-Z0-9]+-USDT-SWAP$/.test(id)) || !Number.isInteger(days) || days < 7 || days > 1095) throw new BotError('Geçersiz karşılaştırma isteği.');
      const comparison = await runComparison(store, owner, ids, days, job.id);
      store.finishJob(owner, job.id, comparison.rows.length ? 'done' : 'failed', { message: `${comparison.rows.length} coin/mum sonucu hazır.`, errors: comparison.errors.length });
    } else if (job.kind === 'portfolio') {
      const coins = Number(job.input.coins), days = Number(job.input.days);
      if (!Number.isInteger(coins) || coins < 10 || coins > 60 || !Number.isInteger(days) || days < 120 || days > 400) throw new BotError('Geçersiz portföy çalışması: evren 10-60, dönem 120-400 gün olmalı.');
      const portfolio = await runPortfolioStudy(store, owner, coins, days);
      store.finishJob(owner, job.id, portfolio.walkForward ? 'done' : 'failed', { message: portfolio.walkForward ? `Dış-örnek ${portfolio.walkForward.days} gün · %${portfolio.walkForward.returnPercent.toFixed(1)}` : 'Yeterli ortak gün bulunamadı.' });
    } else if (job.kind === 'connection') {
      const mode = job.input.mode === 'demo' ? 'demo' : 'live';
      const status = getCredentialStatus()[mode];
      if (!status.configured) { store.finishJob(owner, job.id, 'blocked', { message: `Eksik yapılandırma: ${status.missing.join(', ')}` }); return; }
      const client = new OkxClient({ mode: mode === 'demo' ? 'demo' : 'live-readonly' });
      const config = await client.get<{ posMode?: string }>('/api/v5/account/config');
      const balances = await client.get<{ details?: { ccy?: string; availBal?: string; cashBal?: string }[] }>('/api/v5/account/balance?ccy=USDT');
      const usdt = balances[0]?.details?.find(d => d.ccy === 'USDT');
      const balance = Number(usdt?.availBal || usdt?.cashBal);
      store.finishJob(owner, job.id, 'done', { message: `${mode === 'demo' ? 'Demo' : 'Gerçek hesap'} okuma bağlantısı doğrulandı. Emir gönderilmedi.`, availableUsdt: Number.isFinite(balance) ? balance : null, netMode: config[0]?.posMode === 'net_mode' });
    } else if (job.kind !== 'backtest') {
      // A worker started before this build does not know newer job kinds; say so instead of
      // failing inside an unrelated branch with a generic message.
      throw new BotError('Worker bu iş tipini tanımıyor. Worker sürecini durdurup yeniden başlatın.');
    } else {
      const strategy = getStrategy();
      if (!strategy) { store.finishJob(owner, job.id, 'blocked', { message: 'Strateji henüz tanımlanmadı; backtest sonucu üretilmedi.' }); return; }
      const client = new OkxClient({ mode: 'public' });
      store.saveProgress(owner, { kind: 'backtest', state: 'running', message: 'Geçmiş veriler yükleniyor…', current: 0, total: 1 });
      const id = String(job.input.instrument), days = Number(job.input.days);
      if (!Number.isInteger(days) || days < 7 || days > 90) throw new BotError('Geçersiz dönem: 7-90 gün olmalı.');
      const instrument = (await getUniverse(client)).find(i => i.id === id);
      if (!instrument) throw new BotError('Sözleşme aktif kripto evreninde bulunamadı.');
      const { from, to } = await researchWindow(store, [id], days, client);
      const data = await loadResearchData(client, id, { from, to });
      const result = validatedBacktest({ ...data, instrument, strategy, settings: store.getSettings(), from, to });
      result.warnings.push(...data.warnings);
      store.saveBacktest(owner, result);
      store.finishJob(owner, job.id, 'done', { message: `${result.metrics.trades} işlem replay edildi; maliyet/veri sınırları raporda.`, metrics: result.metrics });
      store.saveProgress(owner, { kind: 'backtest', state: 'done', message: `${result.metrics.trades} işlem hesaplandı.`, current: 1, total: 1 });
    }
  } catch (error) {
    const message = publicError(error);
    store.finishJob(owner, job.id, 'failed', { message });
    store.event('error', message);
    if (job.kind !== 'connection') store.saveProgress(owner, { kind: job.kind, state: 'failed', message, current: 0, total: 1 });
  }
}
