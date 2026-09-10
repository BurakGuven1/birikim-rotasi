import { withBot } from '@/lib/server/bot/http';
import { ethSnapshot } from '@/lib/server/bot/eth-runner';
import { ethNeedsWorker } from '@/lib/server/bot/eth-service';
import { ensureWorker } from '@/lib/server/bot/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Reading the panel is also what revives the loop. If the bot is supposed to be running and the
 * worker process is gone — the machine slept, the dev server restarted — opening this page starts
 * it again rather than showing a green switch above a bot that is not actually running.
 */
export async function GET(request: Request) {
  return withBot(request, async store => {
    if (ethNeedsWorker(store) && !store.workerStatus().online) {
      try { await ensureWorker(store); } catch { store.ethEvent('error', 'Bot süreci başlatılamadı; yeniden başlatmayı deneyin.'); }
    }
    return ethSnapshot(store);
  });
}
