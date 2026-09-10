import { BotStore } from './store';
import { authorize, BotHttpError } from './auth';

export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export async function withBot(request: Request, work: (store: BotStore) => unknown | Promise<unknown>) {
  const store = new BotStore();
  try {
    authorize(request, store);
    return json(await work(store));
  } catch (error) {
    if (error instanceof BotHttpError) return json({ error: error.message }, error.status);
    return json({ error: 'İstek tamamlanamadı. Ayar aralıklarını ve bekleyen işleri kontrol edin.' }, 400);
  } finally { store.close(); }
}

export async function readBody(request: Request): Promise<unknown> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (!Number.isFinite(length) || length > 16_384) throw new BotHttpError(413, 'İstek çok büyük.');
  const reader = request.body?.getReader();
  if (!reader) throw new BotHttpError(400, 'JSON gövdesi gerekli.');
  let bytes = 0, text = '';
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 16_384) { await reader.cancel(); throw new BotHttpError(413, 'İstek çok büyük.'); }
    text += decoder.decode(value, { stream: true });
  }
  return JSON.parse(text + decoder.decode());
}
