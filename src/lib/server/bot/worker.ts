import { randomUUID } from 'node:crypto';
import { BotStore } from './store';
import { processJob, publicError, scanMarket } from './service';
import { ethEmergencyClose, ethPublicError, runEthCycle } from './eth-runner';

export async function runWorker(options: { once?: boolean; signal?: AbortSignal; store?: BotStore; log?: (message: string) => void } = {}) {
  const store = options.store ?? new BotStore();
  const owner = randomUUID();
  if (!store.acquireLease(owner, Date.now(), 60_000)) {
    if (!options.store) store.close();
    throw new Error('Başka bir bot worker zaten çalışıyor.');
  }
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    try { if (!store.heartbeat(owner, Date.now(), 60_000)) leaseLost = true; }
    catch { leaseLost = true; }
  }, 5_000);
  let nextScan = 0, nextEth = 0;
  let research: Promise<void> | null = null;
  let researchError: unknown;
  const log = (message: string) => options.log?.(`[${new Date().toLocaleTimeString('tr-TR')}] ${message}`);
  store.event('info', 'Paper worker başladı. Canlı emir gönderimi kilitli.');
  log('Bot hazır · paper modu · panel komutları bekleniyor.');
  try {
    do {
      if (leaseLost || options.signal?.aborted || store.workerStopRequested()) break;
      if (researchError) throw researchError;
      const job = store.claimJob(owner, Date.now(), research !== null);
      if (job) {
        log(`${job.kind === 'comparison' ? 'Coin/mum karşılaştırması' : job.kind === 'scan' ? 'Tarama' : job.kind === 'backtest' ? 'Backtest' : 'Bağlantı denetimi'} başladı.`);
        if (!options.once && (job.kind === 'comparison' || job.kind === 'backtest')) {
          research = processJob(store, owner, job).catch(error => { researchError = error; }).finally(() => { research = null; log('Geçmiş veri işi tamamlandı; sonuç panelde.'); });
        } else { await processJob(store, owner, job); log('İş tamamlandı; sonuç panelde.'); }
      }
      if ((store.enabled() || store.getPaper().positions.length > 0) && Date.now() >= nextScan && job?.kind !== 'scan') {
        try { log('Piyasa taranıyor…'); const scan = await scanMarket(store, owner, false, research === null); log(`${scan.instruments.length} coin · ${scan.signals.length} sinyal · ${store.getPaper().positions.length} açık işlem.`); }
        catch (error) { store.setEnabled(false); store.event('error', `${publicError(error)} Yeni girişler durduruldu.`); log(publicError(error)); if (!research) store.saveProgress(owner, { kind: 'scan', state: 'failed', message: publicError(error), current: 0, total: 1 }); }
        nextScan = Date.now() + 60_000;
      }
      if (job?.kind === 'scan') nextScan = Date.now() + 60_000;

      // The ETH bot runs on its own clock, independent of the scanner. It keeps running while a
      // position is open even after the operator switches it off: stopping the bot means taking no
      // new entries, never abandoning a leveraged position without a trailing stop behind it.
      if (store.ethEmergencyRequested()) {
        store.requestEthEmergency(false);
        try { const notes = await ethEmergencyClose(store, owner); log(`ETH acil kapatma · ${notes.join(' ')}`); }
        catch (error) { const message = ethPublicError(error); store.ethEvent('error', `Acil kapatma başarısız: ${message}`); log(`ETH acil kapatma başarısız · ${message}`); }
        nextEth = 0;
      }
      const ethActive = store.ethEnabled() || !!store.getEthState()?.openTrade;
      if (ethActive && (Date.now() >= nextEth || store.ethCycleRequested())) {
        store.requestEthCycle(false);
        try {
          const state = await runEthCycle(store, owner);
          const position = state.exchange?.position;
          log(`ETH ${state.decision?.state.position ? 'pozisyonda' : 'bekliyor'} · ${position ? `${position.contracts} kontrat açık` : 'borsada pozisyon yok'}${state.decision?.state.blocked ? ` · ${state.decision.state.blocked}` : ''}`);
        } catch (error) {
          const message = ethPublicError(error);
          store.ethEvent('error', message);
          log(`ETH bot döngüsü başarısız · ${message}`);
        }
        nextEth = Date.now() + 60_000;
      }
      if (options.once) break;
      await new Promise<void>(resolve => {
        const stop = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', stop); resolve(); };
        const timer = setTimeout(stop, 1_000);
        options.signal?.addEventListener('abort', stop, { once: true });
      });
    } while (!options.signal?.aborted);
  } finally {
    // Finish in-flight public replay before relinquishing the lease; never orphan its writes.
    if (research) await research;
    clearInterval(heartbeat);
    store.releaseLease(owner);
    store.event('info', leaseLost ? 'Worker sahipliği kayboldu; bu süreç durdu.' : 'Worker durdu.');
    log('Worker durdu.');
    if (!options.store) store.close();
  }
}
