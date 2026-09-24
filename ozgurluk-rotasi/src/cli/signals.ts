import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ASSET_IDS, ASSETS, CORE, PLAN, STRATEGIC_WEIGHTS, SWING, type AssetId } from "../config.ts";
import { fetchFundingRate, fetchOkxDaily, fetchTickers } from "../data/okx.ts";
import { ROOT, loadEnv } from "../env.ts";
import { trendScore } from "../engine/core.ts";
import { atr, donchian, rsi, sma } from "../engine/indicators.ts";
import { mdTable, num, pct, usd } from "../format.ts";
import { loadUniverse, runSwing } from "../pipeline.ts";
import { buildCalendar } from "../calendar.ts";

loadEnv();
const args = process.argv.slice(2);
const withAnnual = args.includes("--ek") || new Date().getMonth() + 1 === PLAN.annualMonth;
const skipAlts = args.includes("--altsiz");

const u = await loadUniverse();
const months = u.core.months;
const iLast = months.length - 1;
const tb = months.map((m) => u.core.tbill.get(m));
const L: string[] = [];
const today = new Date().toISOString().slice(0, 10);
L.push(`# Aylık Sinyal Raporu — ${today}`, "");
L.push(`Çekirdek sinyal: **${u.lastFullMonth} ay sonu kapanışı** (ay içinde değişmez, whipsaw'u azaltır). Swing sinyalleri: son günlük kapanış.`, "");

// ---------------------------------------------------------------- 1) çekirdek rejim
const coreRows: (string | number)[][] = [];
const target: Record<string, number> = {};
const sumW = ASSET_IDS.reduce((a, id) => a + STRATEGIC_WEIGHTS[id], 0);
for (const id of ASSET_IDS) {
  const closes = months.map((m) => u.core.prices[id].get(m));
  const score = trendScore(closes, iLast, CORE.rule, tb);
  const sma10 = closes.slice(iLast - 9, iLast + 1) as number[];
  const smaV = sma10.reduce((a, b) => a + b, 0) / 10;
  const mom = (closes[iLast] as number) / (closes[iLast - 12] as number) - 1;
  const w = (STRATEGIC_WEIGHTS[id] / sumW) * (1 - CORE.swingSleeve) * (CORE.trendFloor + (1 - CORE.trendFloor) * score);
  target[id] = w;
  const bars = u.bars[id];
  const live = bars[bars.length - 1].close;
  const liveNote = live > smaV ? "üstünde" : "ALTINDA";
  coreRows.push([
    ASSETS[id].name,
    score === 1 ? "🟢 AÇIK" : score === 0.5 ? "🟡 YARIM" : "🔴 KAPALI",
    num(closes[iLast] as number),
    num(smaV),
    pct(mom),
    `${num(live)} (${liveNote})`,
    pct(w),
  ]);
}
target.SWING = CORE.swingSleeve;
target.NAKIT = 1 - Object.values(target).reduce((a, b) => a + b, 0);
L.push(`## 1) Çekirdek rejim ve hedef ağırlıklar`, "");
L.push(mdTable(["Varlık", "Trend", "Ay sonu (USD)", "SMA10a", "12a getiri", "Şu an (canlı)", "Hedef ağırlık"], coreRows), "");
L.push(`- Nakit (T-bill / USDT Earn / TL para piyasası): **${pct(target.NAKIT)}** · Swing kasası (OKX USDT, teminat): **${pct(target.SWING)}**`);
L.push(`- 🟡 YARIM = SMA10 ve 12a momentumdan yalnız biri olumlu. KAPALI varlığın trend yarısı nakde geçer ya da perp short ile hedge edilir (aşağıda).`, "");

// ---------------------------------------------------------------- 2) bu ayın katkısı
const contribution = PLAN.monthlyUsd + (withAnnual ? PLAN.annualExtraUsd : 0);
const pfFile = join(ROOT, "portfoy.json");
let holdings: Record<string, number> | undefined;
if (existsSync(pfFile)) holdings = JSON.parse(readFileSync(pfFile, "utf8")) as Record<string, number>;
const buckets = [...ASSET_IDS, "SWING", "NAKIT"];
const buy: Record<string, number> = {};
if (holdings) {
  // Önce katkıyla dengele: hedefin en çok altında kalan kalemlere yatır (satış/vergi yok)
  const total = buckets.reduce((a, k) => a + (holdings![k] ?? 0), 0) + contribution;
  const deficit: Record<string, number> = {};
  for (const k of buckets) deficit[k] = Math.max(0, target[k] * total - (holdings[k] ?? 0));
  const dsum = Object.values(deficit).reduce((a, b) => a + b, 0);
  for (const k of buckets) buy[k] = dsum > 0 ? (deficit[k] / dsum) * contribution : target[k] * contribution;
} else {
  for (const k of buckets) buy[k] = target[k] * contribution;
}
L.push(`## 2) Bu ayın katkısı: ${usd(contribution)}${withAnnual ? " (yıllık ek dahil)" : ""}`, "");
L.push(holdings ? `_portfoy.json bulundu: katkı, hedefin altında kalan kalemlere yönlendirildi (satış gerektirmeyen dengeleme)._` : `_portfoy.json yok: katkı hedef ağırlıklarla bölündü. Mevcut pozisyonlarınızı portfoy.json'a yazarsanız sapmaya göre dağıtılır._`, "");
L.push(
  mdTable(
    ["Kalem", "Alınacak", "Nerede"],
    buckets.filter((k) => buy[k] >= 1).map((k) => [
      k === "SWING" ? "Swing kasası" : k === "NAKIT" ? "Nakit / fırsat kasası" : ASSETS[k as AssetId].name,
      usd(buy[k]),
      k === "SWING" ? "OKX Trading hesabı USDT (yalnız sinyalde kullanılır)" : k === "NAKIT" ? "USDT Earn / T-bill ETF / TL para piyasası fonu" : ASSETS[k as AssetId].venue,
    ]),
  ),
  "",
);

