const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* */ } } };
const TZ = -new Date().getTimezoneOffset() * 60;
/** Kaldıraç kademesi renkleri (10x, 25x, 50x, 100x) */
const TIER_VARS = ["--s1", "--s3", "--s4", "--s2"];

let asset = store.get("liq.asset") || "BTC";
let range = store.get("liq.range") || "7d";
let zoom = Number(store.get("liq.zoom")) || 0.1;
let D;
let loading = false;
let oiChart;

let toastTimer;
function toast(html, ms = 4000) { const t = $("toast"); t.innerHTML = html; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), ms); }

function reveal() {
  const els = document.querySelectorAll(".reveal:not(.in)");
  if (REDUCED || !("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -40px 0px" });
  els.forEach((e) => io.observe(e));
}

async function api(path) {
  const r = await fetch(path, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

const usd = (x) => {
  const a = Math.abs(x);
  if (a >= 1e9) return `$${(x / 1e9).toFixed(2)} mr`;
  if (a >= 1e6) return `$${(x / 1e6).toFixed(a >= 1e8 ? 0 : 1)} mn`;
  if (a >= 1e3) return `$${(x / 1e3).toFixed(0)} bin`;
  return `$${x.toFixed(0)}`;
};
const px = (x) => (x >= 1000 ? x.toLocaleString("tr-TR", { maximumFractionDigits: 0 }) : x.toLocaleString("tr-TR", { maximumFractionDigits: 2 }));
const pct = (x, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? "+" : "−"}%${Math.abs(x * 100).toFixed(d)}` : "—");
const cls = (x) => (x > 0 ? "pos" : x < 0 ? "neg" : "");
const fmtTime = (t, withDay = true) => new Date(t).toLocaleString("tr-TR", withDay ? { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" });

// ------------------------------------------------------------------ renk skalası (ısı haritası)
const STOPS = [
  [0, [12, 6, 38]],
  [0.18, [52, 16, 110]],
  [0.38, [33, 86, 160]],
  [0.58, [24, 158, 140]],
  [0.78, [122, 209, 81]],
  [1, [253, 231, 37]],
];
function heatColor(t) {
  t = Math.min(1, Math.max(0, t));
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, a] = STOPS[i - 1], [t1, b] = STOPS[i];
      const f = (t - t0) / (t1 - t0);
      return a.map((v, k) => Math.round(v + (b[k] - v) * f));
    }
  }
  return STOPS[STOPS.length - 1][1];
}

/** Canvas'ı kapsayıcısına DPR ile oturtur; çizim alanı boyutunu döner. */
function fitCanvas(canvas) {
  const r = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  canvas.style.width = `${r.width}px`;
  canvas.style.height = `${r.height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: r.width, h: r.height };
}

function niceTicks(lo, hi, n) {
  const span = hi - lo;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

// ------------------------------------------------------------------ ısı haritası
const heatState = {};
function drawHeat() {
  if (!D) return;
  const canvas = $("heat");
  const { ctx, w, h } = fitCanvas(canvas);
  const pad = { l: 8, r: 74, t: 10, b: 26 };
  const W = w - pad.l - pad.r, H = h - pad.t - pad.b;
  const { heat, candles, times } = D;
  const n = candles.length;
  // Görünen fiyat aralığı: mum aralığı ±%6 (ısı ekseni ±%12'ye kadar uzanır)
  const lowAll = Math.min(...candles.map((c) => c[2])), highAll = Math.max(...candles.map((c) => c[1]));
  const ylo = Math.max(heat.lo, lowAll * 0.94), yhi = Math.min(heat.hi, highAll * 1.06);
  const step = (heat.hi - heat.lo) / heat.n;
  const b0 = Math.max(0, Math.floor((ylo - heat.lo) / step)), b1 = Math.min(heat.n, Math.ceil((yhi - heat.lo) / step));
  const vlo = heat.lo + b0 * step, vhi = heat.lo + b1 * step;
  const y = (p) => pad.t + H - ((p - vlo) / (vhi - vlo)) * H;
  const x = (i) => pad.l + ((i + 0.5) / n) * W;

  // Normalizasyon: sıfır olmayan hücrelerin %99'luk dilimi
  const vals = [];
  for (const r of heat.rows) for (let k = b0; k < b1; k++) if (r[k] > 0) vals.push(r[k]);
  vals.sort((a, b) => a - b);
  const gain = Number($("gain").value);
  const cap = (vals[Math.floor(vals.length * 0.99)] || 1) / gain;

  ctx.fillStyle = "#0a0716";
  ctx.fillRect(pad.l, pad.t, W, H);
  // Hücreleri küçük bir görüntüye yaz, sonra yumuşatarak ölçekle
  const bins = b1 - b0;
  const off = document.createElement("canvas");
  off.width = n; off.height = bins;
  const octx = off.getContext("2d");
  const img = octx.createImageData(n, bins);
  for (let i = 0; i < n; i++) {
    const row = heat.rows[i];
    for (let k = 0; k < bins; k++) {
      const v = row[b0 + k];
      const o = ((bins - 1 - k) * n + i) * 4;
      if (v <= 0) { img.data[o + 3] = 0; continue; }
      const t = Math.min(1, v / cap) ** 0.55;
      const c = heatColor(t);
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = Math.round(255 * Math.min(1, 0.25 + t));
    }
  }
  octx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(off, 0, 0, n, bins, pad.l, pad.t, W, H);

  // Mumlar
  const bw = Math.max(1, (W / n) * 0.62);
  for (let i = 0; i < n; i++) {
    const [o, hi, lo, c] = candles[i];
    const up = c >= o;
    ctx.strokeStyle = ctx.fillStyle = up ? "rgba(236,240,245,.92)" : "rgba(255,92,92,.95)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x(i), y(hi)); ctx.lineTo(x(i), y(lo)); ctx.stroke();
    const top = y(Math.max(o, c)), bh = Math.max(1, Math.abs(y(o) - y(c)));
    if (up) { ctx.fillStyle = "rgba(10,7,22,.9)"; ctx.fillRect(x(i) - bw / 2, top, bw, bh); ctx.strokeRect(x(i) - bw / 2, top, bw, bh); }
    else ctx.fillRect(x(i) - bw / 2, top, bw, bh);
  }

  // Gerçekleşen likidasyonlar: bar × %0,2 fiyat kutusunda topla
  if ($("showRealized").checked && D.realized.length) {
    const t0 = times[0], dt = times[1] - times[0];
    const agg = new Map();
    for (const r of D.realized) {
      const i = Math.min(n - 1, Math.floor((r.ts - t0) / dt));
      if (i < 0) continue;
      const k = `${i}|${Math.round(r.price / (D.price * 0.002))}|${r.side}`;
      const e = agg.get(k) ?? { i, price: 0, usd: 0, side: r.side };
      e.price = (e.price * e.usd + r.price * r.usd) / (e.usd + r.usd || 1);
      e.usd += r.usd;
      agg.set(k, e);
    }
    const maxU = Math.max(...[...agg.values()].map((e) => e.usd));
    for (const e of agg.values()) {
      if (e.usd < maxU * 0.01) continue;
      const rad = 2 + 12 * Math.sqrt(e.usd / maxU);
      ctx.beginPath();
      ctx.arc(x(e.i), y(e.price), rad, 0, Math.PI * 2);
      ctx.fillStyle = e.side === "long" ? "rgba(255,80,80,.35)" : "rgba(60,220,120,.35)";
      ctx.strokeStyle = e.side === "long" ? "rgba(255,120,120,.9)" : "rgba(90,240,150,.9)";
      ctx.fill(); ctx.stroke();
    }
  }

  // Güncel fiyat çizgisi
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "rgba(255,255,255,.75)";
  ctx.beginPath(); ctx.moveTo(pad.l, y(D.price)); ctx.lineTo(pad.l + W, y(D.price)); ctx.stroke();
  ctx.setLineDash([]);

  // Eksenler
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillStyle = css("--muted");
  ctx.textBaseline = "middle";
  for (const v of niceTicks(vlo, vhi, 8)) {
    ctx.fillText(px(v), pad.l + W + 6, y(v));
    ctx.fillStyle = "rgba(255,255,255,.06)"; ctx.fillRect(pad.l, Math.round(y(v)), W, 1); ctx.fillStyle = css("--muted");
  }
  ctx.fillStyle = "#fff";
  const ly = y(D.price);
  ctx.fillRect(pad.l + W + 2, ly - 9, pad.r - 4, 18);
  ctx.fillStyle = "#0a0716"; ctx.font = "600 11px system-ui, sans-serif";
  ctx.fillText(px(D.price), pad.l + W + 6, ly);
  ctx.font = "11px system-ui, sans-serif"; ctx.fillStyle = css("--muted"); ctx.textBaseline = "top";
  const labels = Math.max(2, Math.floor(W / 110));
  for (let j = 0; j <= labels; j++) {
    const i = Math.round((j / labels) * (n - 1));
    const s = fmtTime(times[i]);
    const tw = ctx.measureText(s).width;
    ctx.fillText(s, Math.min(pad.l + W - tw, Math.max(pad.l, x(i) - tw / 2)), pad.t + H + 7);
  }
  Object.assign(heatState, { pad, W, H, n, vlo, vhi, step, cap });
  $("heatMax").textContent = `en parlak ≈ ${usd(cap * 1000)} / kutu (${px(step)} $ aralık)`;
}

function heatHover(ev) {
  if (!D || !heatState.W) return;
  const r = $("heat").getBoundingClientRect();
  const mx = ev.clientX - r.left, my = ev.clientY - r.top;
  const { pad, W, H, n, vlo, vhi, step } = heatState;
  const tip = $("heatTip");
  if (mx < pad.l || mx > pad.l + W || my < pad.t || my > pad.t + H) { tip.hidden = true; return; }
  const i = Math.min(n - 1, Math.floor(((mx - pad.l) / W) * n));
  const p = vlo + ((pad.t + H - my) / H) * (vhi - vlo);
  const k = Math.floor((p - D.heat.lo) / step);
  const v = (D.heat.rows[i]?.[k] ?? 0) * 1000;
  const [o, hi, lo, c] = D.candles[i];
  const trig = D.triggered[i];
  tip.innerHTML = `<b>${fmtTime(D.times[i])}</b><br>Fiyat seviyesi: <b>${px(p)}</b><br>Bekleyen likidasyon: <b>${usd(v)}</b><br><small>A ${px(o)} · Y ${px(hi)} · D ${px(lo)} · K ${px(c)}</small>${trig.long + trig.short > 0 ? `<br><small>Model tasfiyesi: long ${usd(trig.long)} · short ${usd(trig.short)}</small>` : ""}`;
  tip.hidden = false;
  placeTip(tip, mx, my, r.width);
}

function placeTip(tip, mx, my, width) {
  const tw = tip.offsetWidth;
  tip.style.left = `${mx + 14 + tw > width ? mx - tw - 14 : mx + 14}px`;
  tip.style.top = `${Math.max(0, my - 10)}px`;
}

// ------------------------------------------------------------------ LiqMap
const mapState = {};
function drawMap() {
  if (!D) return;
  const canvas = $("map");
  const { ctx, w, h } = fitCanvas(canvas);
  const pad = { l: 64, r: 64, t: 12, b: 28 };
  const W = w - pad.l - pad.r, H = h - pad.t - pad.b;
  const m = D.liqMap;
  const mstep = (m.hi - m.lo) / m.n;
  const plo = D.price * (1 - zoom), phi = D.price * (1 + zoom);
  const k0 = Math.max(0, Math.floor((plo - m.lo) / mstep)), k1 = Math.min(m.n, Math.ceil((phi - m.lo) / mstep));
  const x = (p) => pad.l + ((p - plo) / (phi - plo)) * W;
  // Kutu toplamları ve kümülatifler
  const tot = [];
  for (let k = 0; k < m.n; k++) tot.push(m.long.reduce((s, r) => s + r[k], 0) + m.short.reduce((s, r) => s + r[k], 0));
  const maxBar = Math.max(1, ...tot.slice(k0, k1));
  const pk = Math.floor((D.price - m.lo) / mstep);
  const cumL = new Array(m.n).fill(0), cumS = new Array(m.n).fill(0);
  for (let k = pk, s = 0; k >= 0; k--) { s += m.long.reduce((a, r) => a + r[k], 0); cumL[k] = s; }
  for (let k = pk, s = 0; k < m.n; k++) { s += m.short.reduce((a, r) => a + r[k], 0); cumS[k] = s; }
  const maxCum = Math.max(1, cumL[k0] ?? 0, cumS[k1 - 1] ?? 0);
  const yb = (v) => pad.t + H - (v / maxBar) * H;
  const yc = (v) => pad.t + H - (v / maxCum) * H;

  ctx.clearRect(0, 0, w, h);
  // Izgara
  ctx.font = "11px system-ui, sans-serif"; ctx.textBaseline = "middle";
  for (const v of niceTicks(0, maxBar, 4)) {
    ctx.fillStyle = css("--line2"); ctx.fillRect(pad.l, Math.round(yb(v)), W, 1);
    ctx.fillStyle = css("--muted"); ctx.textAlign = "right"; ctx.fillText(usd(v), pad.l - 6, yb(v));
  }
  for (const v of niceTicks(0, maxCum, 4)) { ctx.textAlign = "left"; ctx.fillText(usd(v), pad.l + W + 6, yc(v)); }
  // Çubuklar (kademe kademe yığılı)
  const colors = TIER_VARS.map(css);
  const bw = Math.max(1, (W / (k1 - k0)) * 0.82);
  for (let k = k0; k < k1; k++) {
    const pc = m.lo + (k + 0.5) * mstep;
    const isLong = pc < D.price;
    let acc = 0;
    for (let t = 0; t < D.tiers.length; t++) {
      const v = (isLong ? m.long : m.short)[t][k];
      if (!v) continue;
      ctx.fillStyle = colors[t];
      ctx.globalAlpha = isLong ? 0.95 : 0.8;
      ctx.fillRect(x(pc) - bw / 2, yb(acc + v), bw, yb(acc) - yb(acc + v));
      acc += v;
    }
  }
  ctx.globalAlpha = 1;
  // Kümülatif çizgiler
  const line = (from, to, arr, color) => {
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
    let first = true;
    for (let k = from; k !== to; k += from < to ? 1 : -1) {
      const xx = x(m.lo + (k + 0.5) * mstep), yy = yc(arr[k]);
      if (first) { ctx.moveTo(x(D.price), yc(0)); first = false; }
      ctx.lineTo(xx, yy);
    }
    ctx.stroke();
  };
  line(pk, k0 - 1, cumL, css("--down"));
  line(pk, k1, cumS, css("--up"));
  // Güncel fiyat
  ctx.setLineDash([4, 4]); ctx.strokeStyle = css("--ink"); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x(D.price), pad.t); ctx.lineTo(x(D.price), pad.t + H); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = css("--ink"); ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.font = "600 11px system-ui, sans-serif";
  ctx.fillText(px(D.price), x(D.price), pad.t + H + 8);
  ctx.font = "11px system-ui, sans-serif"; ctx.fillStyle = css("--muted");
  for (const v of niceTicks(plo, phi, Math.max(3, Math.floor(W / 120)))) {
    if (Math.abs(x(v) - x(D.price)) < 50) continue;
    ctx.fillText(px(v), x(v), pad.t + H + 8);
  }
  ctx.textAlign = "left";
  ctx.fillStyle = css("--down"); ctx.fillText("← long likidasyonları", pad.l + 4, pad.t);
  ctx.textAlign = "right"; ctx.fillStyle = css("--up"); ctx.fillText("short likidasyonları →", pad.l + W - 4, pad.t);
  ctx.textAlign = "left";
  Object.assign(mapState, { pad, W, H, plo, phi, mstep, cumL, cumS });
}

function mapHover(ev) {
  if (!D || !mapState.W) return;
  const r = $("map").getBoundingClientRect();
  const mx = ev.clientX - r.left, my = ev.clientY - r.top;
  const { pad, W, plo, phi, mstep, cumL, cumS } = mapState;
  const tip = $("mapTip");
  if (mx < pad.l || mx > pad.l + W) { tip.hidden = true; return; }
  const p = plo + ((mx - pad.l) / W) * (phi - plo);
  const m = D.liqMap;
  const k = Math.floor((p - m.lo) / mstep);
  if (k < 0 || k >= m.n) { tip.hidden = true; return; }
  const isLong = p < D.price;
  const arr = isLong ? m.long : m.short;
  const rows = D.tiers.map((lev, t) => arr[t][k] ? `<span class="sw" style="background:var(${TIER_VARS[t]})"></span> ${lev}x: ${usd(arr[t][k])}` : "").filter(Boolean);
  tip.innerHTML = `<b>${px(m.lo + k * mstep)} – ${px(m.lo + (k + 1) * mstep)}</b> <small>(${pct(p / D.price - 1, 1)})</small><br>${isLong ? "Long" : "Short"} likidasyon: <b>${usd(arr.reduce((s, r2) => s + r2[k], 0))}</b>${rows.length ? `<br><small>${rows.join("<br>")}</small>` : ""}<br><small>Fiyat buraya ${isLong ? "düşerse" : "çıkarsa"} toplam: <b>${usd((isLong ? cumL : cumS)[k])}</b></small>`;
  tip.hidden = false;
  placeTip(tip, mx, my, r.width);
}

// ------------------------------------------------------------------ OI grafiği
const REGIME_COLOR = { pos: "--up", neg: "--down", neutral: "--s9" };
function drawOi() {
  const el = $("oiChart");
  if (!window.LightweightCharts) { el.innerHTML = `<div class="callout warn">Grafik kütüphanesi yüklenemedi.</div>`; return; }
  const L = window.LightweightCharts;
  if (oiChart) { oiChart.remove(); oiChart = undefined; }
  oiChart = L.createChart(el, {
    autoSize: true,
    layout: { background: { color: "transparent" }, textColor: css("--muted"), fontSize: 11, panes: { separatorColor: css("--line"), enableResize: true } },
    grid: { vertLines: { color: css("--line2") }, horzLines: { color: css("--line2") } },
    rightPriceScale: { borderColor: css("--line") },
    timeScale: { borderColor: css("--line"), timeVisible: true, secondsVisible: false },
    handleScroll: { mouseWheel: false }, handleScale: { mouseWheel: false },
    crosshair: { mode: 0 },
  });
  const t = (i) => D.times[i] / 1000 + TZ;
  const candles = oiChart.addSeries(L.CandlestickSeries, { upColor: css("--up"), downColor: css("--down"), wickUpColor: css("--up"), wickDownColor: css("--down"), borderVisible: false, priceFormat: { type: "price", precision: D.price > 1000 ? 0 : 2, minMove: D.price > 1000 ? 1 : 0.01 } }, 0);
  candles.setData(D.candles.map((c, i) => ({ time: t(i), open: c[0], high: c[1], low: c[2], close: c[3] })));
  const oi = oiChart.addSeries(L.AreaSeries, { lineColor: css("--s7"), topColor: `${css("--s7")}55`, bottomColor: `${css("--s7")}05`, lineWidth: 2, priceFormat: { type: "custom", formatter: (v) => usd(v), minMove: 1 } }, 1);
  oi.setData(D.oiUsd.map((v, i) => ({ time: t(i), value: v })));
  const flow = oiChart.addSeries(L.HistogramSeries, { priceFormat: { type: "custom", formatter: (v) => `%${Math.round(v * 100)}`, minMove: 0.01 }, base: 0.5 }, 2);
  flow.setData(D.buyShare.map((v, i) => ({ time: t(i), value: v, color: v >= 0.5 ? `${css("--up")}aa` : `${css("--down")}aa` })));
  const reg = oiChart.addSeries(L.HistogramSeries, { priceFormat: { type: "custom", formatter: () => "" }, lastValueVisible: false, priceLineVisible: false }, 3);
  reg.setData(D.divergence.timeline.map((r, i) => ({ time: t(i), value: 1, color: css(REGIME_COLOR[D.regimeInfo[r].tone]) + (r === "notr" ? "44" : "dd") })));
  const panes = oiChart.panes();
  [5, 2.4, 1.2, 0.55].forEach((f, k) => panes[k]?.setStretchFactor?.(f));
  oiChart.timeScale().fitContent();
  oiChart.subscribeCrosshairMove((p) => {
    if (!p.time) { renderOiLegend(); return; }
    const i = D.times.findIndex((x) => x / 1000 + TZ === p.time);
    if (i >= 0) renderOiLegend(i);
  });
  renderOiLegend();
}

function renderOiLegend(i = D.times.length - 1) {
  const r = D.divergence.timeline[i], info = D.regimeInfo[r];
  const k24 = D.bar === "4H" ? 6 : 24;
  const doi = i >= k24 ? D.oiUsd[i] / D.oiUsd[i - k24] - 1 : NaN;
  $("oiLegend").innerHTML = `<span class="li"><b>${fmtTime(D.times[i])}</b></span>
    <span class="li"><span class="sw" style="background:var(--s7)"></span>OI ${usd(D.oiUsd[i])} <span class="${cls(doi)}">(24s ${pct(doi, 1)})</span></span>
    <span class="li"><span class="sw" style="background:var(--up)"></span>Taker alış payı %${Math.round(D.buyShare[i] * 100)}</span>
    <span class="li"><span class="sw" style="background:var(${REGIME_COLOR[info.tone]})"></span>Rejim: ${esc(info.label)}</span>
    <span class="li">Paneller: fiyat · OI (USD) · taker alış payı · 24s rejim şeridi</span>`;
}

// ------------------------------------------------------------------ özet / tablolar
function toneWord(tone) { return tone === "pos" ? "Pozitif" : tone === "neg" ? "Negatif" : "Nötr"; }
/** Ton rozeti + etiket; etiket rozetle aynıysa tekrarlamaz. */
function regimeTag(info) { return `<span class="lq-reg ${info.tone}">${toneWord(info.tone)}</span>${info.label === toneWord(info.tone) ? "" : ` ${esc(info.label)}`}`; }

function renderSummary() {
  const v = D.divergence.verdict, info = D.regimeInfo[v];
  const w24 = D.divergence.windows.find((w) => w.hours === 24) ?? D.divergence.windows[D.divergence.windows.length - 1];
  const below = D.clusters.filter((c) => c.side === "long").sort((a, b) => b.usd - a.usd)[0];
  const above = D.clusters.filter((c) => c.side === "short").sort((a, b) => b.usd - a.usd)[0];
  const bias = D.totals.shortUsd / Math.max(1, D.totals.longUsd + D.totals.shortUsd);
  $("verdict").innerHTML = `
    <div class="lq-badge ${info.tone}"><small>OI uyumsuzluğu (24 saat)</small><b>${toneWord(info.tone)}</b>${info.label === toneWord(info.tone) ? "" : `<span>${esc(info.label)}</span>`}</div>
    <div class="lq-vtext"><p>${esc(info.text)}</p>
      <p class="note">Son 24 saatte fiyat <b class="${cls(w24?.dp)}">${pct(w24?.dp)}</b>, open interest <b class="${cls(w24?.doi)}">${pct(w24?.doi)}</b>. ${bias > 0.58 ? "Haritada short likidasyonları ağır basıyor: yukarı yönlü bir sıçrama short squeeze'e dönüşebilir." : bias < 0.42 ? "Haritada long likidasyonları ağır basıyor: aşağı yönlü bir sarkma long tasfiye zincirine dönüşebilir." : "Long ve short likidasyonları dengeli."}</p></div>`;
  const k = (label, val, sub = "", c = "") => `<div class="lq-kpi"><small>${label}</small><b class="${c}">${val}</b>${sub ? `<span>${sub}</span>` : ""}</div>`;
  const fAnn = D.funding.annualized;
  $("kpis").innerHTML = [
    k(`${D.asset} fiyatı`, px(D.price), `OKX ${D.asset}-USDT-SWAP`),
    k("Open interest", usd(D.oiUsd[D.oiUsd.length - 1]), `24s ${pct(w24?.doi, 1)}`, ""),
    k("Fonlama", `%${(D.funding.current * 100).toFixed(4)}`, `yıllık ≈ ${pct(fAnn, 1)}`, fAnn > 0.3 ? "neg" : fAnn < 0 ? "pos" : ""),
    k("Long/short hesap oranı", D.longShortRatio ? D.longShortRatio.toFixed(2) : "—", D.longShortRatio ? `hesapların %${Math.round((D.longShortRatio / (1 + D.longShortRatio)) * 100)}'i long` : ""),
    below ? k("En büyük long kümesi", px(below.price), `${usd(below.usd)} · ${pct(below.distPct, 1)}`, "neg") : "",
    above ? k("En büyük short kümesi", px(above.price), `${usd(above.usd)} · ${pct(above.distPct, 1)}`, "pos") : "",
    k("Bekleyen likidasyon", usd(D.totals.longUsd + D.totals.shortUsd), `long ${usd(D.totals.longUsd)} · short ${usd(D.totals.shortUsd)}`),
    k(`Gerçekleşen (son ${D.realizedSummary.hours} sa)`, usd(D.realizedSummary.longUsd + D.realizedSummary.shortUsd), `long ${usd(D.realizedSummary.longUsd)} · short ${usd(D.realizedSummary.shortUsd)}`),
  ].join("");
}

function renderWindows() {
  const rows = D.divergence.windows.map((w) => {
    const info = D.regimeInfo[w.regime];
    return `<tr><td>${esc(w.label)}</td><td class="${cls(w.dp)}">${pct(w.dp)}</td><td class="${cls(w.doi)}">${pct(w.doi)}</td>
      <td>${regimeTag(info)}</td><td class="note">eşik: fiyat ±%${(w.tp * 100).toFixed(1)}, OI ±%${(w.toi * 100).toFixed(1)}</td></tr>`;
  }).join("");
  $("windows").innerHTML = `<table class="mini lq-table"><thead><tr><th>Pencere</th><th>Fiyat</th><th>Open interest</th><th>Okuma</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderClusters() {
  const max = Math.max(1, ...D.clusters.map((c) => c.usd));
  $("clusters").innerHTML = D.clusters.map((c) => `
    <div class="lq-cl ${c.side}"><span class="p">${px(c.price)}</span><span class="d ${c.side === "long" ? "neg" : "pos"}">${pct(c.distPct, 1)}</span>
      <span class="bar"><i style="width:${(c.usd / max) * 100}%"></i></span><b>${usd(c.usd)}</b><small>${c.side === "long" ? "long likidasyonu" : "short likidasyonu"}</small></div>`).join("") || `<p class="note">Bu aralıkta belirgin küme yok.</p>`;
  $("mapLegend").innerHTML = D.tiers.map((l, t) => `<span class="li"><span class="sw" style="background:var(${TIER_VARS[t]})"></span>${l}x</span>`).join("") +
    `<span class="li"><span class="sw" style="background:var(--down)"></span>Kümülatif long</span><span class="li"><span class="sw" style="background:var(--up)"></span>Kümülatif short</span>`;
}

function renderHowto() {
  const order = ["pozitif-short-birikimi", "pozitif-temizlik", "uyumlu-yukselis", "negatif-short-kapanisi", "asiri-long", "ayi-yeni-short", "sikisma", "notr"];
  $("howto").innerHTML = `<table class="mini lq-table"><thead><tr><th>Fiyat</th><th>OI</th><th>Okuma</th><th>Anlamı</th></tr></thead><tbody>${order.map((r) => {
    const i = D.regimeInfo[r];
    const map = { "uyumlu-yukselis": ["↑", "↑"], "asiri-long": ["↑", "↑ + yüksek fonlama"], "negatif-short-kapanisi": ["↑", "↓"], "ayi-yeni-short": ["↓", "↑ (fonlama ≥ 0)"], "pozitif-short-birikimi": ["↓", "↑ (fonlama < 0)"], "pozitif-temizlik": ["↓", "↓"], sikisma: ["→", "↑"], notr: ["—", "—"] }[r];
    return `<tr><td>${map[0]}</td><td>${map[1]}</td><td>${regimeTag(i)}</td><td>${esc(i.text)}</td></tr>`;
  }).join("")}</tbody></table>
  <p class="note">Pozitif uyumsuzluk yükseliş lehine (dip/sıçrama zemini), negatif uyumsuzluk düşüş lehine (zayıf yükseliş ya da kaldıraç riski) okunur. Isı haritasıyla birlikte kullanın: örneğin pozitif uyumsuzluk + yukarıda büyük short kümesi = short squeeze olasılığı.</p>`;
}

function renderAll() {
  renderSummary();
  renderWindows();
  renderClusters();
  renderHowto();
  drawHeat();
  drawMap();
  drawOi();
  $("notes").innerHTML = D.notes.map((n) => `<li>${esc(n)}</li>`).join("");
  document.title = `${D.asset} ${px(D.price)} · Likidasyon ve OI`;
}

async function load(force = false) {
  if (loading) return;
  loading = true;
  const b = $("refresh");
  b.disabled = true; b.classList.add("loading");
  const pill = $("freshness");
  try {
    D = await api(`/api/liq?asset=${asset}&range=${range}${force ? "&refresh=1" : ""}`);
    renderAll();
    pill.className = "pill ok";
    pill.querySelector("span").textContent = `OKX · ${new Date(D.generatedAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`;
    if (force) toast("Veriler OKX'ten yeniden alındı.");
  } catch (e) {
    pill.className = "pill warn";
    pill.querySelector("span").textContent = "Veri alınamadı";
    $("verdict").innerHTML = `<div class="callout warn">Likidasyon verisi alınamadı: ${esc(e.message)}</div>`;
  } finally { loading = false; b.disabled = false; b.classList.remove("loading"); }
}

function bindSeg(id, get, set) {
  const seg = $(id);
  const sync = () => seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.v === String(get()))));
  seg.querySelectorAll("button").forEach((x) => (x.onclick = () => { set(x.dataset.v); sync(); }));
  sync();
}

(async () => {
  reveal();
  const h = await api("/api/health").catch(() => null);
  if (!h?.features?.includes("liq")) {
    $("staleBanner").innerHTML = `<div class="banner"><b>Panel sunucusu eski sürüm çalışıyor ya da kapalı.</b> Terminalde <code>npm run web</code>'i <b>Ctrl+C</b> ile durdurup yeniden başlatın (ya da <code>baslat-windows.bat</code>'a çift tıklayın).</div>`;
    return;
  }
  bindSeg("assetSeg", () => asset, (v) => { asset = v; store.set("liq.asset", v); load(); });
  bindSeg("rangeSeg", () => range, (v) => { range = v; store.set("liq.range", v); load(); });
  bindSeg("zoomSeg", () => zoom, (v) => { zoom = Number(v); store.set("liq.zoom", v); drawMap(); });
  $("refresh").onclick = () => load(true);
  $("gain").oninput = drawHeat;
  $("showRealized").onchange = drawHeat;
  $("heat").addEventListener("mousemove", heatHover);
  $("heat").addEventListener("mouseleave", () => ($("heatTip").hidden = true));
  $("map").addEventListener("mousemove", mapHover);
  $("map").addEventListener("mouseleave", () => ($("mapTip").hidden = true));
  let rt;
  new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { drawHeat(); drawMap(); }, 80); }).observe($("heatWrap"));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => D && renderAll());
  $("heatScale").style.background = `linear-gradient(90deg, ${STOPS.map(([t, c]) => `rgb(${c.join(",")}) ${t * 100}%`).join(", ")})`;
  await load();
  setInterval(() => { if (document.visibilityState === "visible") load(); }, 5 * 60_000);
})();
