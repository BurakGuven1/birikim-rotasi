/* global LightweightCharts */
const LC = window.LightweightCharts;
const NO_CHART = `<div class="callout warn">Grafik kütüphanesi yüklenemedi (internet bağlantısını kontrol edin). Tablolar çalışmaya devam eder.</div>`;
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const pct = (x, d = 1) => (Number.isFinite(x) ? (x * 100).toFixed(d) + "%" : "—");
const usd = (x) => (Number.isFinite(x) ? "$" + Math.round(x).toLocaleString("en-US") : "—");
const usdShort = (x) => (!Number.isFinite(x) ? "—" : Math.abs(x) >= 1e6 ? "$" + (x / 1e6).toFixed(2) + "M" : Math.abs(x) >= 1e3 ? "$" + Math.round(x / 1e3) + "K" : "$" + Math.round(x));
const cls = (x) => (x > 0 ? "pos" : x < 0 ? "neg" : "");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const $ = (id) => document.getElementById(id);
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const MONTHS_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const monthLabel = (ym) => `${MONTHS_TR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const dayLabel = (d) => new Date(d + (d.length === 10 ? "T12:00:00" : "")).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* yok say */ } },
};

// Kimlik renkleri sabittir: filtre değişince yeniden boyanmaz
const ORDER = ["static", "hybrid", "main"];
const SERIES = { static: "--s3", hybrid: "--s4", main: "--s1" };
const TAGS = { static: "En yüksek getiri", hybrid: "En iyi denge", main: "En düşük düşüş" };
const BUCKET_COLOR = { SPY: "--s1", QQQ: "--s7", GLD: "--s4", BIST: "--s8", BTC: "--s2", ETH: "--s5", DBC: "--s3", SWING: "--s6", NAKIT: "--s9" };
const color = (key) => css(SERIES[key] || BUCKET_COLOR[key] || "--muted");

let BT;
let AL;
let period = new URLSearchParams(location.search).get("period") || store.get("panel.period") || "long";
let alStrategy = store.get("panel.alStrategy") || "static";
// Derin bağlantı: ?view=diff|dd|value ve ?period=y10 gibi
const QP = new URLSearchParams(location.search);
let chartView = QP.get("view") || store.get("panel.chartView") || "value";
const savedVisible = (JSON.parse(store.get("panel.visible") || "null") || []).filter((k) => k in SERIES);
const visible = new Set(savedVisible.length ? savedVisible : ORDER);

const FALLBACK_STRATEGIES = {
  static: { name: "Al-tut çoklu", summary: "Yedi varlık sabit ağırlıkla, her zaman yatırımda.", how: "Katkı her ay aynı sabit ağırlıklarla yedi varlığa gider; nakde geçilmez, hedge yapılmaz.", forWhom: "−%40 düşüşlerde satmadan bekleyebilen.", risk: "En derin düşüş; getirinin yarısı kriptodan." },
  hybrid: { name: "Hibrit", summary: "Her varlığın yarısı hep tutulur, yarısı trend kuralına göre nakde geçer.", how: "Trend bozulan varlığın yarısı ay sonunda nakde geçer, trend dönünce geri alınır.", forWhom: "Getiri/risk dengesi isteyen.", risk: "Hızlı V-dönüşlerde geç kalır." },
  main: { name: "Ana plan", summary: "Hibrit çekirdek %80 + OKX'te swing sistemleri %20.", how: "Katkının %20'si swing kasasına gider; sinyal gelince işlem açılır.", forWhom: "En düşük düşüşü isteyen.", risk: "Swing kolu getiriyi düşürdü; zaman ister." },
};

// ------------------------------------------------------------------ yardımcılar
function baseChart(el, opts = {}) {
  if (!LC) { el.innerHTML = NO_CHART; throw new Error("grafik yok"); }
  return LC.createChart(el, {
    autoSize: true,
    layout: { background: { color: "transparent" }, textColor: css("--muted"), fontSize: 12, attributionLogo: false },
    grid: { vertLines: { visible: false }, horzLines: { color: css("--line2") } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false },
    localization: { priceFormatter: usdShort },
    crosshair: { mode: 0, vertLine: { color: css("--muted"), labelBackgroundColor: css("--ink") }, horzLine: { color: css("--muted"), labelBackgroundColor: css("--ink") } },
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    ...opts,
  });
}
function fitOnDblClick(el, chart) { el.ondblclick = () => chart.timeScale().fitContent(); }

function countUp(el, to, fmt = usd, ms = 700) {
  if (!el) return;
  const from = Number(el.dataset.v || 0);
  el.dataset.v = String(to);
  if (REDUCED || !Number.isFinite(from)) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - (1 - k) ** 3;
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

let toastTimer;
function toast(html, ms = 4500) {
  const t = $("toast");
  t.innerHTML = html;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

function reveal() {
  const els = document.querySelectorAll(".reveal:not(.in)");
  if (REDUCED || !("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
  const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }), { rootMargin: "0px 0px -40px 0px" });
  els.forEach((e) => io.observe(e));
}

async function fetchJSON(urls) {
  for (const u of urls) {
    try {
      const r = await fetch(u, { cache: "no-store" });
      if (r.ok) return await r.json();
    } catch { /* sıradakini dene */ }
  }
  return null;
}

const P = () => BT.periods.find((p) => p.key === period) || BT.periods.find((p) => p.key === "long");
const periodShort = (p) => (p.key === "long" ? "20+ yıl" : p.key === "crypto" ? "2018+" : p.label.replace("Son ", ""));

// ------------------------------------------------------------------ üst bar: tazelik ve yenileme
function renderFreshness() {
  const pill = $("freshness");
  if (!AL) { pill.className = "pill warn"; pill.querySelector("span").textContent = "Veri yok"; return; }
  const last = AL.assets.map((a) => a.liveDate).sort().pop();
  const ageDays = (Date.now() - Date.parse(last)) / 86_400_000;
  pill.className = `pill ${ageDays < 4 ? "ok" : "warn"}`;
  pill.querySelector("span").textContent = `Fiyatlar ${dayLabel(last)} · sinyal ${monthLabel(AL.signalMonth)} sonu`;
  $("meta").textContent = `Reel USD · son hesap ${new Date(AL.generatedAt).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" })}`;
}

