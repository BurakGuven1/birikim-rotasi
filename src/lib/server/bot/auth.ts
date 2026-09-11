import type { BotStore } from './store';

export class BotHttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const loopback = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);

export function assertLocalRequest(request: Request, mutation: boolean) {
  const url = new URL(request.url);
  const host = request.headers.get('host');
  // Next may reconstruct request.url with its bind address (127.0.0.1),
  // while the browser actually uses localhost. Validate the browser authority.
  const browserUrl = new URL(host ? `${url.protocol}//${host}` : url.origin);
  if (!loopback(browserUrl.hostname) || browserUrl.username || browserUrl.password || browserUrl.pathname !== '/') throw new BotHttpError(403, 'Bot paneli yalnız yerel erişime açık.');
  const forwarded = request.headers.get('x-forwarded-host');
  if (forwarded && forwarded !== browserUrl.host) throw new BotHttpError(403, 'Proxy üzerinden bot kontrolü kapalı.');
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if ((origin && origin !== browserUrl.origin) || (fetchSite && !['same-origin', 'none'].includes(fetchSite))) throw new BotHttpError(403, 'İstek kaynağı doğrulanamadı.');
  if (mutation && (origin !== browserUrl.origin || !request.headers.get('content-type')?.startsWith('application/json'))) throw new BotHttpError(403, 'Yerel JSON isteği gerekli.');
}

export function authorize(request: Request, store: BotStore) {
  assertLocalRequest(request, request.method !== 'GET');
  const token = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith('bot_session='))?.slice('bot_session='.length) ?? '';
  if (!store.validSession(token)) throw new BotHttpError(401, 'Bot oturumu açılmalı.');
}
