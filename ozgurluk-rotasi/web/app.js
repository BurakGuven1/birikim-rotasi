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
const SERIES = { main: "--s1", static: "--s3", hybrid: "--s4" };
const DEFAULT_ON = ["static", "hybrid", "main"];
const color = (key) => css(SERIES[key] || "--muted");

let BT;
let period = "long";
const savedVisible = (JSON.parse(store.get("panel.visible") || "null") || []).filter((k) => k in SERIES);
const visible = new Set(savedVisible.length ? savedVisible : DEFAULT_ON);

function baseChart(el, opts = {}) {
  return LC.createChart(el, {
    autoSize: true,
    layout: { background: { color: "transparent" }, textColor: css("--muted"), fontSize: 12 },
    grid: { vertLines: { visible: false }, horzLines: { color: css("--line") } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false },
    localization: { priceFormatter: usdShort },
    crosshair: { mode: 0 },
    // Sayfayı kaydırırken grafiğin yakınlaşıp tarih aralığını değiştirmesini engelle
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    ...opts,
  });
}

function fitOnDblClick(el, chart) {
  el.ondblclick = () => chart.timeScale().fitContent();
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
  fitOnDblClick(document.getElementById("equity"), equityChart);
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
    growth: (Number(document.getElementById("pjGrowth").value) || 0) / 100,
    growthMode: document.getElementById("pjGrowthMode").value,
    mode: document.querySelector("#pjMode button[aria-pressed=true]").dataset.v,
    source: document.getElementById("pjSource").value,
    measure: document.querySelector("#pjMeasure button[aria-pressed=true]").dataset.v,
  };
}

/**
 * Katkı çarpanı (nominal): her 12 ayda bir artar.
 *  nominal: (1+g)^yıl  ·  real: ((1+enflasyon)(1+g))^yıl  ·  flat: 1
 */
function contribFactor(inp, m) {
  const y = Math.floor(m / 12);
  if (inp.growthMode === "flat") return 1;
  if (inp.growthMode === "real") return ((1 + inp.inf) * (1 + inp.growth)) ** y;
  return (1 + inp.growth) ** y;
}

/** m. aydaki katkı: nominal tutar ve bugünün dolarıyla değeri */
function contribution(inp, m, nextMonth) {
  const calMonth = ((nextMonth - 1 + m) % 12) + 1;
  const nominal = (inp.monthly + (calMonth === 1 ? inp.annual : 0)) * contribFactor(inp, m);
  return { nominal, real: nominal / (1 + inp.inf) ** (m / 12) };
}

/** Aylık reel getiri dizisiyle birikim yolu (bugünün doları), her ay sonu değeri. */
function simulatePath(realMonthly, inp, months, nextMonth) {
  let v = inp.start;
  const out = [];
  for (let m = 0; m < months; m++) {
    v += contribution(inp, m, nextMonth).real;
    v *= 1 + realMonthly(m);
    out.push(v);
  }
  return out;
}

