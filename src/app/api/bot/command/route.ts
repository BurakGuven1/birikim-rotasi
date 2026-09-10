import { readBody, withBot } from '@/lib/server/bot/http';
import { handleCommand } from '@/lib/server/bot/service';
import { ensureWorker } from '@/lib/server/bot/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return withBot(request, async store => {
    const body = await readBody(request);
    const result = handleCommand(store, body);
    const action = (body as { action?: string }).action;
    if (action !== 'settings' && !(action === 'enabled' && !(body as { enabled?: boolean }).enabled)) {
      try { return { ...result, worker: await ensureWorker(store) }; }
      catch { store.event('error', 'Bot süreci başlatılamadı; yeniden başlatmayı deneyin.'); throw new Error('Worker launch failed'); }
    }
    return result;
  });
}
