import { createHmac } from 'node:crypto';
import { getBaseUrl, getCredentials, type OkxEnv, type OkxMode } from './config';

const publicPaths = new Set(['/api/v5/public/time', '/api/v5/public/instruments', '/api/v5/public/funding-rate', '/api/v5/public/funding-rate-history', '/api/v5/market/tickers', '/api/v5/market/candles', '/api/v5/market/history-candles', '/api/v5/market/history-mark-price-candles', '/api/v5/rubik/stat/contracts/open-interest-volume']);
const privatePaths = new Set(['/api/v5/account/balance', '/api/v5/account/positions', '/api/v5/account/config', '/api/v5/account/leverage-info', '/api/v5/account/trade-fee', '/api/v5/trade/order', '/api/v5/trade/orders-pending', '/api/v5/trade/orders-history', '/api/v5/trade/orders-algo-pending', '/api/v5/trade/order-algo', '/api/v5/trade/fills']);
const demoPaths = new Set(['/api/v5/trade/order', '/api/v5/trade/cancel-order', '/api/v5/trade/amend-order', '/api/v5/trade/order-algo', '/api/v5/trade/cancel-algos', '/api/v5/trade/amend-algos', '/api/v5/account/set-leverage']);
export function signRequest(secret: string, timestamp: string, method: string, path: string, body = '') {
  return createHmac('sha256', secret).update(timestamp + method.toUpperCase() + path + body).digest('base64');
}
export class OkxError extends Error {
  constructor(public readonly code: string, public readonly retryable = false, public readonly outcomeUnknown = false) { super(`okx_${code}${outcomeUnknown ? '_outcome_unknown' : ''}`); this.name = 'OkxError'; }
}
export class OkxClient {
  readonly mode: OkxMode;
  #env: OkxEnv;
  #fetch: typeof fetch;
  #base: string;
  #offset = 0;
  #syncedAt = 0;
  #syncing?: Promise<void>;
  constructor(options: { mode: OkxMode; env?: OkxEnv; fetch?: typeof fetch }) {
    this.mode = options.mode;
    this.#env = { ...(options.env ?? process.env) };
    this.#base = getBaseUrl(this.#env);
    this.#fetch = options.fetch ?? fetch;
  }
  async get<T>(path: string): Promise<T[]> { return this.#request<T>('GET', path); }
  /** Order submission. Only 'demo' and 'live' may write; every other mode is read-only. */
  async post<T>(path: string, body: unknown): Promise<T[]> {
    if (this.mode !== 'demo' && this.mode !== 'live') throw new OkxError('live_execution_locked');
    return this.#request<T>('POST', path, JSON.stringify(body));
  }
  /** @deprecated Use post; kept so existing demo call sites keep working. */
  async demoPost<T>(path: string, body: unknown): Promise<T[]> { return this.post<T>(path, body); }
  async #sync(): Promise<void> {
    if (this.#syncedAt && Date.now() - this.#syncedAt < 60000) return;
    if (!this.#syncing) this.#syncing = (async () => {
      const start = Date.now();
      const rows = await this.get<{ ts: string }>('/api/v5/public/time');
      const ts = Number(rows[0]?.ts);
      if (!Number.isFinite(ts) || ts <= 0) throw new OkxError('invalid_time');
      this.#offset = ts - (start + Date.now()) / 2;
      this.#syncedAt = Date.now();
    })().finally(() => { this.#syncing = undefined; });
    return this.#syncing;
  }
  async #request<T>(method: 'GET' | 'POST', path: string, body = ''): Promise<T[]> {
    // Public statistics endpoints (rubik) sit deeper than two segments; the charset stays restricted.
    if (!/^\/api\/v5(?:\/[a-z-]+){2,4}(?:\?[^#\s\\]*)?$/.test(path)) throw new OkxError('endpoint_blocked');
    const route = path.split('?')[0];
    const isPublic = method === 'GET' && publicPaths.has(route);
    if (method === 'POST' ? (!demoPaths.has(route) || path.includes('?') || (this.mode !== 'demo' && this.mode !== 'live')) : (!isPublic && !privatePaths.has(route))) throw new OkxError('endpoint_blocked');
    if (!isPublic && this.mode === 'public') throw new OkxError('private_endpoint_blocked');
    const credentials = isPublic ? undefined : getCredentials(this.mode as Exclude<OkxMode, 'public'>, this.#env);
    if (credentials) await this.#sync();
    const attempts = method === 'GET' ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (credentials) {
          const timestamp = new Date(Date.now() + this.#offset).toISOString();
          Object.assign(headers, { 'OK-ACCESS-KEY': credentials.key, 'OK-ACCESS-PASSPHRASE': credentials.passphrase, 'OK-ACCESS-TIMESTAMP': timestamp, 'OK-ACCESS-SIGN': signRequest(credentials.secret, timestamp, method, path, body) });
          if (this.mode === 'demo') headers['x-simulated-trading'] = '1';
        }
        const response = await this.#fetch(this.#base + path, { method, headers, ...(method === 'POST' ? { body } : {}), signal: controller.signal, redirect: 'error', cache: 'no-store' });
        if (!response.ok) throw new OkxError(`http_${response.status}`, response.status === 429 || response.status >= 500, method === 'POST');
        const result: unknown = await response.json();
        if (!result || typeof result !== 'object' || !('code' in result) || !('data' in result)) throw new OkxError('invalid_response', false, method === 'POST');
        const { code, data } = result;
        if (typeof code !== 'string' || !/^\d{1,8}$/.test(code)) throw new OkxError('invalid_response', false, method === 'POST');
        if (code !== '0') throw new OkxError(code, code === '50011' || code === '50040', method === 'POST' && code === '50004');
        if (!Array.isArray(data)) throw new OkxError('invalid_response', false, method === 'POST');
        if (method === 'POST') {
          if (!data.length) throw new OkxError('invalid_acknowledgment', false, true);
          const leverage = route === '/api/v5/account/set-leverage';
          for (const row of data) {
            if (!row || typeof row !== 'object' || Array.isArray(row)) throw new OkxError('invalid_acknowledgment', false, true);
            if (leverage) {
              if (typeof row.instId !== 'string' || !/^[A-Z0-9]+-USDT-SWAP$/.test(row.instId) || typeof row.lever !== 'string' || !Number.isFinite(Number(row.lever)) || Number(row.lever) <= 0 || row.mgnMode !== 'isolated' || row.posSide !== 'net') throw new OkxError('invalid_acknowledgment', false, true);
            } else {
              if (typeof row.sCode !== 'string' || !/^\d{1,8}$/.test(row.sCode)) throw new OkxError('invalid_acknowledgment', false, true);
              const id = route.includes('algo') ? row.algoId : row.ordId;
              if (row.sCode === '0' && (typeof id !== 'string' || !/^[1-9]\d*$/.test(id))) throw new OkxError('invalid_acknowledgment', false, true);
            }
          }
        }
        for (const row of data) if (row && typeof row === 'object' && 'sCode' in row && row.sCode !== '0') {
          const valid = typeof row.sCode === 'string' && /^\d{1,8}$/.test(row.sCode);
          throw new OkxError(valid ? row.sCode : 'invalid_response', false, method === 'POST' && (!valid || row.sCode === '50004' || data.some((item) => item?.sCode === '0')));
        }
        return data as T[];
      } catch (cause) {
        const error = cause instanceof OkxError ? cause : new OkxError(controller.signal.aborted ? 'timeout' : 'transport', true, method === 'POST');
        if (!error.retryable || attempt + 1 === attempts) throw error;
      } finally { clearTimeout(timeout); }
      await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
    }
    throw new OkxError('unreachable');
  }
}
