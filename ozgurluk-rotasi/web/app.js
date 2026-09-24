/* global LightweightCharts */
const LC = LightweightCharts;
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const pct = (x, d = 1) => (Number.isFinite(x) ? (x * 100).toFixed(d) + "%" : "—");
const usd = (x) => (Number.isFinite(x) ? "$" + Math.round(x).toLocaleString("en-US") : "—");
const usdShort = (x) => (!Number.isFinite(x) ? "—" : x >= 1e6 ? "$" + (x / 1e6).toFixed(2) + "M" : x >= 1e3 ? "$" + Math.round(x / 1e3) + "K" : "$" + Math.round(x));
const cls = (x) => (x > 0 ? "pos" : x < 0 ? "neg" : "");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* yok say */ } },
};

// Kimlik rengi stratejiye sabit bağlıdır (filtre değişince yeniden boyanmaz)
const SERIES = { main: "--s1", aggr: "--s2", static: "--s3", spy: "--s6", hybrid: "--s4", blend: "--s7", sma10: "--s5", prereg: "--s8" };
const DEFAULT_ON = ["main", "aggr", "static", "spy"];
const color = (key) => css(SERIES[key] || "--muted");

let BT;
let period = "long";
const visible = new Set(JSON.parse(store.get("panel.visible") || "null") || DEFAULT_ON);

function baseChart(el, opts = {}) {
  return LC.createChart(el, {
    autoSize: true,
    layout: { background: { color: "transparent" }, textColor: css("--muted"), fontSize: 12 },
    grid: { vertLines: { visible: false }, horzLines: { color: css("--line") } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false },
    localization: { priceFormatter: usdShort },
    crosshair: { mode: 0 },
    ...opts,
  });
}

const P = () => BT.periods.find((p) => p.key === period);
const periodShort = (p) => (p.key === "long" ? `20+ yıl` : p.key === "crypto" ? "2018+" : p.label.replace("Son ", ""));

// ------------------------------------------------------------------ dönem seçici
function renderPeriodChips() {
  document.getElementById("periods").innerHTML = BT.periods
    .map((p) => `<button class="chip" data-k="${p.key}" aria-pressed="${p.key === period}" title="${esc(p.start)} → ${BT.end}">${periodShort(p)}</button>`)
    .join("");
  document.querySelectorAll("#periods .chip").forEach((b) => (b.onclick = () => setPeriod(b.dataset.k)));
}

function setPeriod(k) {
  period = k;
  store.set("panel.period", k);
  document.querySelectorAll("#periods .chip").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === k)));
  renderKpis();
  renderMatrix();
  renderEquity();
  renderTable();
  renderProjection();
}

// ------------------------------------------------------------------ KPI
function renderKpis() {
  const p = P();
  const m = p.results.main.metrics;
  document.getElementById("kpiTitle").textContent = `Ana plan — ${p.label}`;
  document.getElementById("kpiLead").textContent = `${p.start} → ${BT.end} · ${p.note}`;
  const items = [
    ["Reel getiri (IRR)", pct(m.realIrr), cls(m.realIrr)],
    ["Reel CAGR (strateji)", pct(m.realCagr), cls(m.realCagr)],
    ["Maks düşüş", pct(m.maxDrawdown), "neg"],
    ["Toplam yatırılan", usd(m.totalContributed), ""],
    ["Son değer", usd(m.finalValue), ""],
    ["Kâr", usd(m.finalValue - m.totalContributed), cls(m.finalValue - m.totalContributed)],
  ];
  document.getElementById("kpis").innerHTML = items.map(([k, v, c]) => `<div class="kpi"><span>${k}</span><b class="${c}">${v}</b></div>`).join("");
  document.getElementById("shortWarn").innerHTML = m.years < 5
    ? `<div class="warn">${m.years.toFixed(0)} yıllık pencere tek bir piyasa rejimini yansıtır; getiriyi yıllıklandırmak yanıltıcı olabilir. Karar için 10+ yıl ve Monte Carlo'ya bakın.</div>` : "";
}

