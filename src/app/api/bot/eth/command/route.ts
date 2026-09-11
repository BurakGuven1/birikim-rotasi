import { readBody, withBot } from '@/lib/server/bot/http';
import { handleEthCommand } from '@/lib/server/bot/eth-service';
import { ensureWorker } from '@/lib/server/bot/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return withBot(request, async store => {
    const body = await readBody(request);
    const result = handleEthCommand(store, body);
    const action = (body as { action?: string }).action;
    // Saving settings must never launch a process; everything else needs the loop alive to happen.
    if (action === 'settings') return result;
    try { return { ...result, worker: await ensureWorker(store) }; }
    catch { store.ethEvent('error', 'Bot süreci başlatılamadı; yeniden başlatmayı deneyin.'); throw new Error('Worker launch failed'); }
  });
}