// ---------------------------------------------------------------- 3) hedge
L.push(`## 3) Hedge (satmak yerine perp short)`, "");
const hedgeRows = ASSET_IDS.filter((id) => target[id] < (STRATEGIC_WEIGHTS[id] / sumW) * (1 - CORE.swingSleeve) - 1e-9).map((id) => {
  const full = (STRATEGIC_WEIGHTS[id] / sumW) * (1 - CORE.swingSleeve);
  return [ASSETS[id].name, pct((full - target[id]) / full, 0), ASSETS[id].venue];
});
L.push(
  hedgeRows.length
    ? mdTable(["Varlık", "Spot pozisyonun hedge oranı", "Araç"], hedgeRows)
    : "Tüm çekirdek varlıklar trendde — hedge gerekmiyor.",
  "",
  "Kural: Spotu satmak istemiyorsanız (vergi, soğuk cüzdan, uzun vade), kapalı trend payı kadar 1x perp short açın. Trend yeniden AÇIK olduğunda (ay sonu) short'u kapatın. Fonlama oranını aşağıdan kontrol edin.",
  "",
);

// ---------------------------------------------------------------- 4) swing
L.push(`## 4) Swing sistemi (günlük)`, "");
const swingRows: (string | number)[][] = [];
for (const c of SWING.sleeve) {
  const bars = u.bars[c.asset];
  const run = runSwing(bars, c.asset, c.strategy);
  const last = run.result.trades[run.result.trades.length - 1];
  const open = last && last.exitReason === "test sonu";
  const i = bars.length - 1;
  const cl = bars.map((b) => b.close);
  let setup = "";
  if (c.strategy === "rsi2") {
    const r2 = rsi(cl, 2)[i];
    const s200 = sma(cl, 200)[i];
    const s5 = sma(cl, 5)[i];
    setup = cl[i] > s200 ? (r2 < 10 ? `🟢 AL sinyali (RSI2 ${num(r2, 1)})` : `Bekle: RSI2 ${num(r2, 1)} (<10 bekleniyor)`) : "Trend altı (SMA200) — pas";
    if (open) setup = `AÇIK LONG (${last.entryDate}) · felaket stopu ${num(last.stop)} · çıkış: kapanış > SMA5 (${num(s5)}) veya 10 gün`;
  } else {
    const d55 = donchian(bars, 55);
    const d20 = donchian(bars, 20);
    const a = atr(bars, 20)[i];
    if (open) {
      setup = last.side === 1
        ? `AÇIK LONG (${last.entryDate}, giriş ${num(last.entry)}) · stop ${num(last.stop)} · çıkış: kapanış < ${num(d20.lower[i])}`
        : `AÇIK SHORT (${last.entryDate}, giriş ${num(last.entry)}) · stop ${num(last.stop)} · çıkış: kapanış > ${num(d20.upper[i])}`;
    } else {
      setup = `Long > ${num(d55.upper[i])} · Short < ${num(d55.lower[i])} (ATR ${num(a)})`;
    }
  }
  const s = run.result.stats;
  swingRows.push([c.strategy, ASSETS[c.asset].name, bars[i].date, num(cl[i]), setup, `${pct(s.winRate, 0)} / PF ${num(s.profitFactor)}`]);
}
L.push(mdTable(["Sistem", "Varlık", "Son bar", "Kapanış", "Durum / seviye", "Tarihsel WR / PF"], swingRows), "");
L.push(`Pozisyon boyu: işlem başına swing kasasının %${SWING.riskPerTrade * 100}–2'si risk; stop mesafesine göre adet = risk$ / |giriş − stop|. Toplam nominal ≤ swing kasası (1x; backtest varsayımı).`, "");