// ------------------------------------------------------------------ dönem matrisi
function renderMatrix() {
  const head = `<tr><th>Strateji</th>${BT.periods.map((p) => `<th class="${p.key === period ? "sel" : ""}" data-k="${p.key}" style="cursor:pointer">${periodShort(p)}</th>`).join("")}</tr>`;
  const rows = BT.variants.map((v) => `<tr class="${v.key === "main" ? "main" : ""}"><td><span class="sw" style="background:${color(v.key)}"></span>${esc(v.name)}</td>${BT.periods.map((p) => {
    const x = p.results[v.key].metrics.realIrr;
    const best = Math.max(...BT.variants.map((w) => p.results[w.key].metrics.realIrr));
    return `<td class="${cls(x)} ${p.key === period ? "sel" : ""}" style="${x === best ? "font-weight:700" : ""}">${pct(x)}</td>`;
  }).join("")}</tr>`).join("");
  document.getElementById("matrix").innerHTML = `<table>${head}${rows}</table><div class="note">Kalın = o dönemin en iyisi. Kısa dönemin kazananı genelde uzun dönemin kazananı değildir; tutarlılık için satır boyunca bakın.</div>`;
  document.querySelectorAll("#matrix th[data-k]").forEach((th) => (th.onclick = () => setPeriod(th.dataset.k)));
}

// ------------------------------------------------------------------ özsermaye
let equityChart;
function renderEquity() {
  const p = P();
  if (equityChart) equityChart.remove();
  equityChart = baseChart(document.getElementById("equity"));
  const long = p.results.main.months.length > 60;
  if (long) equityChart.priceScale("right").applyOptions({ mode: LC.PriceScaleMode.Logarithmic });
  document.getElementById("eqLead").textContent = `${p.start} → ${BT.end}${long ? " · logaritmik ölçek" : ""} · strateji adına tıklayarak gizleyin/gösterin`;
  const main = p.results.main;
  const c = equityChart.addSeries(LC.LineSeries, { color: css("--muted"), lineStyle: 2, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "Yatırılan" });
  c.setData(main.months.map((m, i) => ({ time: m + "-01", value: Math.max(main.contributed[i], 1) })));
  for (const v of BT.variants) {
    if (!visible.has(v.key)) continue;
    const r = p.results[v.key];
    const s = equityChart.addSeries(LC.LineSeries, { color: color(v.key), lineWidth: 2, priceLineVisible: false, lastValueVisible: v.key === "main" });
    s.setData(r.months.map((m, i) => ({ time: m + "-01", value: Math.max(r.value[i], 1) })));
  }
  equityChart.timeScale().fitContent();
  document.getElementById("legend").innerHTML =
    BT.variants.map((v) => `<button data-k="${v.key}" aria-pressed="${visible.has(v.key)}"><span class="sw" style="background:${color(v.key)}"></span>${esc(v.name)}</button>`).join("") +
    `<span style="color:var(--muted)"><span class="sw" style="background:var(--muted)"></span>Yatırılan</span>`;
  document.querySelectorAll("#legend button").forEach((b) => (b.onclick = () => {
    const k = b.dataset.k;
    visible.has(k) ? visible.delete(k) : visible.add(k);
    store.set("panel.visible", JSON.stringify([...visible]));
    renderEquity();
    renderProjection();
  }));
}