function weightChanges(prev, next, key) {
  if (!prev || !next) return [];
  const a = prev.strategies[key].weights;
  const b = next.strategies[key].weights;
  return Object.keys(b).filter((k) => Math.abs((a[k] || 0) - b[k]) > 0.0005).map((k) => `${next.bucketNames[k]}: ${pct(a[k] || 0)} → <b>${pct(b[k])}</b>`);
}

async function refreshAll() {
  const btn = $("refreshAll");
  btn.disabled = true;
  btn.classList.add("loading");
  btn.querySelector("span").textContent = "Yenileniyor…";
  const prev = AL;
  try {
    const r = await fetch("/api/refresh", { method: "POST" });
    if (!r.ok) throw new Error(await r.text());
    const res = await r.json();
    AL = res.allocation;
    BT = (await fetchJSON(["/api/backtest"])) || BT;
    renderEverything();
    const ch = weightChanges(prev, AL, alStrategy);
    const head = res.refreshed ? "Veriler yeniden indirildi ve her şey yeniden hesaplandı." : "Veriler 2 dakika içinde zaten yenilenmişti; en güncel hesap gösteriliyor.";
    toast(ch.length
      ? `<b>${head}</b><br>${esc(AL.strategies[alStrategy].name)} dağılımı değişti:<ul>${ch.map((c) => `<li>${c}</li>`).join("")}</ul>`
      : `<b>${head}</b><br>Sinyal değişmedi. Sinyal ${monthLabel(AL.signalMonth)} kapanışına dayanıyor; bir sonraki güncelleme ${dayLabel(AL.nextUpdate)}.`, 7000);
  } catch (e) {
    toast(`<b>Yenilenemedi.</b> Yenileme için panel sunucusu gerekir: <code>npm run web</code>. ${esc(String(e.message || e)).slice(0, 120)}`, 7000);
  } finally {
    btn.disabled = false;
    btn.classList.remove("loading");
    btn.querySelector("span").textContent = "Verileri yenile";
  }
}

// ------------------------------------------------------------------ BU AY
const TREND = { 1: ["on", "Trend açık"], 0.5: ["half", "Trend yarım"], 0: ["off", "Trend kapalı"] };

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

function holdingsFromInputs() {
  const h = {};
  let any = false;
  document.querySelectorAll("#alHoldings input").forEach((i) => { const v = Number(i.value) || 0; h[i.dataset.k] = v; if (v > 0) any = true; });
  return any ? h : undefined;
}
const alAmount = () => Math.max(0, Number($("alAmount").value) || 0) + ($("alAnnual").checked ? AL.annualExtraUsd : 0);
const doneKey = () => `panel.done.${AL.signalMonth}.${alStrategy}`;
const getDone = () => new Set(JSON.parse(store.get(doneKey()) || "[]"));

function renderSignalBox() {
  const days = Math.max(0, Math.ceil((Date.parse(AL.nextUpdate) - Date.now()) / 86_400_000));
  const offs = AL.assets.filter((a) => a.score < 1).length;
  $("signalBox").innerHTML = `
    <div class="sig"><small>Sinyal</small><b>${monthLabel(AL.signalMonth)} sonu</b></div>
    <div class="sig"><small>Sonraki güncelleme</small><b>${dayLabel(AL.nextUpdate)}</b> <small>(${days} gün)</small></div>
    <div class="sig"><small>Trend</small><b>${7 - offs}/7 açık</b>${offs ? ` <small>· ${offs} zayıf</small>` : ""}</div>`;
}

function renderStratTabs() {
  $("stratTabs").innerHTML = ORDER.map((k) => {
    const s = AL.strategies[k];
    return `<button role="tab" data-k="${k}" aria-selected="${k === alStrategy}" style="--sc:${color(k)}"><span class="tag">${TAGS[k]}</span><b><span class="sw" style="background:${color(k)}"></span>${esc(s.name)}</b><span class="d">${esc(s.summary)}</span></button>`;
  }).join("");
  document.querySelectorAll("#stratTabs button").forEach((b) => (b.onclick = () => {
    alStrategy = b.dataset.k;
    store.set("panel.alStrategy", alStrategy);
    renderStratTabs();
    renderAllocation();
    safe(renderProjection);
  }));
}

function renderDonut(st, parts, amount) {
  const svg = $("donut");
  const R = 80, C = 2 * Math.PI * R, GAP = 2;
  const keys = Object.keys(parts).filter((k) => parts[k] > 0);
  const total = keys.reduce((a, k) => a + parts[k], 0) || 1;
  let off = 0;
  const arcs = keys.map((k) => {
    const len = (parts[k] / total) * C;
    const a = { k, len: Math.max(0, len - GAP), off };
    off += len;
    return a;
  });
  svg.innerHTML = `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${css("--line2")}" stroke-width="26"></circle>` +
    arcs.map((a) => `<circle class="seg-arc" data-k="${a.k}" cx="100" cy="100" r="${R}" stroke="${color(a.k)}" stroke-dasharray="0 ${C}" stroke-dashoffset="${-a.off}"><title>${esc(AL.bucketNames[a.k])}: ${usd(parts[a.k])}</title></circle>`).join("");
  requestAnimationFrame(() => requestAnimationFrame(() => {
    svg.querySelectorAll(".seg-arc").forEach((c, i) => c.setAttribute("stroke-dasharray", `${arcs[i].len} ${C}`));
  }));
  countUp($("alTotal"), amount);
  $("alStratName").textContent = st.name;
  $("donutLegend").innerHTML = keys.map((k) => `<li data-k="${k}"><span class="sw" style="background:${color(k)}"></span>${esc(AL.bucketNames[k].replace(" (altcoin vekili)", ""))}<b>${pct(parts[k] / total, 0)}</b></li>`).join("");
  const hl = (k, on) => document.querySelectorAll(`[data-k="${k}"]`).forEach((e) => e.classList.toggle("hl", on));
  document.querySelectorAll("#donut .seg-arc, #donutLegend li, #alList .item").forEach((e) => {
    e.onmouseenter = () => hl(e.dataset.k, true);
    e.onmouseleave = () => hl(e.dataset.k, false);
  });
}

