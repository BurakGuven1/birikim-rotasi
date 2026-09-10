/**
 * Server start-up. If the ETH bot was left running, the loop comes back with the app.
 *
 * This is what makes "I never pressed start" true across a reboot: the intent is stored, so the
 * next time the app is up the worker is spawned without anyone opening a page. It cannot make the
 * bot trade while the machine is off — nothing running locally can — but it does mean the only
 * thing the operator has to start is the app itself.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { BotStore } = await import('./lib/server/bot/store');
    const { ethNeedsWorker } = await import('./lib/server/bot/eth-service');
    const { ensureWorker } = await import('./lib/server/bot/runtime');
    const store = new BotStore();
    try {
      if (!ethNeedsWorker(store) || store.workerStatus().online) return;
      store.ethEvent('info', 'Uygulama açıldı; ETH bot süreci otomatik başlatılıyor.');
      await ensureWorker(store);
    } finally { store.close(); }
  } catch {
    // A missing database or a worker that will not spawn must not stop the web app from serving.
  }
}
