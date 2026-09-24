export async function getJson<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchWithRetry(url, init);
  return (await res.json()) as T;
}

export async function getText(url: string, init: RequestInit = {}): Promise<string> {
  const res = await fetchWithRetry(url, init);
  return res.text();
}

async function fetchWithRetry(url: string, init: RequestInit, tries = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": "Mozilla/5.0 (ozgurluk-rotasi)", ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status} ${redact(url)}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
  }
  throw lastErr;
}

/** Hata mesajlarında API anahtarlarını gizler. */
export function redact(url: string): string {
  return url.replace(/(api_token|api_key|apikey|key)=[^&]+/gi, "$1=***");
}