function renderAllocation() {
  if (!AL) return;
  const amount = alAmount();
  const holdings = holdingsFromInputs();
  const st = AL.strategies[alStrategy];
  const parts = split(st.weights, amount, holdings);
  const score = Object.fromEntries(AL.assets.map((a) => [a.id, a.score]));
  const done = getDone();
  const maxW = Math.max(...Object.values(st.weights));
  const keys = Object.keys(st.weights).filter((k) => parts[k] > 0 || st.weights[k] > 0).sort((a, b) => parts[b] - parts[a]);
  $("alList").innerHTML = keys.map((k, i) => {
    const t = TREND[score[k]];
    const badge = t ? `<span class="badge ${t[0]}">${t[1]}</span>` : k === "SWING" ? `<span class="badge">Sinyal bekler</span>` : `<span class="badge">Güvenli liman</span>`;
    return `<div class="item ${done.has(k) ? "done" : ""}" data-k="${k}" style="animation-delay:${i * 35}ms">
      <button class="check" aria-label="${esc(AL.bucketNames[k])} alındı" aria-pressed="${done.has(k)}"><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg></button>
      <div><div class="it-top"><span class="sw" style="background:${color(k)}"></span><span class="it-name">${esc(AL.bucketNames[k])}</span>${badge}</div>
        <div class="it-venue">${esc(AL.bucketVenues[k])}</div>
        <div class="it-bar"><i data-w="${(st.weights[k] / maxW) * 100}" style="background:${color(k)}"></i></div></div>
      <div class="it-amt"><b>${usd(parts[k])}</b><small>${pct(st.weights[k], 1)}</small></div>
    </div>`;
  }).join("");
  requestAnimationFrame(() => document.querySelectorAll("#alList .it-bar i").forEach((i) => (i.style.width = i.dataset.w + "%")));
  document.querySelectorAll("#alList .check").forEach((b) => (b.onclick = () => {
    const k = b.closest(".item").dataset.k;
    const d = getDone();
    d.has(k) ? d.delete(k) : d.add(k);
    store.set(doneKey(), JSON.stringify([...d]));
    b.closest(".item").classList.toggle("done", d.has(k));
    b.setAttribute("aria-pressed", String(d.has(k)));
    renderProgress(keys);
  }));
  renderProgress(keys);

  const hedges = Object.entries(st.hedge || {});
  $("alHedge").innerHTML = alStrategy === "static"
    ? `<div class="callout">Al-tut çoklu'da trend ne olursa olsun ağırlıklar sabittir: her ay aynı oranlarla alınır; satış ya da hedge yapılmaz.</div>`
    : hedges.length
      ? `<div class="callout warn"><b>Trendi zayıflayan varlıklar:</b> ${hedges.map(([id, f]) => `${esc(AL.bucketNames[id])} (%${Math.round(f * 100)})`).join(", ")}. Bu varlıkların bu ayki payı azaltıldı, fark nakitte bekliyor. Elinizde bu varlıklardan varsa parantezdeki oran kadarını satın ya da OKX'te 1x perp short ile hedge edin; trend ay sonunda dönünce geri alın.</div>`
      : `<div class="callout good">Bütün varlıklar trendde; satış ya da hedge gerekmiyor.</div>`;

  renderDonut(st, parts, amount);

  const splits = Object.fromEntries(ORDER.map((k) => [k, split(AL.strategies[k].weights, amount, holdings)]));
  const rows = Object.keys(AL.strategies.main.weights).filter((b) => ORDER.some((k) => splits[k][b] > 0));
  $("alCompare").innerHTML = `<table><tr><th>Kalem</th>${ORDER.map((k) => `<th><span class="sw" style="background:${color(k)}"></span> ${esc(AL.strategies[k].name)}</th>`).join("")}</tr>${rows.map((b) => `<tr><td><span class="sw" style="background:${color(b)}"></span> ${esc(AL.bucketNames[b])}</td>${ORDER.map((k) => `<td>${splits[k][b] > 0 ? `${usd(splits[k][b])} <small>${pct(AL.strategies[k].weights[b], 0)}</small>` : "—"}</td>`).join("")}</tr>`).join("")}</table>`;
}

function renderProgress(keys) {
  const d = getDone();
  const n = keys.filter((k) => d.has(k)).length;
  $("alProgress").style.width = `${(n / keys.length) * 100}%`;
  $("alProgressLbl").textContent = n === keys.length ? "Bu ayın alımları tamam 🎉" : `${n}/${keys.length} kalem alındı`;
}

