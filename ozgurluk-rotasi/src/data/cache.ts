import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../env.ts";

// Netlify/Lambda'da yalnızca /tmp yazılabilir; önbellek orada, sıcak örnek yaşadıkça durur.
export const CACHE_DIR = process.env.CACHE_DIR || (process.env.LAMBDA_TASK_ROOT ? join(tmpdir(), "ozgurluk-cache") : join(ROOT, "data", "cache"));

function fileFor(key: string): string {
  return join(CACHE_DIR, key.replace(/[^A-Za-z0-9._-]/g, "_") + ".json");
}

export function readCache<T>(key: string, maxAgeHours = Infinity): T | undefined {
  const f = fileFor(key);
  if (!existsSync(f)) return undefined;
  const ageH = (Date.now() - statSync(f).mtimeMs) / 3_600_000;
  if (ageH > maxAgeHours) return undefined;
  return JSON.parse(readFileSync(f, "utf8")) as T;
}

export function writeCache(key: string, data: unknown): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(fileFor(key), JSON.stringify(data));
}

/** Önbellekte tazeyse onu, değilse fetcher'ı kullanır; ağ hatasında eski önbelleğe düşer. */
export async function cached<T>(key: string, maxAgeHours: number, fetcher: () => Promise<T>): Promise<T> {
  const fresh = readCache<T>(key, maxAgeHours);
  if (fresh !== undefined) return fresh;
  try {
    const data = await fetcher();
    writeCache(key, data);
    return data;
  } catch (err) {
    const stale = readCache<T>(key);
    if (stale !== undefined) {
      console.warn(`! ${key}: ağ hatası, eski önbellek kullanılıyor (${(err as Error).message})`);
      return stale;
    }
    throw err;
  }
}
