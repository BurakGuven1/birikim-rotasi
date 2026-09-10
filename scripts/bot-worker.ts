import nextEnv from '@next/env';
import { runWorker } from '../src/lib/server/bot/worker';
import { BotStore } from '../src/lib/server/bot/store';

nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => {} });
const shutdown = new AbortController();
process.once('SIGINT', () => shutdown.abort());
process.once('SIGTERM', () => shutdown.abort());

const statusStore = new BotStore();
const alreadyOnline = statusStore.workerStatus().online;
statusStore.close();
if (alreadyOnline) {
  console.log('Bot zaten çalışıyor. http://localhost:3000/bot üzerinden tarama ve backtest başlatabilirsiniz.');
} else runWorker({ once: process.argv.includes('--once'), signal: shutdown.signal, log: console.log }).catch(() => {
  console.error('Bot worker başlatılamadı veya durdu. Başka worker, veri dizini ve panel günlüğünü kontrol edin.');
  process.exitCode = 1;
});
