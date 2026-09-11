import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BotStore } from './store';

/** Called only after local session authorization. Worker owns the SQLite lease. */
export async function ensureWorker(store: BotStore): Promise<'online' | 'starting'> {
  if (store.workerStatus().online) return 'online';
  if (store.requestWorkerStart()) {
    const directory = resolve(process.env.BOT_DATA_DIR || '.bot-data');
    mkdirSync(directory, { recursive: true });
    const output = openSync(resolve(directory, 'worker.log'), 'a');
    const env: NodeJS.ProcessEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path')), NODE_ENV: process.env.NODE_ENV };
    env.Path = process.env.Path ?? process.env.PATH;
    store.requestWorkerStop(false);
    try {
      const child = spawn(process.execPath, ['--import', 'tsx', resolve(process.cwd(), 'scripts/bot-worker.ts')], {
        cwd: process.cwd(), env, detached: true, windowsHide: true, stdio: ['ignore', output, output],
      });
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      writeFileSync(resolve(directory, 'worker-process.json'), JSON.stringify({ pid: child.pid, startedAt: Date.now(), version: 2 }));
      child.unref();
    } finally { closeSync(output); }
  }
  const deadline = Date.now() + 2_000;
  while (!store.workerStatus().online && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  return store.workerStatus().online ? 'online' : 'starting';
}