// ---------------------------------------------------------------- 5) OKX fonlama
L.push(`## 5) OKX perp fonlama oranları (anlık)`, "");
const perps = ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "XAU-USDT-SWAP", "US500-USDT-SWAP", "US100-USDT-SWAP", "SPY-USDT-SWAP", "QQQ-USDT-SWAP", "CL-USDT-SWAP"];
const fundRows: (string | number)[][] = [];
for (const p of perps) {
  try {
    const f = await fetchFundingRate(p);
    fundRows.push([p, pct(f.fundingRate, 4), pct(f.fundingRate * 3 * 365, 1)]);
  } catch (err) {
    fundRows.push([p, "—", (err as Error).message.slice(0, 40)]);
  }
}
L.push(mdTable(["Kontrat", "Son oran (8s)", "Yıllık eşdeğer (≈)"], fundRows), "");
L.push(`⚠️ \`SPX-USDT-SWAP\` S&P 500 DEĞİLDİR (SPX6900 memecoin). Endeks için US500 / SPY kontratlarını kullanın. Uzun vadeli çekirdek için perp yerine spot (XAUT/PAXG, BTC, ETH) veya gerçek ETF tercih edin: fonlama yıllık %5–30'a çıkabiliyor.`, "");

// ---------------------------------------------------------------- 6) altcoin radarı
if (!skipAlts) {
  L.push(`## 6) Altcoin radarı (yalnız BTC trendi açıkken kullanılır)`, "");
  const btcCloses = months.map((m) => u.core.prices.BTC.get(m));
  const btcOn = trendScore(btcCloses, iLast, CORE.rule, tb) > 0;
  try {
    const tickers = await fetchTickers("SPOT");
    const stable = /^(USDC|USDT|DAI|FDUSD|TUSD|PYUSD|USDE|XAUT|PAXG|EUR|USD1|RLUSD)-/;
    const top = tickers
      .filter((t) => t.instId.endsWith("-USDT") && !stable.test(t.instId) && !t.instId.startsWith("BTC-"))
      .sort((a, b) => Number(b.volCcy24h) - Number(a.volCcy24h))
      .slice(0, 30);
    const btc = await fetchOkxDaily("BTC-USDT", 200);
    const btcRet = btc[btc.length - 1].close / btc[btc.length - 91].close - 1;
    const rows: { id: string; rs: number; above: boolean; r90: number }[] = [];
    for (const t of top) {
      try {
        const bars = await fetchOkxDaily(t.instId, 200);
        if (bars.length < 120) continue;
        const cl = bars.map((b) => b.close);
        const r90 = cl[cl.length - 1] / cl[cl.length - 91] - 1;
        const s50 = sma(cl, 50);
        rows.push({ id: t.instId, r90, rs: (1 + r90) / (1 + btcRet) - 1, above: cl[cl.length - 1] > s50[s50.length - 1] });
      } catch {
        /* tek coin hatası raporu durdurmasın */
      }
    }
    rows.sort((a, b) => b.rs - a.rs);
    L.push(btcOn ? "BTC trendi açık → aşağıdaki güçlülerden en fazla 3 tanesi, ETH payının içinde, eşit ağırlıkla." : "🔴 BTC trendi kapalı → altcoin alımı YOK (altcoinler ayı piyasasında BTC'den çok daha sert düşer).", "");
    L.push(mdTable(["Parite", "90g getiri", "BTC'ye göre", "SMA50 üstü", "Uygun"], rows.slice(0, 12).map((r) => [r.id, pct(r.r90), pct(r.rs), r.above ? "evet" : "hayır", btcOn && r.above && r.rs > 0 ? "✅" : "—"])), "");
  } catch (err) {
    L.push(`Altcoin radarı alınamadı: ${(err as Error).message}`, "");
  }
}

// ---------------------------------------------------------------- 7) takvim notları
try {
  const cal = await buildCalendar();
  L.push(`## 7) Mevsimsellik ve olay takvimi (son ${cal.lookbackYears} yıl)`, "");
  for (const f of cal.focus) L.push(`**${f.label}:** ${f.lines.join(" · ")}`, "");
  for (const up of cal.upcoming.filter((x) => x.daysLeft <= 120)) L.push(`**Yaklaşan: ${up.title} (${up.date}, ${up.daysLeft} gün)**`, "", ...up.lines.map((l) => `- ${l}`), "");
  L.push(`_Mevsimsellik, trend kuralının önüne geçmez; yalnız zamanlama notudur. Ayrıntı: \`npm run web\` → Aylık Takvim._`, "");
} catch (err) {
  L.push(`Takvim hesaplanamadı: ${(err as Error).message}`, "");
}

L.push(`> Bu rapor sistematik kurallardan üretilir; yatırım tavsiyesi değildir. Emirleri kendiniz kontrol ederek girin.`);
mkdirSync(join(ROOT, "out"), { recursive: true });
writeFileSync(join(ROOT, "out", "SINYAL.md"), L.join("\n"));
writeFileSync(join(ROOT, "out", "signals.json"), JSON.stringify({ date: today, month: u.lastFullMonth, target, buy, contribution }));
console.log(L.join("\n"));
