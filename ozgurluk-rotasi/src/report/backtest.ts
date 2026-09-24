import { ASSET_IDS, ASSETS, PLAN, STRATEGIC_WEIGHTS, STRATEGIES, STRATEGY_KEYS, SWING, type SwingStrategyId } from "../config.ts";
import { runCore, type CoreOptions, type CoreResult } from "../engine/core.ts";
import { futureValue, monteCarlo } from "../engine/montecarlo.ts";
import { calendarYears } from "../engine/metrics.ts";
import { mdTable, num, pct, usd } from "../format.ts";
import { runSwing, sleeveReturns, type SwingRun, type Universe } from "../pipeline.ts";

/** Tüm backtest'i çalıştırır: panel JSON'u ve markdown raporu döndürür (dosya yazmaz). */
export function buildBacktest(u: Universe): { json: Record<string, unknown>; markdown: string } {
  const end = u.lastFullMonth;

  // ---------------------------------------------------------------- swing
  const strategies: SwingStrategyId[] = ["rsi2", "donchian", "sweep"];
  const swingAssets = ASSET_IDS.filter((id) => id !== "BIST");
  const allRuns: SwingRun[] = [];
  for (const s of strategies) for (const a of swingAssets) allRuns.push(runSwing(u.bars[a], a, s));
  const sleeveRuns = SWING.sleeve.map((c) => allRuns.find((r) => r.strategy === c.strategy && r.asset === c.asset)!);
  const sleeve = sleeveReturns(sleeveRuns, u.core.tbill);

  // ---------------------------------------------------------------- çekirdek varyantları
  const contributions = { monthly: PLAN.monthlyUsd, annual: PLAN.annualExtraUsd, annualMonth: PLAN.annualMonth, inflationIndexed: false };
  type Variant = Omit<CoreOptions, "start" | "end" | "contributions"> & { key: string; note: string };
  // Panelde sunulan üç strateji (bkz. config.ts STRATEGIES). Diğer denenmiş varyantlar
  // (sadece S&P 500, tam trend filtresi, kaldıraçlı) docs/SONUCLAR.md arşivinde.
  const variants: Variant[] = STRATEGY_KEYS.map((key) => {
    const d = STRATEGIES[key];
    return {
      key,
      name: d.name,
      note: d.summary,
      weights: STRATEGIC_WEIGHTS,
      rule: d.rule,
      trendFloor: d.rule === "none" ? undefined : d.trendFloor,
      sleeve: d.sleeve > 0 ? { returns: sleeve, weight: d.sleeve } : undefined,
    };
  });

  const addMonths = (m: string, k: number): string => {
    const [y, mo] = m.split("-").map(Number);
    const t = y * 12 + (mo - 1) + k;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
  };
  /** Son N yıl pencereleri: katkılar pencere başında başlar (o tarihte başlamış olsaydınız). */
  const windowPeriods = [1, 2, 3, 5, 7, 10, 15].map((n) => ({
    key: `y${n}`,
    label: `Son ${n} yıl`,
    start: addMonths(end, -12 * n),
    note: `${addMonths(end, -12 * n)} başında $0 ile başlayıp aynı katkıları yapsaydınız.`,
    window: true,
  }));
  const detailPeriods = [
    { key: "long", label: "Uzun dönem", start: "2006-01", note: "BTC 2015-09, ETH 2018-11 itibarıyla dahil olur; öncesinde ağırlıkları diğer varlıklara dağıtılır." },
    { key: "crypto", label: "Tüm varlıklar mevcut", start: "2018-11", note: "Yedi varlığın hepsi 12 aylık geçmişe sahip." },
  ];
  const periods = [...windowPeriods, ...detailPeriods.map((p) => ({ ...p, window: false }))];

  const results: Record<string, Record<string, CoreResult>> = {};
  for (const p of periods) {
    results[p.key] = {};
    for (const v of variants) results[p.key][v.key] = runCore(u.core, { ...v, start: p.start, end, contributions });
  }

  // ---------------------------------------------------------------- 10 yıllık kayan pencereler
  const rolling: { variant: string; windows: { start: string; realIrr: number; realFinal: number }[] }[] = [];
  for (const v of variants) {
    const windows: { start: string; realIrr: number; realFinal: number }[] = [];
    for (let y = 2006; ; y++) {
      const s = `${y}-01`;
      const [ey, em] = [y + 10, "01"];
      const e = `${ey}-${em}`;
      if (e > end) break;
      const r = runCore(u.core, { ...v, start: s, end: e, contributions });
      windows.push({ start: s, realIrr: r.metrics.realIrr, realFinal: r.metrics.realFinalValue });
    }
    rolling.push({ variant: v.key, windows });
  }

  // ---------------------------------------------------------------- hedef ve Monte Carlo
  const targetWealth = (PLAN.monthlySpendingReal * 12) / PLAN.safeWithdrawalRate;
  const horizons = [10, 15, 20];
  const mcBy = Object.fromEntries(
    STRATEGY_KEYS.map((k) => {
      const r = results.long[k];
      return [k, monteCarlo(r.realTwr.slice(1).map((v, i) => v / r.realTwr[i] - 1), { monthly: PLAN.monthlyUsd, annual: PLAN.annualExtraUsd, horizons, target: targetWealth })];
    }),
  );
  const scenarios = [0.05, 0.07, 0.1, 0.12, 0.15].map((r) => ({
    real: r,
    values: horizons.map((h) => futureValue(r, h, PLAN.monthlyUsd, PLAN.annualExtraUsd)),
  }));

  // ---------------------------------------------------------------- çıktılar
  const json = {
    generatedAt: new Date().toISOString(),
    end,
    plan: { ...PLAN, targetWealth },
    variants: variants.map((v) => ({ key: v.key, name: v.name, note: v.note })),
    strategies: STRATEGIES,
    periods: periods.map((p) => ({
      ...p,
      results: Object.fromEntries(
        Object.entries(results[p.key]).map(([k, r]) => [k, { metrics: r.metrics, months: r.months, value: r.value, contributed: r.contributed, realValue: r.realValue, realTwr: p.key === "long" ? r.realTwr : undefined, twr: r.twr, lastWeights: r.lastWeights, years: calendarYears(r.months.slice(1), r.twr.slice(1).map((v, i) => v / r.twr[i] - 1)) }]),
      ),
    })),
    rolling,
    swing: allRuns.map((r) => ({ strategy: r.strategy, asset: r.asset, stats: r.result.stats, trades: r.result.trades.slice(-40) })),
    sleeve: SWING.sleeve,
    monteCarlo: mcBy,
    scenarios,
  };

  // ---------------------------------------------------------------- markdown rapor
  const L: string[] = [];
  L.push(`# Özgürlük Rotası — Backtest Raporu`, "");
  L.push(`Oluşturma: ${json.generatedAt.slice(0, 10)} · Veri sonu: ${end} · Katkı: ${usd(PLAN.monthlyUsd)}/ay + ${usd(PLAN.annualExtraUsd)} her ${PLAN.annualMonth}. ay (nominal sabit)`, "");
  L.push(`Hedef: reel %${PLAN.targetRealReturn * 100}/yıl. Finansal özgürlük sayısı: ${usd(PLAN.monthlySpendingReal)}/ay reel harcama ÷ %${PLAN.safeWithdrawalRate * 100} = **${usd(targetWealth)}** (bugünün doları).`, "");
  L.push(`## Dönemlere göre reel IRR (aynı katkılar, pencere başında $0)`, "");
  L.push(
    mdTable(
      ["Strateji", ...windowPeriods.map((p) => p.label.replace("Son ", "")), "20+ yıl"],
      variants.map((v) => [v.name, ...windowPeriods.map((p) => pct(results[p.key][v.key].metrics.realIrr)), pct(results.long[v.key].metrics.realIrr)]),
    ),
    "",
    `_Kısa pencereler (1–3 yıl) tek bir piyasa rejimini yansıtır; geleceğe taşınacak getiri için 10+ yıllık pencereler ve Monte Carlo daha güvenilirdir._`,
    "",
  );
  for (const p of detailPeriods) {
    const first = results[p.key].main;
    L.push(`## ${p.label}: ${p.start} → ${end} (${num(first.metrics.years, 1)} yıl)`, "", `_${p.note}_`, "");
    L.push(
      mdTable(
        ["Strateji", "Reel IRR", "Reel CAGR (TWR)", "Nominal CAGR", "Maks DD", "Sharpe", "En kötü yıl", "Ort. maruziyet", "Yatırılan (nominal)", "Yatırılan (bugünün $)", "Son değer", "Kat"],
        variants.map((v) => {
          const m = results[p.key][v.key].metrics;
          return [v.name, pct(m.realIrr), pct(m.realCagr), pct(m.cagr), pct(m.maxDrawdown), num(m.sharpe), pct(m.worstYear), pct(m.avgExposure, 0), usd(m.totalContributed), usd(m.realTotalContributed), usd(m.finalValue), `${num(m.realFinalValue / m.realTotalContributed)}x`];
        }),
      ),
      "",
    );
  }
  L.push(`## 10 yıllık kayan pencereler (her Ocak başlangıçlı, reel IRR)`, "");
  L.push(
    mdTable(
      ["Strateji", "Pencere", "Min", "Medyan", "Maks", "≥ %15 reel oranı"],
      rolling.map((r) => {
        const xs = r.windows.map((w) => w.realIrr).sort((a, b) => a - b);
        const name = variants.find((v) => v.key === r.variant)!.name;
        return [name, xs.length, pct(xs[0]), pct(xs[Math.floor(xs.length / 2)]), pct(xs[xs.length - 1]), pct(xs.filter((x) => x >= 0.15).length / xs.length, 0)];
      }),
    ),
    "",
  );
  L.push(`## Swing stratejileri (günlük, işlem bazlı)`, "");
  L.push(`Sinyal kapanışta, dolum ertesi açılışta; komisyon+kayma ve perp fonlama maliyeti dahil. ✓ = ana plandaki uydu kolunda (önceden kayıtlı).`, "");
  L.push(
    mdTable(
      ["Strateji", "Varlık", "İşlem", "Win rate", "Ort. kazanç R", "Ort. kayıp R", "Beklenti R", "Kâr faktörü", "PF 1. yarı", "PF 2. yarı", "CAGR", "Maks DD", "Piyasada"],
      allRuns.map((r) => {
        const s = r.result.stats;
        const inSleeve = SWING.sleeve.some((c) => c.strategy === r.strategy && c.asset === r.asset);
        return [`${r.strategy}${inSleeve ? " ✓" : ""}`, ASSETS[r.asset].name, s.trades, pct(s.winRate, 0), num(s.avgWinR), num(s.avgLossR), num(s.expectancyR), num(s.profitFactor), num(s.pfFirstHalf), num(s.pfSecondHalf), pct(s.cagr), pct(s.maxDrawdown), pct(s.exposure, 0)];
      }),
    ),
    "",
  );
  L.push(`## Hedefe ulaşma: sabit reel getiri senaryoları (bugünün doları)`, "");
  L.push(mdTable(["Reel getiri", ...horizons.map((h) => `${h} yıl`)], scenarios.map((s) => [pct(s.real, 0), ...s.values.map(usd)])), "");
  L.push(`## Monte Carlo (uzun dönem reel aylık getirilerden 12 aylık blok bootstrap, 5000 yol)`, "");
  L.push(`Katkıların enflasyonla artırıldığı (reel sabit) varsayılır. Hedef: ${usd(targetWealth)}.`, "");
  for (const [label, res] of STRATEGY_KEYS.map((k) => [STRATEGIES[k].name, mcBy[k]] as const)) {
    L.push(`**${label}**`, "");
    L.push(mdTable(["Ufuk", "Kötü (P10)", "Medyan", "İyi (P90)", "Hedefe ulaşma olasılığı"], res.map((r) => [`${r.horizonYears} yıl`, usd(r.p10), usd(r.p50), usd(r.p90), pct(r.probTarget, 0)])), "");
  }
  L.push(`## Güncel çekirdek ağırlıkları (${end} sonu sinyali)`, "");
  L.push(mdTable(["Kalem", ...STRATEGY_KEYS.map((k) => STRATEGIES[k].name)], Object.keys(results.long.main.lastWeights).map((k) => [k === "SLEEVE" ? "Swing uydu" : ASSETS[k as keyof typeof ASSETS]?.name ?? k, ...STRATEGY_KEYS.map((s) => pct(results.long[s].lastWeights[k] ?? 0))])), "");
  L.push(`> Geçmiş performans gelecekteki sonuçları garanti etmez. Bu rapor yatırım tavsiyesi değildir; araştırma ve karar desteği içindir.`);
  return { json, markdown: L.join("\n") };
}