function initAllocationControls() {
  const month = new Date().getMonth() + 1;
  $("alAnnualLbl").textContent = `Yıllık ek ${usd(AL.annualExtraUsd)}${month === AL.annualMonth ? " (Ocak)" : ""}`;
  $("alAnnual").checked = month === AL.annualMonth;
  const amt = $("alAmount");
  amt.value = store.get("panel.alAmount") || String(AL.monthlyUsd);
  amt.oninput = () => { store.set("panel.alAmount", amt.value); renderAllocation(); };
  $("alAnnual").onchange = renderAllocation;
  $("quickAmounts").innerHTML = [500, 1000, 1500, 2000].map((v) => `<button data-v="${v}">$${v.toLocaleString("en-US")}</button>`).join("");
  document.querySelectorAll("#quickAmounts button").forEach((b) => (b.onclick = () => { amt.value = b.dataset.v; store.set("panel.alAmount", amt.value); renderAllocation(); }));
  const saved = JSON.parse(store.get("panel.holdings") || "{}");
  $("alHoldings").innerHTML = Object.keys(AL.strategies.main.weights)
    .map((k) => `<label>${esc(AL.bucketNames[k])}<input type="number" min="0" step="100" data-k="${k}" value="${saved[k] ?? ""}" placeholder="0" /></label>`).join("");
  document.querySelectorAll("#alHoldings input").forEach((i) => (i.oninput = () => {
    const h = {};
    document.querySelectorAll("#alHoldings input").forEach((x) => { if (x.value) h[x.dataset.k] = Number(x.value); });
    store.set("panel.holdings", JSON.stringify(h));
    renderAllocation();
  }));
  $("alCopy").onclick = async () => {
    const st = AL.strategies[alStrategy];
    const parts = split(st.weights, alAmount(), holdingsFromInputs());
    const text = [`${st.name} — ${monthLabel(AL.signalMonth)} sinyali — toplam ${usd(alAmount())}`,
      ...Object.keys(parts).filter((k) => parts[k] > 0).sort((a, b) => parts[b] - parts[a]).map((k) => `• ${AL.bucketNames[k]}: ${usd(parts[k])} (${pct(st.weights[k], 1)}) → ${AL.bucketVenues[k]}`)].join("\n");
    try { await navigator.clipboard.writeText(text); toast("Alım listesi panoya kopyalandı."); }
    catch { toast("Kopyalanamadı; listeyi elle seçin."); }
  };
  $("alReset").onclick = () => { store.set(doneKey(), "[]"); renderAllocation(); };
  $("alSave").onclick = saveMonthToPortfolio;
  $("alFill").onclick = async () => {
    await PfStore.migrate();
    const pf = await PfStore.sync().catch(() => null);
    if (!pf) { toast("Portföy değerlenemedi — panel sunucusuna ulaşılamıyor."); return; }
    const vals = Object.fromEntries(pf.valuation.positions.map((p) => [p.asset, Math.round(p.value)]));
    document.querySelectorAll("#alHoldings input").forEach((i) => (i.value = vals[i.dataset.k] || ""));
    store.set("panel.holdings", JSON.stringify(vals));
    renderAllocation();
    toast(pf.valuation.positions.length ? "Mevcut portföy değerleri dolduruldu; katkı hedefin altındaki kalemlere yönlendirildi." : "Portföyünüzde henüz işlem yok.");
  };
  $("alClear").onclick = () => { document.querySelectorAll("#alHoldings input").forEach((i) => (i.value = "")); store.set("panel.holdings", "{}"); renderAllocation(); };
}

async function saveMonthToPortfolio() {
  const st = AL.strategies[alStrategy];
  const parts = split(st.weights, alAmount(), holdingsFromInputs());
  const keys = Object.keys(parts).filter((k) => parts[k] > 0);
  if (!keys.length) { toast("Kaydedilecek tutar yok."); return; }
  const key = `panel.saved.${AL.signalMonth}.${alStrategy}`;
  const already = store.get(key);
  const msg = `${st.name} dağılımıyla ${usd(alAmount())} tutarındaki ${keys.length} alım, bugünkü fiyatlardan portföyünüze kaydedilsin mi?` + (already ? `\n\nDikkat: bu ay için ${already} tarihinde zaten kayıt yapılmış.` : "");
  if (!confirm(msg)) return;
  const btn = $("alSave");
  btn.disabled = true;
  try {
    await PfStore.migrate();
    const j = await PfStore.sync({ add: keys.map((k) => ({ asset: k, side: "buy", usd: parts[k], strategy: `${st.name} · ${monthLabel(AL.signalMonth)} sinyali` })) });
    store.set(key, new Date().toLocaleDateString("tr-TR"));
    store.set(doneKey(), JSON.stringify(keys));
    renderAllocation();
    toast(`<b>${keys.length} alım portföye kaydedildi.</b> Toplam portföy: ${usd(j.valuation.totals.value)}. <a href="/portfoy.html" style="color:inherit">Portföyüme git →</a>`, 7000);
  } catch (e) {
    toast(`Kaydedilemedi: ${esc(e.message)}.`, 7000);
  } finally {
    btn.disabled = false;
  }
}

// ------------------------------------------------------------------ STRATEJİ KARTLARI
function sparkPath(values, w = 300, h = 56) {
  const xs = values.map((v) => Math.log(Math.max(v, 1e-9)));
  const lo = Math.min(...xs), hi = Math.max(...xs);
  return xs.map((v, i) => `${i ? "L" : "M"}${((i / (xs.length - 1)) * w).toFixed(1)},${(h - 4 - ((v - lo) / (hi - lo || 1)) * (h - 8)).toFixed(1)}`).join(" ");
}

