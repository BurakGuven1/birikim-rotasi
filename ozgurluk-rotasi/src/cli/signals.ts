import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ASSETS, CORE, PLAN, STRATEGIES, STRATEGY_KEYS, SWING, type AssetId } from "../config.ts";
import { BUCKET_NAMES, BUCKET_VENUES, currentAllocation, splitContribution, type Bucket } from "../allocation.ts";
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
mkdirSync(join(ROOT, "out"), { recursive: true });
const alloc = currentAllocation(u);
writeFileSync(join(ROOT, "out", "allocation.json"), JSON.stringify(alloc));
const trendLabel = (s: number) => (s === 1 ? "🟢 AÇIK" : s === 0.5 ? "🟡 YARIM" : "🔴 KAPALI");
L.push(`## 1) Trend durumu (${alloc.signalMonth} ay sonu)`, "");
L.push(
  mdTable(
    ["Varlık", "Trend", "Ay sonu (USD)", "SMA10a", "12a getiri", "Şu an (canlı)"],
    alloc.assets.map((a) => [a.name, trendLabel(a.score), num(a.monthClose), num(a.sma10), pct(a.mom12), `${num(a.liveClose)} (${a.liveClose > a.sma10 ? "üstünde" : "ALTINDA"})`]),
  ),
  "",
  `🟡 YARIM = SMA10 ve 12a momentumdan yalnız biri olumlu. Sinyal bir sonraki ay kapanışında güncellenir (${alloc.nextUpdate}).`,
  "",
);

// ---------------------------------------------------------------- 2) bu ayın katkısı — üç strateji
const contribution = PLAN.monthlyUsd + (withAnnual ? PLAN.annualExtraUsd : 0);
const pfFile = join(ROOT, "portfoy.json");
const holdings = existsSync(pfFile) ? (JSON.parse(readFileSync(pfFile, "utf8")) as Record<string, number>) : undefined;
L.push(`## 2) Bu ayın katkısı: ${usd(contribution)}${withAnnual ? " (yıllık ek dahil)" : ""}`, "");
L.push(holdings ? `_portfoy.json bulundu: katkı, hedefin altında kalan kalemlere yönlendirildi (satış gerektirmeyen dengeleme)._` : `_portfoy.json yok: katkı hedef ağırlıklarla bölündü._`, "");
const splits = Object.fromEntries(STRATEGY_KEYS.map((k) => [k, splitContribution(alloc.strategies[k].weights, contribution, holdings)]));
const buckets = Object.keys(alloc.strategies.main.weights) as Bucket[];
L.push(
  mdTable(
    ["Kalem", ...STRATEGY_KEYS.map((k) => STRATEGIES[k].name), "Nerede"],
    buckets
      .filter((b) => STRATEGY_KEYS.some((k) => splits[k][b] > 0))
      .map((b) => [BUCKET_NAMES[b], ...STRATEGY_KEYS.map((k) => (splits[k][b] > 0 ? `${usd(splits[k][b])} (${pct(alloc.strategies[k].weights[b], 0)})` : "—")), BUCKET_VENUES[b]]),
  ),
  "",
);

// ---------------------------------------------------------------- 3) hedge
L.push(`## 3) Hedge (satmak yerine perp short) — Hibrit ve Ana plan`, "");
const hedge = alloc.strategies.main.hedge;
const hedgeRows = (Object.keys(hedge) as AssetId[]).map((id) => [ASSETS[id].name, pct(hedge[id] ?? 0, 0), ASSETS[id].venue]);
L.push(
  hedgeRows.length ? mdTable(["Varlık", "Spot pozisyonun hedge oranı", "Araç"], hedgeRows) : "Tüm çekirdek varlıklar trendde — hedge gerekmiyor.",
  "",
  "Kural: Spotu satmak istemiyorsanız (vergi, soğuk cüzdan, uzun vade), kapalı trend payı kadar 1x perp short açın. Trend yeniden AÇIK olduğunda (ay sonu) short'u kapatın. Al-tut çoklu stratejisinde hedge yapılmaz.",
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
writeFileSync(join(ROOT, "out", "signals.json"), JSON.stringify({ date: today, month: u.lastFullMonth, contribution, splits }));
console.log(L.join("\n"));