function monteCarlo(inp, months, nextMonth) {
  const key = JSON.stringify([inp.start, inp.monthly, inp.annual, inp.inf, inp.growth, inp.growthMode, months]);
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
  const months = 30 * 12; // hedef tarihi 30 yıla kadar aranır
  const shown = 20 * 12; // grafik 20 yıl
  const endYM = BT.end.split("-").map(Number);
  const nextMonth = (endYM[1] % 12) + 1;
  const startYear = endYM[1] === 12 ? endYM[0] + 1 : endYM[0];
  const dateAt = (m) => { const t = endYM[0] * 12 + endYM[1] + m; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`; };
  const show = (v, m) => (inp.mode === "nominal" ? v * (1 + inp.inf) ** ((m + 1) / 12) : v);
  const target = (inp.spend * 12) / 0.04;

  const rateOf = (k) => (inp.measure === "irr" ? src.results[k].metrics.realIrr : src.results[k].metrics.realCagr);
  const measureLbl = inp.measure === "irr" ? "backtest deneyimi (IRR)" : "strateji getirisi (CAGR)";
  const warns = [];
  if (inp.source !== "sel" && src.key !== period)
    warns.push(`Getiri varsayımı <b>${src.label}</b> döneminden alınıyor; yukarıda seçili dönem <b>${P().label}</b>. İkisini karşılaştırırken aynı dönemi seçin (Getiri varsayımı → "Seçili backtest dönemi").`);
  if (src.results.main.metrics.years < 5)
    warns.push(`${src.label} kısa bir pencere; bu getiriyi 20 yıla taşımak çok iyimser ya da çok kötümser olabilir.`);
  document.getElementById("pjWarn").innerHTML = warns.map((w) => `<div class="warn">${w}</div>`).join("");

  const keys = BT.variants.map((v) => v.key).filter((k) => visible.has(k));
  const paths = {};
  for (const k of keys) {
    const r = rateOf(k);
    const rm = (1 + r) ** (1 / 12) - 1;
    paths[k] = simulatePath(() => rm, inp, months, nextMonth);
  }
  const bands = monteCarlo(inp, months, nextMonth);

  if (projChart) projChart.remove();
  projChart = baseChart(document.getElementById("projection"));
  const line = (data, o) => { const s = projChart.addSeries(LC.LineSeries, { priceLineVisible: false, lastValueVisible: false, lineWidth: 2, ...o }); s.setData(data); return s; };
  const blue = color("main");
  const cut = (arr) => arr.slice(0, shown);
  line(cut(bands).map((b, m) => ({ time: dateAt(m), value: show(b.p90, m) })), { color: blue, lineWidth: 1, lineStyle: 2 });
  line(cut(bands).map((b, m) => ({ time: dateAt(m), value: show(b.p10, m) })), { color: blue, lineWidth: 1, lineStyle: 2 });
  const invested = [];
  let inv = inp.start;
  for (let m = 0; m < months; m++) {
    const c = contribution(inp, m, nextMonth);
    inv += inp.mode === "nominal" ? c.nominal : c.real;
    invested.push(inv);
  }
  // Katkı artışının etkisi: aynı getiriyle, artışsız (sabit $) senaryo
  const mainRm = (1 + rateOf("main")) ** (1 / 12) - 1;
  const flatMain = simulatePath(() => mainRm, { ...inp, growthMode: "flat" }, months, nextMonth);
  line(cut(invested).map((v, m) => ({ time: dateAt(m), value: v })), { color: css("--muted"), lineWidth: 1, lineStyle: 2 });
  line(Array.from({ length: shown }, (_, m) => ({ time: dateAt(m), value: show(target, m) })), { color: css("--warn"), lineWidth: 1, lineStyle: 1 });
  for (const k of keys) line(cut(paths[k]).map((v, m) => ({ time: dateAt(m), value: show(v, m) })), { color: color(k), lastValueVisible: k === "main" });
  projChart.timeScale().fitContent();
  fitOnDblClick(document.getElementById("projection"), projChart);

  document.getElementById("pjLegend").innerHTML =
    keys.map((k) => `<span><span class="sw" style="background:${color(k)}"></span>${esc(BT.variants.find((v) => v.key === k).name)} (${pct(rateOf(k))}/yıl)</span>`).join("") +
    `<span><span class="sw" style="background:transparent;border:1px dashed ${blue}"></span>Ana plan Monte Carlo %10–%90 (her zaman 20+ yıl verisi)</span>` +
    `<span><span class="sw" style="background:var(--muted)"></span>Yatırılan</span><span><span class="sw" style="background:var(--warn)"></span>Hedef ${usdShort(target)}</span>`;

  const head = `<tr><th>Ufuk</th><th>Yıl</th><th>O yıl aylık katkı</th><th>Toplam yatırım</th>${keys.map((k) => `<th><span class="sw" style="background:${color(k)}"></span>${esc(shortName(k))}</th>`).join("")}<th>Ana plan MC (kötü / medyan / iyi)</th></tr>`;
  const rows = HORIZONS.map((h) => {
    const m = h * 12 - 1;
    const t = show(target, m);
    const monthlyThen = inp.monthly * contribFactor(inp, m);
    return `<tr><td>${h} yıl sonra</td><td>${Number(dateAt(m).slice(0, 4))}</td><td>${usd(monthlyThen)}<small style="color:var(--muted)">${inp.mode === "real" && inp.growthMode !== "flat" ? ` (${usdShort(monthlyThen / (1 + inp.inf) ** (m / 12))} bugün)` : ""}</small></td><td>${usd(invested[m])}</td>${keys.map((k) => {
      const v = show(paths[k][m], m);
      return `<td class="${v >= t ? "hit" : ""}">${usd(v)}${v >= t ? " ✓" : ""}</td>`;
    }).join("")}<td>${usdShort(show(bands[m].p10, m))} / ${usdShort(show(bands[m].p50, m))} / ${usdShort(show(bands[m].p90, m))}</td></tr>`;
  }).join("");
  const reach = `<tr><td colspan="4"><b>Hedefe ulaşma (${usdShort(target)} bugünün doları)</b></td>${keys.map((k) => {
    const i = paths[k].findIndex((v) => v >= target);
    return `<td>${i < 0 ? "30 yılda yok" : `<b>${dateAt(i).slice(0, 7)}</b> (${((i + 1) / 12).toFixed(1)} yıl)`}</td>`;
  }).join("")}<td>${(() => { const i = bands.findIndex((b) => b.p50 >= target); return i < 0 ? "medyanda 30 yılda yok" : `medyan ${dateAt(i).slice(0, 7)}`; })()}</td></tr>`;
  document.getElementById("pjTable").innerHTML = `<table>${head}${rows}${reach}</table>`;
  document.getElementById("pjImpact").innerHTML = growthImpact(paths.main || null, flatMain, target, dateAt, inp);
  document.getElementById("pjNote").textContent =
    `Getiri kaynağı: ${src.label} (${src.start} → ${BT.end}), her stratejinin ${measureLbl}. Başlangıç: ${startYear}. ` +
    `${inp.mode === "nominal" ? `Nominal gösterimde %${(inp.inf * 100).toFixed(1)} enflasyon varsayılır. ` : "Tutarlar bugünün alım gücüyle. "}` +
    `Katkılar her 12 ayda bir artar (${inp.growthMode === "flat" ? "artış yok" : inp.growthMode === "real" ? `enflasyon %${(inp.inf * 100).toFixed(1)} + %${(inp.growth * 100).toFixed(1)}` : `nominal %${(inp.growth * 100).toFixed(1)}`}); enflasyonun altındaki nominal artış, katkının bugünkü değerini eritir. ` +
    `Hedef = aylık harcama × 12 ÷ %4 güvenli çekim oranı. Geçmiş getiri geleceği garanti etmez.`;
}

function growthImpact(withGrowth, flat, target, dateAt, inp) {
  if (inp.growthMode === "flat" || !(inp.growth > 0 || inp.growthMode === "real")) return "";
  const mainPath = withGrowth || null;
  const iFlat = flat.findIndex((v) => v >= target);
  const iGrow = mainPath ? mainPath.findIndex((v) => v >= target) : -1;
  const at = (i) => (i < 0 ? "30 yılda yok" : `${dateAt(i).slice(0, 7)} (${((i + 1) / 12).toFixed(1)} yıl)`);
  const gain = iFlat >= 0 && iGrow >= 0 ? ` → <b class="hit">${((iFlat - iGrow) / 12).toFixed(1)} yıl erken</b>` : "";
  const end20 = mainPath ? ` · 20. yıl değeri ${usdShort(flat[239])} → <b>${usdShort(mainPath[239])}</b>` : "";
  const label = inp.growthMode === "real" ? `enflasyon + %${(inp.growth * 100).toFixed(1)}` : `%${(inp.growth * 100).toFixed(1)} nominal`;
  return `<div class="warn" style="border-left-color:var(--up)"><b>Katkı artışının etkisi (Ana plan, ${label}/yıl):</b> hedefe ulaşma sabit katkıyla ${at(iFlat)}, artışla ${mainPath ? at(iGrow) : "—"}${gain}${end20} (bugünün doları).${mainPath ? "" : " Karşılaştırma için Ana plan çizgisini açın."}</div>`;
}

function renderStrategyCards() {
  const long = BT.periods.find((p) => p.key === "long");
  const y10 = BT.periods.find((p) => p.key === "y10");
  const order = ["static", "hybrid", "main"];
  document.getElementById("stratCards").innerHTML = order.map((k) => {
    const d = BT.strategies[k];
    const m = long.results[k].metrics;
    const m10 = y10.results[k].metrics;
    const mc = BT.monteCarlo?.[k]?.find((x) => x.horizonYears === 20);
    return `<div class="scard">
      <h3><span class="sw" style="background:${color(k)}"></span>${esc(d.name)}</h3>
      <p><b>${esc(d.summary)}</b></p>
      <p>${esc(d.how)}</p>
      <dl>
        <dt>Reel getiri, 20+ yıl</dt><dd class="${cls(m.realIrr)}">${pct(m.realIrr)}</dd>
        <dt>Reel getiri, son 10 yıl</dt><dd class="${cls(m10.realIrr)}">${pct(m10.realIrr)}</dd>
        <dt>En büyük düşüş</dt><dd class="neg">${pct(m.maxDrawdown)}</dd>
        <dt>En kötü yıl</dt><dd class="neg">${pct(m.worstYear)}</dd>
        <dt>Getiri/risk (Sharpe)</dt><dd>${m.sharpe.toFixed(2)}</dd>
        ${mc ? `<dt>20 yılda hedefe ulaşma olasılığı</dt><dd>${pct(mc.probTarget, 0)}</dd>` : ""}
      </dl>
      <p><span class="badge">Kimin için</span> ${esc(d.forWhom)}</p>
      <p><span class="badge off">Risk</span> ${esc(d.risk)}</p>
    </div>`;
  }).join("");
}

// ------------------------------------------------------------------ bu ayın dağılımı
let AL;
let alStrategy = store.get("panel.alStrategy") || "hybrid";
const TREND = { 1: ["on", "Trend açık"], 0.5: ["half", "Trend yarım"], 0: ["off", "Trend kapalı"] };

function holdingsFromInputs() {
  const h = {};
  let any = false;
  document.querySelectorAll("#alHoldings input").forEach((i) => {
    const v = Number(i.value) || 0;
    h[i.dataset.k] = v;
    if (v > 0) any = true;
  });
  return any ? h : undefined;
}

/** Sunucudaki splitContribution ile aynı mantık (katkıyla dengeleme + tam dolara yuvarlama). */
function split(weights, amount, holdings) {
  const keys = Object.keys(weights);
  let raw;
  const held = holdings ? keys.reduce((a, k) => a + (holdings[k] || 0), 0) : 0;
  if (holdings && held > 0) {
    const total = held + amount;
    const deficit = Object.fromEntries(keys.map((k) => [k, Math.max(0, weights[k] * total - (holdings[k] || 0))]));
    const dsum = Object.values(deficit).reduce((a, b) => a + b, 0);
    raw = Object.fromEntries(keys.map((k) => [k, dsum > 0 ? (deficit[k] / dsum) * Math.min(amount, dsum) + (dsum < amount ? weights[k] * (amount - dsum) : 0) : weights[k] * amount]));
  } else raw = Object.fromEntries(keys.map((k) => [k, weights[k] * amount]));
  const fl = Object.fromEntries(keys.map((k) => [k, Math.floor(raw[k])]));
  let rest = Math.round(amount) - Object.values(fl).reduce((a, b) => a + b, 0);
  for (const k of [...keys].sort((a, b) => (raw[b] - fl[b]) - (raw[a] - fl[a]))) { if (rest <= 0) break; if (raw[k] > 0) { fl[k]++; rest--; } }
  return fl;
}

function alAmount() {
  const base = Math.max(0, Number(document.getElementById("alAmount").value) || 0);
  return base + (document.getElementById("alAnnual").checked ? AL.annualExtraUsd : 0);
}

function renderAllocation() {
  if (!AL) return;
  const order = ["static", "hybrid", "main"];
  document.getElementById("stratTabs").innerHTML = order.map((k) => {
    const s = AL.strategies[k];
    return `<button class="tab" data-k="${k}" aria-pressed="${k === alStrategy}"><b><span class="sw" style="background:${color(k)}"></span>${esc(s.name)}</b><span>${esc(s.summary)}</span></button>`;
  }).join("");
  document.querySelectorAll("#stratTabs .tab").forEach((b) => (b.onclick = () => { alStrategy = b.dataset.k; store.set("panel.alStrategy", alStrategy); renderAllocation(); }));

  const amount = alAmount();
  const holdings = holdingsFromInputs();
  const st = AL.strategies[alStrategy];
  const parts = split(st.weights, amount, holdings);
  document.getElementById("alTotal").textContent = usd(amount);
  const score = Object.fromEntries(AL.assets.map((a) => [a.id, a.score]));
  const rows = Object.keys(st.weights).filter((k) => st.weights[k] > 0 || parts[k] > 0).map((k) => {
    const t = TREND[score[k]];
    const badge = t ? `<span class="badge ${t[0]}">${t[1]}</span>` : k === "SWING" ? `<span class="badge">Sinyal bekler</span>` : `<span class="badge">Güvenli liman</span>`;
    const maxW = Math.max(...Object.values(st.weights));
    return `<tr><td>${esc(AL.bucketNames[k])}</td><td>${badge}</td><td>${pct(st.weights[k], 1)}<div class="rowbar"><i style="width:${(st.weights[k] / maxW) * 100}%"></i></div></td><td><b>${usd(parts[k])}</b></td><td class="venue">${esc(AL.bucketVenues[k])}</td></tr>`;
  }).join("");
  document.getElementById("alTable").innerHTML = `<table><tr><th>Kalem</th><th>Durum</th><th>Hedef pay</th><th>Bu ay alınacak</th><th style="text-align:left">Nerede</th></tr>${rows}<tr><th>Toplam</th><th></th><th>${pct(Object.values(st.weights).reduce((a, b) => a + b, 0), 0)}</th><th>${usd(Object.values(parts).reduce((a, b) => a + b, 0))}</th><th></th></tr></table>`;

  const hedges = Object.entries(st.hedge || {});
  document.getElementById("alHedge").innerHTML = alStrategy === "static"
    ? `<div class="note">Al-tut çoklu stratejisinde trend ne olursa olsun ağırlıklar sabittir; satış ya da hedge yapılmaz.</div>`
    : hedges.length
      ? `<div class="warn"><b>Trendi zayıflayan varlıklar:</b> ${hedges.map(([id, f]) => `${esc(AL.bucketNames[id])} (%${Math.round(f * 100)})`).join(", ")}. Bu varlıkların payı azaltıldı ve fark nakitte bekliyor. Elinizde bu varlıklardan varsa, parantezdeki oran kadarını satın ya da OKX'te o kadar 1x perp short ile hedge edin; trend ay sonunda dönünce geri alın.</div>`
      : `<div class="note">Bütün varlıklar trendde; satış ya da hedge gerekmiyor.</div>`;

  const cmp = Object.keys(AL.strategies.main.weights);
  const splits = Object.fromEntries(order.map((k) => [k, split(AL.strategies[k].weights, amount, holdings)]));
  document.getElementById("alCompare").innerHTML = `<table><tr><th>Kalem</th>${order.map((k) => `<th><span class="sw" style="background:${color(k)}"></span>${esc(AL.strategies[k].name)}</th>`).join("")}</tr>${cmp.filter((b) => order.some((k) => splits[k][b] > 0)).map((b) => `<tr><td>${esc(AL.bucketNames[b])}</td>${order.map((k) => `<td>${splits[k][b] > 0 ? `${usd(splits[k][b])} <small style="color:var(--muted)">${pct(AL.strategies[k].weights[b], 0)}</small>` : "—"}</td>`).join("")}</tr>`).join("")}</table>`;

  document.getElementById("allocLead").innerHTML = `Stratejinizi seçin ve tutarı girin. Sinyal: <b>${AL.signalMonth} ay sonu</b> kapanışı; ay içinde değişmez, <b>${AL.nextUpdate}</b> itibarıyla yenilenir.`;
  document.getElementById("alStatus").textContent = `Hesaplandı: ${new Date(AL.generatedAt).toLocaleString("tr-TR")}`;
}

function initAllocationControls() {
  const month = new Date().getMonth() + 1;
  const ann = document.getElementById("alAnnual");
  document.getElementById("alAnnualLbl").textContent = `Yıllık ek ${usd(AL.annualExtraUsd)}'ü ekle${month === AL.annualMonth ? " (bu ay Ocak)" : ""}`;
  ann.checked = month === AL.annualMonth;
  const amt = document.getElementById("alAmount");
  amt.value = store.get("panel.alAmount") || String(AL.monthlyUsd);
  amt.oninput = () => { store.set("panel.alAmount", amt.value); renderAllocation(); };
  ann.onchange = renderAllocation;
  const saved = JSON.parse(store.get("panel.holdings") || "{}");
  document.getElementById("alHoldings").innerHTML = Object.keys(AL.strategies.main.weights)
    .map((k) => `<label>${esc(AL.bucketNames[k])}<input type="number" min="0" step="100" data-k="${k}" value="${saved[k] ?? ""}" placeholder="0" /></label>`).join("");
  document.querySelectorAll("#alHoldings input").forEach((i) => (i.oninput = () => {
    const h = {};
    document.querySelectorAll("#alHoldings input").forEach((x) => { if (x.value) h[x.dataset.k] = Number(x.value); });
    store.set("panel.holdings", JSON.stringify(h));
    renderAllocation();
  }));
  document.getElementById("alCopy").onclick = async () => {
    const st = AL.strategies[alStrategy];
    const parts = split(st.weights, alAmount(), holdingsFromInputs());
    const text = [`${st.name} — ${AL.signalMonth} sinyali — toplam ${usd(alAmount())}`,
      ...Object.keys(parts).filter((k) => parts[k] > 0).map((k) => `• ${AL.bucketNames[k]}: ${usd(parts[k])} (${pct(st.weights[k], 1)}) → ${AL.bucketVenues[k]}`)].join("\n");
    try { await navigator.clipboard.writeText(text); document.getElementById("alStatus").textContent = "Kopyalandı."; }
    catch { document.getElementById("alStatus").textContent = "Kopyalanamadı; tabloyu elle seçin."; }
  };
  document.getElementById("alRefresh").onclick = async () => { await loadAllocation(); renderAllocation(); };
}

async function loadAllocation() {
  let res = await fetch("/api/allocation").catch(() => null);
  if (!res || !res.ok) res = await fetch("/out/allocation.json").catch(() => null);
  if (!res || !res.ok) throw new Error("Dağılım alınamadı — `npm run web` ile sunucuyu başlatın veya `npm run sinyal` çalıştırın.");
  AL = await res.json();
}

function shortName(k) {
  return { main: "Ana plan", static: "Al-tut çoklu", hybrid: "Hibrit" }[k] || k;
}

function initProjectionControls() {
  const sel = document.getElementById("pjSource");
  sel.innerHTML = `<option value="sel">Seçili backtest dönemi</option>` + BT.periods.map((p) => `<option value="${p.key}">${p.label} (${p.start}→)</option>`).join("");
  sel.value = store.get("panel.pjSource") || "sel";
  sel.onchange = () => { store.set("panel.pjSource", sel.value); renderProjection(); };
  for (const id of ["pjStart", "pjMonthly", "pjAnnual", "pjSpend", "pjInf"]) {
    const el = document.getElementById(id);
    const saved = store.get("panel." + id);
    if (saved !== null) el.value = saved;
    el.oninput = () => { store.set("panel." + id, el.value); renderProjection(); };
  }
  for (const id of ["pjGrowth", "pjGrowthMode"]) {
    const el = document.getElementById(id);
    const saved = store.get("panel." + id);
    if (saved !== null) el.value = saved;
    el.oninput = el.onchange = () => { store.set("panel." + id, el.value); renderProjection(); };
  }
  for (const id of ["pjMode", "pjMeasure"]) {
    const saved = store.get("panel." + id);
    const btns = document.querySelectorAll(`#${id} button`);
    if (saved) btns.forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.v === saved)));
    btns.forEach((b) => (b.onclick = () => {
      btns.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      store.set("panel." + id, b.dataset.v);
      renderProjection();
    }));
  }
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
  loadAllocation()
    .then(() => { initAllocationControls(); renderAllocation(); })
    .catch((e) => (document.getElementById("alTable").textContent = e.message));
  try {
    const res = await fetch("/out/backtest.json");
    if (!res.ok) throw new Error("out/backtest.json yok — `npm run backtest` çalıştırın");
    BT = await res.json();
    document.getElementById("meta").textContent = `Veri sonu ${BT.end} · reel (ABD enflasyonundan arındırılmış) USD · $${BT.plan.monthlyUsd.toLocaleString("en-US")}/ay + $${BT.plan.annualExtraUsd.toLocaleString("en-US")}/yıl`;
    const saved = store.get("panel.period");
    period = BT.periods.some((p) => p.key === saved) ? saved : "long";
    renderPeriodChips();
    renderStrategyCards();
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