// ------------------------------------------------------------------ tablo
function renderTable() {
  const p = P();
  document.getElementById("tblLead").textContent = `${p.label}: ${p.start} → ${BT.end}`;
  const head = ["Strateji", "Reel IRR", "Reel CAGR", "Nominal CAGR", "Maks DD", "Sharpe", "En kötü yıl", "Yatırılan", "Son değer", "Kat"];
  const rows = BT.variants.map((v) => {
    const m = p.results[v.key].metrics;
    return `<tr class="${v.key === "main" ? "main" : ""}"><td><span class="sw" style="background:${color(v.key)}"></span>${esc(v.name)}</td>
      <td class="${cls(m.realIrr)}">${pct(m.realIrr)}</td><td class="${cls(m.realCagr)}">${pct(m.realCagr)}</td><td>${pct(m.cagr)}</td>
      <td class="neg">${pct(m.maxDrawdown)}</td><td>${m.sharpe.toFixed(2)}</td><td class="${cls(m.worstYear)}">${m.years >= 1 ? pct(m.worstYear) : "—"}</td>
      <td>${usd(m.totalContributed)}</td><td>${usd(m.finalValue)}</td><td>${(m.finalValue / m.totalContributed).toFixed(2)}x</td></tr>`;
  }).join("");
  document.getElementById("table").innerHTML = `<table><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>${rows}</table>`;
}

// ------------------------------------------------------------------ projeksiyon
const HORIZONS = [1, 3, 5, 10, 15, 20];
let projChart;
let mcCache = { key: "", bands: null };

function pjInputs() {
  const num = (id) => Math.max(0, Number(document.getElementById(id).value) || 0);
  return {
    start: num("pjStart"),
    monthly: num("pjMonthly"),
    annual: num("pjAnnual"),
    spend: num("pjSpend"),
    inf: num("pjInf") / 100,
    indexed: document.getElementById("pjIndex").checked,
    mode: document.querySelector("#pjMode button[aria-pressed=true]").dataset.v,
    source: document.getElementById("pjSource").value,
  };
}

/** Aylık reel getiri dizisiyle birikim yolu (bugünün doları). Yıl sonlarındaki değerleri döndürür. */
function simulatePath(realMonthly, inp, months, nextMonth) {
  let v = inp.start;
  const out = [];
  for (let m = 0; m < months; m++) {
    const calMonth = ((nextMonth - 1 + m) % 12) + 1;
    const infl = (1 + inp.inf) ** (m / 12);
    const k = inp.indexed ? 1 : 1 / infl; // nominal sabit katkının reel değeri erir
    v += inp.monthly * k + (calMonth === 1 ? inp.annual * k : 0);
    v *= 1 + realMonthly(m);
    out.push(v);
  }
  return out;
}

function monteCarlo(inp, months, nextMonth) {
  const key = JSON.stringify([inp.start, inp.monthly, inp.annual, inp.inf, inp.indexed, months]);
  if (mcCache.key === key) return mcCache.bands;
  const twr = BT.periods.find((p) => p.key === "long").results.main.realTwr;
  const rets = twr.slice(1).map((v, i) => v / twr[i] - 1);
  let seed = 42;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const paths = 3000, block = 12;
  const at = Array.from({ length: months }, () => new Float64Array(paths));
  for (let p = 0; p < paths; p++) {
    let s = 0;
    const path = simulatePath((m) => {
      if (m % block === 0) s = Math.floor(rand() * (rets.length - block));
      return rets[s + (m % block)];
    }, inp, months, nextMonth);
    path.forEach((v, m) => (at[m][p] = v));
  }
  const q = (arr, f) => { const a = Array.from(arr).sort((x, y) => x - y); return a[Math.floor(f * (a.length - 1))]; };
  const bands = at.map((arr) => ({ p10: q(arr, 0.1), p50: q(arr, 0.5), p90: q(arr, 0.9) }));
  mcCache = { key, bands };
  return bands;
}