function renderStrategyCards() {
  const long = BT.periods.find((p) => p.key === "long");
  const y10 = BT.periods.find((p) => p.key === "y10");
  const mx = (f) => Math.max(...ORDER.map((k) => Math.abs(f(k))));
  const irrMax = mx((k) => long.results[k].metrics.realIrr);
  const irr10Max = mx((k) => y10.results[k].metrics.realIrr);
  const ddMax = mx((k) => long.results[k].metrics.maxDrawdown);
  const shMax = mx((k) => long.results[k].metrics.sharpe);
  const metric = (lbl, val, frac, c, tone = "") => `<div class="metric"><span class="lbl">${lbl}</span><span class="val ${tone}">${val}</span><div class="mbar"><i data-w="${Math.min(100, frac * 100)}" style="background:${c}"></i></div></div>`;
  $("stratCards").innerHTML = ORDER.map((k) => {
    const d = BT.strategies[k];
    const m = long.results[k].metrics;
    const m10 = y10.results[k].metrics;
    const mc = BT.monteCarlo?.[k]?.find((x) => x.horizonYears === 20);
    const twr = long.results[k].twr || long.results[k].value;
    const c = color(k);
    return `<article class="scard" style="--sc:${c}">
      <h3><span class="sw" style="background:${c}"></span>${esc(d.name)} <span class="badge">${TAGS[k]}</span></h3>
      <p class="tagline">${esc(d.summary)}</p>
      <svg class="spark" viewBox="0 0 300 56" preserveAspectRatio="none" aria-label="20 yıllık büyüme eğrisi (log)"><path d="${sparkPath(twr)}" fill="none" stroke="${c}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
      ${metric("Reel getiri · 20+ yıl", pct(m.realIrr), m.realIrr / irrMax, c, "pos")}
      ${metric("Reel getiri · son 10 yıl", pct(m10.realIrr), m10.realIrr / irr10Max, c, "pos")}
      ${metric("En büyük düşüş", pct(m.maxDrawdown), Math.abs(m.maxDrawdown) / ddMax, css("--down"), "neg")}
      ${metric("Getiri/risk (Sharpe)", m.sharpe.toFixed(2), m.sharpe / shMax, c)}
      ${mc ? metric("20 yılda hedefe ulaşma olasılığı", pct(mc.probTarget, 0), mc.probTarget, c) : ""}
      <p>${esc(d.how)}</p>
      <div class="who"><b>Kimin için:</b>${esc(d.forWhom)}</div>
      <div class="who"><b>Risk:</b>${esc(d.risk)}</div>
    </article>`;
  }).join("");
  const io = !REDUCED && "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.querySelectorAll(".mbar i").forEach((i) => (i.style.width = i.dataset.w + "%")); io.unobserve(e.target); } }), { threshold: 0.2 }) : null;
  document.querySelectorAll(".scard").forEach((c) => (io ? io.observe(c) : c.querySelectorAll(".mbar i").forEach((i) => (i.style.width = i.dataset.w + "%"))));
}

// ------------------------------------------------------------------ PERFORMANS
function renderPeriodChips() {
  $("periods").innerHTML = BT.periods.map((p) => `<button role="tab" data-k="${p.key}" aria-selected="${p.key === period}" title="${esc(p.start)} → ${BT.end}">${periodShort(p)}</button>`).join("");
  document.querySelectorAll("#periods button").forEach((b) => (b.onclick = () => setPeriod(b.dataset.k)));
}

