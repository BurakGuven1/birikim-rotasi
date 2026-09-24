/** Basit tohumlanabilir RNG (mulberry32) — tekrarlanabilir sonuçlar için. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface McResult {
  horizonYears: number;
  p10: number;
  p50: number;
  p90: number;
  probTarget: number;
}

/**
 * Blok bootstrap: geçmiş REEL aylık getirilerden 12 aylık bloklar çekerek birikim
 * yolunu simüle eder. Katkılar reel olarak sabit (enflasyonla artırıldığı varsayımı).
 */
export function monteCarlo(
  realMonthly: number[],
  opts: { monthly: number; annual: number; horizons: number[]; target: number; paths?: number; block?: number; seed?: number },
): McResult[] {
  const paths = opts.paths ?? 5000;
  const block = opts.block ?? 12;
  const rand = rng(opts.seed ?? 42);
  const maxH = Math.max(...opts.horizons) * 12;
  const finals: Record<number, number[]> = {};
  for (const h of opts.horizons) finals[h] = [];
  for (let p = 0; p < paths; p++) {
    let v = 0;
    let m = 0;
    while (m < maxH) {
      const start = Math.floor(rand() * (realMonthly.length - block));
      for (let k = 0; k < block && m < maxH; k++, m++) {
        v = (v + opts.monthly + (m % 12 === 0 ? opts.annual : 0)) * (1 + realMonthly[start + k]);
        if ((m + 1) % 12 === 0 && finals[(m + 1) / 12]) finals[(m + 1) / 12].push(v);
      }
    }
  }
  return opts.horizons.map((h) => {
    const xs = finals[h].sort((a, b) => a - b);
    const q = (p: number) => xs[Math.floor(p * (xs.length - 1))];
    return { horizonYears: h, p10: q(0.1), p50: q(0.5), p90: q(0.9), probTarget: xs.filter((x) => x >= opts.target).length / xs.length };
  });
}

/** Sabit reel getiriyle birikim (ay sonu katkı, yıl başı ek katkı). */
export function futureValue(realAnnual: number, years: number, monthly: number, annual: number): number {
  const rm = (1 + realAnnual) ** (1 / 12) - 1;
  let v = 0;
  for (let m = 0; m < years * 12; m++) v = (v + monthly + (m % 12 === 0 ? annual : 0)) * (1 + rm);
  return v;
}