function renderProjection() {
  const inp = pjInputs();
  const src = BT.periods.find((p) => p.key === (inp.source === "sel" ? period : inp.source));
  const months = 20 * 12;
  const endYM = BT.end.split("-").map(Number);
  const nextMonth = (endYM[1] % 12) + 1;
  const startYear = endYM[1] === 12 ? endYM[0] + 1 : endYM[0];
  const dateAt = (m) => { const t = endYM[0] * 12 + endYM[1] + m; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`; };
  const show = (v, m) => (inp.mode === "nominal" ? v * (1 + inp.inf) ** ((m + 1) / 12) : v);
  const target = (inp.spend * 12) / 0.04;

  document.getElementById("pjWarn").innerHTML = src.results.main.metrics.years < 5
    ? `<div class="warn">Getiri varsayımı ${src.label.toLowerCase()} penceresinden alınıyor. Kısa dönem getirisini 20 yıla taşımak çok iyimser ya da çok kötümser olabilir.</div>` : "";

  const keys = BT.variants.map((v) => v.key).filter((k) => visible.has(k));
  const paths = {};
  for (const k of keys) {
    const r = src.results[k].metrics.realCagr;
    const rm = (1 + r) ** (1 / 12) - 1;
    paths[k] = simulatePath(() => rm, inp, months, nextMonth);
  }
  const bands = monteCarlo(inp, months, nextMonth);

  if (projChart) projChart.remove();
  projChart = baseChart(document.getElementById("projection"));
  const line = (data, o) => { const s = projChart.addSeries(LC.LineSeries, { priceLineVisible: false, lastValueVisible: false, lineWidth: 2, ...o }); s.setData(data); return s; };
  const blue = color("main");
  line(bands.map((b, m) => ({ time: dateAt(m), value: show(b.p90, m) })), { color: blue, lineWidth: 1, lineStyle: 2 });
  line(bands.map((b, m) => ({ time: dateAt(m), value: show(b.p10, m) })), { color: blue, lineWidth: 1, lineStyle: 2 });
  const invested = [];
  let inv = inp.start;
  for (let m = 0; m < months; m++) {
    const calMonth = ((nextMonth - 1 + m) % 12) + 1;
    const infl = (1 + inp.inf) ** ((m + 1) / 12);
    const nominalC = (inp.monthly + (calMonth === 1 ? inp.annual : 0)) * (inp.indexed ? infl : 1);
    inv += inp.mode === "nominal" ? nominalC : nominalC / infl;
    invested.push(inv);
  }
  line(invested.map((v, m) => ({ time: dateAt(m), value: v })), { color: css("--muted"), lineWidth: 1, lineStyle: 2 });
  line(Array.from({ length: months }, (_, m) => ({ time: dateAt(m), value: show(target, m) })), { color: css("--warn"), lineWidth: 1, lineStyle: 1 });
  for (const k of keys) line(paths[k].map((v, m) => ({ time: dateAt(m), value: show(v, m) })), { color: color(k), lastValueVisible: k === "main" });
  projChart.timeScale().fitContent();

  document.getElementById("pjLegend").innerHTML =
    keys.map((k) => `<span><span class="sw" style="background:${color(k)}"></span>${esc(BT.variants.find((v) => v.key === k).name)} (${pct(src.results[k].metrics.realCagr)}/yıl)</span>`).join("") +
    `<span><span class="sw" style="background:transparent;border:1px dashed ${blue}"></span>Ana plan Monte Carlo %10–%90</span>` +
    `<span><span class="sw" style="background:var(--muted)"></span>Yatırılan</span><span><span class="sw" style="background:var(--warn)"></span>Hedef ${usdShort(target)}</span>`;

  const head = `<tr><th>Ufuk</th><th>Yıl</th><th>Toplam yatırım</th>${keys.map((k) => `<th><span class="sw" style="background:${color(k)}"></span>${esc(shortName(k))}</th>`).join("")}<th>Ana plan MC (kötü / medyan / iyi)</th></tr>`;
  const rows = HORIZONS.map((h) => {
    const m = h * 12 - 1;
    const t = show(target, m);
    return `<tr><td>${h} yıl sonra</td><td>${Number(dateAt(m).slice(0, 4))}</td><td>${usd(invested[m])}</td>${keys.map((k) => {
      const v = show(paths[k][m], m);
      return `<td class="${v >= t ? "hit" : ""}">${usd(v)}${v >= t ? " ✓" : ""}</td>`;
    }).join("")}<td>${usdShort(show(bands[m].p10, m))} / ${usdShort(show(bands[m].p50, m))} / ${usdShort(show(bands[m].p90, m))}</td></tr>`;
  }).join("");
  const reach = `<tr><td colspan="3"><b>Hedefe ulaşma (${usdShort(target)} bugünün doları)</b></td>${keys.map((k) => {
    const i = paths[k].findIndex((v) => v >= target);
    return `<td>${i < 0 ? "20 yılda yok" : `<b>${dateAt(i).slice(0, 7)}</b> (${((i + 1) / 12).toFixed(1)} yıl)`}</td>`;
  }).join("")}<td>${(() => { const i = bands.findIndex((b) => b.p50 >= target); return i < 0 ? "medyanda 20 yılda yok" : `medyan ${dateAt(i).slice(0, 7)}`; })()}</td></tr>`;
  document.getElementById("pjTable").innerHTML = `<table>${head}${rows}${reach}</table>`;
  document.getElementById("pjNote").textContent =
    `Getiri kaynağı: ${src.label} (${src.start} → ${BT.end}), her stratejinin reel CAGR'ı. Başlangıç: ${startYear}. ` +
    `${inp.mode === "nominal" ? `Nominal gösterimde %${(inp.inf * 100).toFixed(1)} enflasyon varsayılır. ` : "Tutarlar bugünün alım gücüyle. "}` +
    `Hedef = aylık harcama × 12 ÷ %4 güvenli çekim oranı. Geçmiş getiri geleceği garanti etmez.`;
}

function shortName(k) {
  return { main: "Ana plan", aggr: "Agresif", static: "Al-tut çoklu", spy: "S&P 500", hybrid: "Hibrit", blend: "Trend (blend)", sma10: "Trend (SMA10)", prereg: "İlk plan" }[k] || k;
}

function initProjectionControls() {
  const sel = document.getElementById("pjSource");
  sel.innerHTML = `<option value="sel">Seçili backtest dönemi</option>` + BT.periods.map((p) => `<option value="${p.key}">${p.label} (${p.start}→)</option>`).join("");
  sel.value = store.get("panel.pjSource") || "long";
  sel.onchange = () => { store.set("panel.pjSource", sel.value); renderProjection(); };
  for (const id of ["pjStart", "pjMonthly", "pjAnnual", "pjSpend", "pjInf"]) {
    const el = document.getElementById(id);
    const saved = store.get("panel." + id);
    if (saved !== null) el.value = saved;
    el.oninput = () => { store.set("panel." + id, el.value); renderProjection(); };
  }
  document.getElementById("pjIndex").onchange = renderProjection;
  document.querySelectorAll("#pjMode button").forEach((b) => (b.onclick = () => {
    document.querySelectorAll("#pjMode button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderProjection();
  }));
}

let candleChart;
async function renderCandles() {
  const asset = document.getElementById("asset").value;
  const strategy = document.getElementById("strategy").value;
  const res = await fetch(`/api/bars?asset=${asset}&strategy=${strategy}`);
  const d = await res.json();
  if (candleChart) candleChart.remove();
  candleChart = baseChart(document.getElementById("candles"));
  const bars = d.bars.slice(-1500);
  const off = d.bars.length - bars.length;
  const cs = candleChart.addSeries(LC.CandlestickSeries, { upColor: css("--up"), downColor: css("--down"), borderVisible: false, wickUpColor: css("--up"), wickDownColor: css("--down") });
  cs.setData(bars.map((b) => ({ time: b.date, open: b.open, high: b.high, low: b.low, close: b.close })));
  const line = (arr, color, style = 0) => {
    const s = candleChart.addSeries(LC.LineSeries, { color, lineWidth: 1, lineStyle: style, priceLineVisible: false, lastValueVisible: false });
    s.setData(bars.map((b, i) => ({ time: b.date, value: arr[i + off] })).filter((p) => Number.isFinite(p.value)));
  };
  line(d.sma200, css("--accent"));
  line(d.upper55, css("--muted"), 2);
  line(d.lower55, css("--muted"), 2);
  const start = bars[0].date;
  const markers = [];
  for (const t of d.trades.filter((t) => t.entryDate >= start)) {
    markers.push({ time: t.entryDate, position: t.side === 1 ? "belowBar" : "aboveBar", color: t.side === 1 ? css("--up") : css("--down"), shape: t.side === 1 ? "arrowUp" : "arrowDown", text: t.side === 1 ? "L" : "S" });
    markers.push({ time: t.exitDate, position: "inBar", color: t.pnl > 0 ? css("--up") : css("--down"), shape: "circle", text: t.r.toFixed(1) + "R" });
  }
  markers.sort((a, b) => a.time.localeCompare(b.time));
  LC.createSeriesMarkers(cs, markers);
  candleChart.timeScale().fitContent();
  const s = d.stats;
  document.getElementById("stats").innerHTML = [
    `İşlem ${s.trades}`, `Win rate ${pct(s.winRate, 0)}`, `Beklenti ${s.expectancyR.toFixed(2)}R`, `Kâr faktörü ${s.profitFactor.toFixed(2)}`, `CAGR ${pct(s.cagr)}`, `Maks DD ${pct(s.maxDrawdown)}`,
    `<span><i style="background:${css("--accent")}"></i>SMA200</span>`, `<span><i style="background:${css("--muted")}"></i>Donchian 55</span>`,
  ].map((x) => `<span>${x}</span>`).join("");
}

function md(text) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`(.+?)`/g, "<code>$1</code>").replace(/_(.+?)_/g, "<i>$1</i>");
  const out = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      i--;
      const cells = (r) => r.split("|").slice(1, -1).map((c) => c.trim());
      out.push(`<div class="scroll"><table><tr>${cells(rows[0]).map((c) => `<th>${inline(c)}</th>`).join("")}</tr>${rows.slice(2).map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</table></div>`);
    } else if (l.startsWith("## ")) out.push(`<h2>${inline(l.slice(3))}</h2>`);
    else if (l.startsWith("# ")) out.push(`<h1>${inline(l.slice(2))}</h1>`);
    else if (l.startsWith("> ")) out.push(`<blockquote>${inline(l.slice(2))}</blockquote>`);
    else if (l.startsWith("- ")) out.push(`<div>• ${inline(l.slice(2))}</div>`);
    else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  return out.join("");
}