function setPeriod(k) {
  period = k;
  store.set("panel.period", k);
  document.querySelectorAll("#periods button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.k === k)));
  renderKpis();
  safe(renderPerfChart);
  renderMatrix();
  renderTable();
  safe(renderProjection);
}

/** Grafik hatası (ör. kütüphane yüklenemedi) sayfanın geri kalanını durdurmasın. */
function safe(fn) {
  try { fn(); } catch (e) { if (String(e.message) !== "grafik yok") console.error(e); }
}

function renderKpis() {
  const p = P();
  $("perfLead").textContent = `${p.label}: ${p.start} → ${BT.end}. ${p.note}`;
  $("kpis").innerHTML = ORDER.map((k) => {
    const m = p.results[k].metrics;
    return `<div class="kpi ${visible.has(k) ? "" : "off"}" data-k="${k}" title="Grafikte göster/gizle">
      <div class="kh"><span class="sw" style="background:${color(k)}"></span>${esc(BT.strategies[k].name)}</div>
      <div class="kg"><div><small>Reel getiri</small><b class="${cls(m.realIrr)}">${pct(m.realIrr)}</b></div><div><small>Maks düşüş</small><b class="neg">${pct(m.maxDrawdown)}</b></div><div><small>Son değer</small><b class="cnt" data-to="${m.finalValue}">$0</b></div></div>
    </div>`;
  }).join("");
  document.querySelectorAll("#kpis .cnt").forEach((e) => countUp(e, Number(e.dataset.to), usdShort));
  document.querySelectorAll("#kpis .kpi").forEach((e) => (e.onclick = () => toggleVisible(e.dataset.k)));
}

function toggleVisible(k) {
  visible.has(k) ? visible.delete(k) : visible.add(k);
  if (!visible.size) visible.add(k);
  store.set("panel.visible", JSON.stringify([...visible]));
  renderKpis();
  safe(renderPerfChart);
  safe(renderProjection);
}

let perfChart;
function renderPerfChart() {
  const p = P();
  if (perfChart) perfChart.remove();
  const el = $("perfChart");
  const pctFmt = (x) => `${x.toFixed(0)}%`;
  perfChart = baseChart(el, chartView === "dd" ? { localization: { priceFormatter: pctFmt } } : {});
  document.querySelectorAll("#chartTabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.v === chartView)));
  const t = (m) => m + "-01";
  const line = (data, o) => { const s = perfChart.addSeries(LC.LineSeries, { priceLineVisible: false, lastValueVisible: false, lineWidth: 2, ...o }); s.setData(data); return s; };
  const keys = ORDER.filter((k) => visible.has(k));
  const R = p.results;
  $("chartToolbar").innerHTML = "";
  let insight = "";

  if (chartView === "value") {
    if (R.static.months.length > 60) perfChart.priceScale("right").applyOptions({ mode: LC.PriceScaleMode.Logarithmic });
    line(R.static.months.map((m, i) => ({ time: t(m), value: Math.max(R.static.contributed[i], 1) })), { color: css("--muted"), lineStyle: 2, lineWidth: 1 });
    for (const k of keys) {
      const s = perfChart.addSeries(LC.AreaSeries, { lineColor: color(k), topColor: color(k) + "33", bottomColor: color(k) + "00", lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
      s.setData(R[k].months.map((m, i) => ({ time: t(m), value: Math.max(R[k].value[i], 1) })));
    }
    const lead = Object.fromEntries(ORDER.map((k) => [k, 0]));
    R.static.months.forEach((_, i) => { if (i === 0) return; const best = ORDER.reduce((a, k) => (R[k].value[i] > R[a].value[i] ? k : a), ORDER[0]); lead[best]++; });
    const n = R.static.months.length - 1;
    insight = `<b>Kim öndeydi?</b> ${ORDER.map((k) => `${esc(BT.strategies[k].name)} ayların <b>%${Math.round((lead[k] / n) * 100)}</b>'inde en yüksek değerdeydi`).join(" · ")}. ${R.static.months.length > 60 ? "Logaritmik ölçek: eşit dikey mesafe, eşit yüzde değişim demektir." : ""}`;
  } else if (chartView === "diff") {
    const a = store.get("panel.diffA") || "static";
    const b = store.get("panel.diffB") || "hybrid";
    const opt = (sel) => ORDER.map((k) => `<option value="${k}" ${k === sel ? "selected" : ""}>${esc(BT.strategies[k].name)}</option>`).join("");
    $("chartToolbar").innerHTML = `<select id="diffA">${opt(a)}</select><span>eksi</span><select id="diffB">${opt(b)}</select><span>— portföy değeri farkı</span>`;
    $("diffA").onchange = (e) => { store.set("panel.diffA", e.target.value); renderPerfChart(); };
    $("diffB").onchange = (e) => { store.set("panel.diffB", e.target.value); renderPerfChart(); };
    const s = perfChart.addSeries(LC.BaselineSeries, {
      baseValue: { type: "price", price: 0 },
      topLineColor: css("--up"), topFillColor1: css("--up") + "44", topFillColor2: css("--up") + "08",
      bottomLineColor: css("--down"), bottomFillColor1: css("--down") + "08", bottomFillColor2: css("--down") + "44",
      lineWidth: 2, priceLineVisible: false,
    });
    const diff = R[a].months.map((m, i) => ({ time: t(m), value: R[a].value[i] - R[b].value[i] }));
    s.setData(diff);
    const n = diff.length - 1;
    const ahead = diff.slice(1).filter((d) => d.value >= 0).length;
    let worst = { value: Infinity, time: "", ratio: 0 };
    diff.forEach((d, i) => { if (i && d.value < worst.value) worst = { ...d, ratio: R[a].value[i] / R[b].value[i] - 1 }; });
    const na = esc(BT.strategies[a].name), nb = esc(BT.strategies[b].name);
    insight = a === b ? "Karşılaştırmak için iki farklı strateji seçin." :
      `<b>${na}</b>, ${nb}'nin ayların <b>%${Math.round((ahead / n) * 100)}</b>'inde önündeydi. ` +
      (worst.value < 0 ? `En çok geride kaldığı an: <b>${monthLabel(worst.time.slice(0, 7))}</b>, ${usd(-worst.value)} (%${Math.abs(worst.ratio * 100).toFixed(1)}) geride. ` : `Bu dönemde hiç geride kalmadı. `) +
      `Dönem sonunda fark: <b class="${cls(diff[n].value)}">${diff[n].value >= 0 ? "+" : "−"}${usd(Math.abs(diff[n].value))}</b>. Yeşil alan ${na}'nin önde olduğu ayları gösterir.`;
  } else {
    // Zirveden düşüş: katkılardan arındırılmış strateji getirisi (TWR) üzerinden
    const worst = {};
    for (const k of keys) {
      const tw = R[k].twr || R[k].value;
      let peak = -Infinity;
      const dd = tw.map((v, i) => { peak = Math.max(peak, v); const x = (v / peak - 1) * 100; if (!worst[k] || x < worst[k].v) worst[k] = { v: x, m: R[k].months[i] }; return { time: t(R[k].months[i]), value: x }; });
      const s = perfChart.addSeries(LC.AreaSeries, { lineColor: color(k), topColor: color(k) + "00", bottomColor: color(k) + "30", invertFilledArea: true, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
      s.setData(dd);
    }
    insight = `<b>En derin düşüşler:</b> ${keys.map((k) => `${esc(BT.strategies[k].name)} %${Math.abs(worst[k].v).toFixed(1)} (${monthLabel(worst[k].m)})`).join(" · ")}. Bu grafik katkılardan bağımsız strateji getirisini gösterir. Portföyün dolar değeri düşüşte bile başka bir stratejinin üstünde kalabilir; onu "Fark ($)" sekmesinde görün.`;
  }
  perfChart.timeScale().fitContent();
  fitOnDblClick(el, perfChart);
  $("perfLegend").innerHTML = ORDER.map((k) => `<button data-k="${k}" aria-pressed="${visible.has(k)}"><span class="sw" style="background:${color(k)}"></span>${esc(BT.strategies[k].name)}</button>`).join("") +
    (chartView === "value" ? `<span class="li"><span class="sw" style="background:var(--muted)"></span>Yatırılan</span>` : "") + `<span class="li">Çift tık: tümünü göster</span>`;
  document.querySelectorAll("#perfLegend button").forEach((b) => (b.onclick = () => toggleVisible(b.dataset.k)));
  $("perfInsight").innerHTML = insight;
}

function renderMatrix() {
  const all = BT.periods.flatMap((p) => ORDER.map((k) => p.results[k].metrics.realIrr));
  const hi = Math.max(...all);
  const head = `<tr><th>Strateji</th>${BT.periods.map((p) => `<th class="clk ${p.key === period ? "sel" : ""}" data-k="${p.key}">${periodShort(p)}</th>`).join("")}</tr>`;
  const rows = ORDER.map((k) => `<tr><td><span class="sw" style="background:${color(k)}"></span> ${esc(BT.strategies[k].name)}</td>${BT.periods.map((p) => {
    const x = p.results[k].metrics.realIrr;
    const best = Math.max(...ORDER.map((w) => p.results[w].metrics.realIrr));
    const a = Math.max(0, Math.min(1, x / hi));
    return `<td class="heat ${p.key === period ? "sel" : ""}" style="background:color-mix(in srgb, var(--up) ${Math.round(a * 28)}%, transparent);${x === best ? "box-shadow:inset 0 -2px 0 var(--up)" : ""}">${pct(x)}</td>`;
  }).join("")}</tr>`).join("");
  $("matrix").innerHTML = `<table>${head}${rows}</table><p class="note">Koyu yeşil = daha yüksek reel getiri; alt çizgi = o dönemin en iyisi.</p>`;
  document.querySelectorAll("#matrix th[data-k]").forEach((th) => (th.onclick = () => setPeriod(th.dataset.k)));
}

function renderTable() {
  const p = P();
  const head = ["Strateji", "Reel IRR", "Reel CAGR", "Nominal CAGR", "Maks düşüş", "Sharpe", "En kötü yıl", "Yatırılan", "Son değer", "Kat"];
  const rows = ORDER.map((k) => {
    const m = p.results[k].metrics;
    return `<tr><td><span class="sw" style="background:${color(k)}"></span> ${esc(BT.strategies[k].name)}</td>
      <td class="${cls(m.realIrr)}">${pct(m.realIrr)}</td><td class="${cls(m.realCagr)}">${pct(m.realCagr)}</td><td>${pct(m.cagr)}</td>
      <td class="neg">${pct(m.maxDrawdown)}</td><td>${m.sharpe.toFixed(2)}</td><td class="${cls(m.worstYear)}">${m.years >= 1 ? pct(m.worstYear) : "—"}</td>
      <td>${usd(m.totalContributed)}</td><td>${usd(m.finalValue)}</td><td>${(m.finalValue / m.totalContributed).toFixed(2)}x</td></tr>`;
  }).join("");
  $("table").innerHTML = `<table><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>${rows}</table>`;
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

function monteCarlo(inp, months, nextMonth, focus) {
  const key = JSON.stringify([focus, inp.start, inp.monthly, inp.annual, inp.inf, inp.growth, inp.growthMode, months]);
  if (mcCache.key === key) return mcCache.bands;
  const twr = BT.periods.find((p) => p.key === "long").results[focus].realTwr;
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
  if (src.results.static.metrics.years < 5)
    warns.push(`${src.label} kısa bir pencere; bu getiriyi 20 yıla taşımak çok iyimser ya da çok kötümser olabilir.`);
  document.getElementById("pjWarn").innerHTML = warns.map((w) => `<div class="callout warn">${w}</div>`).join("");

  const keys = BT.variants.map((v) => v.key).filter((k) => visible.has(k));
  const paths = {};
  for (const k of keys) {
    const r = rateOf(k);
    const rm = (1 + r) ** (1 / 12) - 1;
    paths[k] = simulatePath(() => rm, inp, months, nextMonth);
  }
  const focus = visible.has(alStrategy) ? alStrategy : keys[0] || "static";
  const fname = BT.strategies[focus].name;
  const bands = monteCarlo(inp, months, nextMonth, focus);

  if (projChart) projChart.remove();
  projChart = baseChart(document.getElementById("projection"));
  projChart.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: 0.02 } });
  const line = (data, o) => { const s = projChart.addSeries(LC.LineSeries, { priceLineVisible: false, lastValueVisible: false, lineWidth: 2, ...o }); s.setData(data); return s; };
  const blue = color(focus);
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
  const mainRm = (1 + rateOf(focus)) ** (1 / 12) - 1;
  const flatMain = simulatePath(() => mainRm, { ...inp, growthMode: "flat" }, months, nextMonth);
  line(cut(invested).map((v, m) => ({ time: dateAt(m), value: v })), { color: css("--muted"), lineWidth: 1, lineStyle: 2 });
  line(Array.from({ length: shown }, (_, m) => ({ time: dateAt(m), value: show(target, m) })), { color: css("--warn"), lineWidth: 1, lineStyle: 1 });
  for (const k of keys) line(cut(paths[k]).map((v, m) => ({ time: dateAt(m), value: show(v, m) })), { color: color(k), lastValueVisible: k === focus });
  projChart.timeScale().fitContent();
  fitOnDblClick(document.getElementById("projection"), projChart);

  document.getElementById("pjLegend").innerHTML =
    keys.map((k) => `<span><span class="sw" style="background:${color(k)}"></span>${esc(BT.variants.find((v) => v.key === k).name)} (${pct(rateOf(k))}/yıl)</span>`).join("") +
    `<span><span class="sw" style="background:transparent;border:1px dashed ${blue}"></span>${esc(fname)} Monte Carlo %10–%90 (20+ yıl verisi)</span>` +
    `<span><span class="sw" style="background:var(--muted)"></span>Yatırılan</span><span><span class="sw" style="background:var(--warn)"></span>Hedef ${usdShort(target)}</span>`;

  const head = `<tr><th>Ufuk</th><th>Yıl</th><th>O yıl aylık katkı</th><th>Toplam yatırım</th>${keys.map((k) => `<th><span class="sw" style="background:${color(k)}"></span>${esc(shortName(k))}</th>`).join("")}<th>${esc(fname)} MC (kötü / medyan / iyi)</th></tr>`;
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
  document.getElementById("pjImpact").innerHTML = growthImpact(paths[focus] || null, flatMain, target, dateAt, inp, fname);
  document.getElementById("pjNote").textContent =
    `Getiri kaynağı: ${src.label} (${src.start} → ${BT.end}), her stratejinin ${measureLbl}. Başlangıç: ${startYear}. ` +
    `${inp.mode === "nominal" ? `Nominal gösterimde %${(inp.inf * 100).toFixed(1)} enflasyon varsayılır. ` : "Tutarlar bugünün alım gücüyle. "}` +
    `Katkılar her 12 ayda bir artar (${inp.growthMode === "flat" ? "artış yok" : inp.growthMode === "real" ? `enflasyon %${(inp.inf * 100).toFixed(1)} + %${(inp.growth * 100).toFixed(1)}` : `nominal %${(inp.growth * 100).toFixed(1)}`}); enflasyonun altındaki nominal artış, katkının bugünkü değerini eritir. ` +
    `Hedef = aylık harcama × 12 ÷ %4 güvenli çekim oranı. Geçmiş getiri geleceği garanti etmez.`;
}

function growthImpact(withGrowth, flat, target, dateAt, inp, fname) {
  if (inp.growthMode === "flat" || !(inp.growth > 0 || inp.growthMode === "real")) return "";
  const mainPath = withGrowth || null;
  const iFlat = flat.findIndex((v) => v >= target);
  const iGrow = mainPath ? mainPath.findIndex((v) => v >= target) : -1;
  const at = (i) => (i < 0 ? "30 yılda yok" : `${dateAt(i).slice(0, 7)} (${((i + 1) / 12).toFixed(1)} yıl)`);
  const gain = iFlat >= 0 && iGrow >= 0 ? ` → <b class="hit">${((iFlat - iGrow) / 12).toFixed(1)} yıl erken</b>` : "";
  const end20 = mainPath ? ` · 20. yıl değeri ${usdShort(flat[239])} → <b>${usdShort(mainPath[239])}</b>` : "";
  const label = inp.growthMode === "real" ? `enflasyon + %${(inp.growth * 100).toFixed(1)}` : `%${(inp.growth * 100).toFixed(1)} nominal`;
  return `<div class="callout good"><b>Katkı artışının etkisi (${esc(fname)}, ${label}/yıl):</b> hedefe ulaşma sabit katkıyla ${at(iFlat)}, artışla ${mainPath ? at(iGrow) : "—"}${gain}${end20} (bugünün doları).${mainPath ? "" : " Karşılaştırma için stratejinin çizgisini açın."}</div>`;
}

const shortName = (k) => BT.strategies[k]?.name || k;

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

// ------------------------------------------------------------------ nabız şeridi + öne çıkan haberler
async function loadPulseStrip() {
  const [p, n] = await Promise.all([fetchJSON(["/api/pulse"]), fetchJSON(["/api/news"])]);
  if (p) $("pulseStrip").innerHTML = p.tickers.map((t) => `<a href="/haberler.html" title="${esc(t.label)}"><span>${esc(t.label)}</span><b>${t.unit === "%" ? t.price.toFixed(2) + "%" : t.price >= 1000 ? t.price.toLocaleString("en-US", { maximumFractionDigits: 0 }) : t.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}</b><span class="${t.change >= 0 ? "pos" : "neg"}">${t.change >= 0 ? "▲" : "▼"}${Math.abs(t.change * 100).toFixed(2)}%</span></a>`).join("") +
    (p.fearGreed ? `<a href="/haberler.html"><span>Kripto korku/açgözlülük</span><b>${p.fearGreed.value}</b><span>${esc(p.fearGreed.label)}</span></a>` : "");
  else $("pulseStrip").innerHTML = `<span class="note">Piyasa verisi alınamadı.</span>`;
  if (n) $("topNews").innerHTML = n.items.filter((x) => x.highImpact.length || x.alsoIn.length).slice(0, 5).map((x) => `<a href="${/^https?:\/\//i.test(x.link) ? esc(x.link) : "#"}" target="_blank" rel="noopener noreferrer"><span class="sw" style="background:${x.highImpact.length ? "var(--down)" : "var(--warn)"}"></span><span>${esc(x.title)}</span><small>${esc(x.source)}</small></a>`).join("");
}

// ------------------------------------------------------------------ başlatma
function renderEverything() {
  renderFreshness();
  if (AL) { renderSignalBox(); renderStratTabs(); renderAllocation(); }
  if (BT) {
    if (!BT.periods.some((p) => p.key === period)) period = "long";
    renderStrategyCards();
    renderPeriodChips();
    setPeriod(period);
  }
}

(async () => {
  $("alList").innerHTML = `<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>`;
  reveal();
  const health = await fetchJSON(["/api/health"]);
  [AL, BT] = await Promise.all([fetchJSON(["/api/allocation", "/out/allocation.json"]), fetchJSON(["/api/backtest", "/out/backtest.json"])]);
  if (!health) {
    $("staleBanner").innerHTML = `<div class="banner"><b>Panel sunucusu eski sürüm çalışıyor ya da kapalı.</b> Terminalde çalışan <code>npm run web</code>'i <b>Ctrl+C</b> ile durdurup yeniden başlatın. Yeni sürüm kod değişince kendini otomatik yeniden başlatır; bu uyarı bir daha çıkmaz.</div>`;
  }
  if (BT && !BT.strategies) {
    // Eski out/backtest.json: stratejiler alanı yok — yerleşik tanımlarla göster, boş sayfa bırakma
    const ok = BT.periods?.every((p) => ORDER.every((k) => p.results?.[k]));
    if (ok) BT.strategies = FALLBACK_STRATEGIES;
    else BT = null;
  }
  if (!AL) $("alList").innerHTML = `<div class="callout warn">Dağılım alınamadı — <code>npm run web</code> ile sunucuyu başlatın.</div>`;
  else initAllocationControls();
  if (BT) initProjectionControls();
  document.querySelectorAll("#chartTabs button").forEach((b) => (b.onclick = () => { chartView = b.dataset.v; store.set("panel.chartView", chartView); renderPerfChart(); }));
  $("refreshAll").onclick = refreshAll;
  renderEverything();

  const assets = { SPY: "S&P 500", QQQ: "Nasdaq 100", GLD: "Altın", BIST: "BIST 100 (USD)", BTC: "Bitcoin", ETH: "Ethereum", DBC: "Emtia" };
  const a = $("asset");
  a.innerHTML = Object.entries(assets).map(([k, v]) => `<option value="${k}" ${k === "BTC" ? "selected" : ""}>${v}</option>`).join("");
  a.onchange = renderCandles;
  $("strategy").onchange = renderCandles;
  let candlesDone = false;
  $("candles").closest("details").addEventListener("toggle", (e) => {
    if (e.target.open && !candlesDone) { candlesDone = true; renderCandles().catch((err) => ($("stats").textContent = err.message)); }
  });
  loadPulseStrip();
  const s = await fetch("/out/SINYAL.md").catch(() => null);
  $("signals").innerHTML = s && s.ok ? md(await s.text()) : "Sinyal raporu yok — <code>npm run sinyal</code> çalıştırın.";
})();
