import { assertLocalRequest, BotHttpError } from '@/lib/server/bot/auth';
import { BotStore } from '@/lib/server/bot/store';
import { json } from '@/lib/server/bot/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    assertLocalRequest(request, true);
    const store = new BotStore();
    try {
      const response = json({ ok: true });
      const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
      response.headers.set('Set-Cookie', `bot_session=${store.createSession()}; HttpOnly; SameSite=Strict; Path=/api/bot; Max-Age=86400${secure}`);
      return response;
    } finally { store.close(); }
  } catch (error) {
    return json({ error: error instanceof BotHttpError ? error.message : 'Yerel bot oturumu açılamadı.' }, error instanceof BotHttpError ? error.status : 503);
  }
}