(async () => {
  try {
    const res = await fetch("/out/backtest.json");
    if (!res.ok) throw new Error("out/backtest.json yok — `npm run backtest` çalıştırın");
    BT = await res.json();
    document.getElementById("meta").textContent = `Veri sonu ${BT.end} · reel (ABD enflasyonundan arındırılmış) USD · $${BT.plan.monthlyUsd.toLocaleString("en-US")}/ay + $${BT.plan.annualExtraUsd.toLocaleString("en-US")}/yıl`;
    const saved = store.get("panel.period");
    period = BT.periods.some((p) => p.key === saved) ? saved : "long";
    renderPeriodChips();
    initProjectionControls();
    setPeriod(period);
  } catch (e) {
    document.getElementById("kpis").textContent = e.message;
  }
  const assets = { SPY: "S&P 500", QQQ: "Nasdaq 100", GLD: "Altın", BIST: "BIST 100 (USD)", BTC: "Bitcoin", ETH: "Ethereum", DBC: "Emtia" };
  const a = document.getElementById("asset");
  a.innerHTML = Object.entries(assets).map(([k, v]) => `<option value="${k}" ${k === "BTC" ? "selected" : ""}>${v}</option>`).join("");
  a.onchange = renderCandles;
  document.getElementById("strategy").onchange = renderCandles;
  renderCandles().catch((e) => (document.getElementById("stats").textContent = e.message));
  const s = await fetch("/out/SINYAL.md");
  document.getElementById("signals").innerHTML = s.ok ? md(await s.text()) : "Sinyal raporu yok — `npm run sinyal` çalıştırın.";
})();
