/* global LightweightCharts */
const LC = window.LightweightCharts;
const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const usd = (x, d = 0) => (Number.isFinite(x) ? (x < 0 ? "−$" : "$") + Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");
const signed = (x, d = 0) => (Number.isFinite(x) ? `${x >= 0 ? "+" : "−"}$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}` : "—");
const pct = (x, d = 1) => (Number.isFinite(x) ? `${x >= 0 ? "+" : "−"}%${Math.abs(x * 100).toFixed(d)}` : "—");
const pctPlain = (x, d = 1) => (Number.isFinite(x) ? `%${(x * 100).toFixed(d)}` : "—");
const cls = (x) => (x > 0.00001 ? "pos" : x < -0.00001 ? "neg" : "");
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const qtyFmt = (q) => (q >= 100 ? q.toLocaleString("en-US", { maximumFractionDigits: 2 }) : q >= 1 ? q.toLocaleString("en-US", { maximumFractionDigits: 4 }) : q.toLocaleString("en-US", { maximumSignificantDigits: 4 }));
const priceFmt = (p) => usd(p, p < 10 ? 4 : 2);
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* */ } } };
const COLORS = { SPY: "--s1", QQQ: "--s7", GLD: "--s4", BIST: "--s8", BTC: "--s2", ETH: "--s5", DBC: "--s3", SWING: "--s6", NAKIT: "--s9" };
const NAMES = { SPY: "S&P 500", QQQ: "Nasdaq 100", GLD: "Altın (XAU)", BIST: "BIST 100 (USD)", BTC: "Bitcoin", ETH: "Ethereum", DBC: "Emtia sepeti", SWING: "Swing kasası (USDT)", NAKIT: "Nakit / fırsat kasası" };
const color = (k) => css(COLORS[k] || "--muted");

let PF;
let AL;
let side = "buy";
let lastAdded = new Set();

let toastTimer;
function toast(html, ms = 4000) { const t = $("toast"); t.innerHTML = html; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), ms); }

function countUp(el, to, fmt) {
  const from = Number(el.dataset.v || 0);
  el.dataset.v = String(to);
  if (REDUCED) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (t) => { const k = Math.min(1, (t - t0) / 700); el.textContent = fmt(from + (to - from) * (1 - (1 - k) ** 3)); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

function reveal() {
  const els = document.querySelectorAll(".reveal:not(.in)");
  if (REDUCED || !("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -40px 0px" });
  els.forEach((e) => io.observe(e));
}

async function api(path, opts) {
  const r = await fetch(path, { cache: "no-store", ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// ------------------------------------------------------------------ özet
function renderKpis() {
  const t = PF.valuation.totals;
  const items = [
    ["Toplam değer", t.value, (x) => usd(x), "", `${PF.valuation.positions.length} kalem`],
    ["Yatırılan (maliyet)", t.costBasis, (x) => usd(x), "", `${t.txCount} işlem`],
    ["Kâr / zarar", t.pnl, (x) => signed(x), cls(t.pnl), pct(t.pnlPct)],
    ["Gerçekleşen kâr", t.realized, (x) => signed(x), cls(t.realized), "satışlardan"],
  ];
  $("kpis").innerHTML = items.map(([k, , , c, sub], i) => `<div class="pf-kpi"><small>${k}</small><b class="${c}" id="k${i}">$0</b><span class="${i === 2 ? c : "note"}">${sub}</span></div>`).join("");
  items.forEach(([, v, f], i) => countUp($(`k${i}`), v, f));
  const times = Object.values(PF.quotes).map((q) => q.time).filter(Boolean).sort();
  const last = times.pop();
  const pill = $("freshness");
  pill.className = "pill ok";
  pill.querySelector("span").textContent = last ? `Fiyatlar: ${new Date(last).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" })}` : "Fiyat yok";
}

// ------------------------------------------------------------------ grafik
let chart;
function renderChart() {
  const el = $("pfChart");
  if (chart) chart.remove();
  const h = PF.history;
  if (!h.length) { el.innerHTML = `<div class="callout" style="margin-top:40px">Henüz işlem yok. Aşağıdan ilk alımınızı ekleyin ya da Panel'de "Bu ayı portföye kaydet"e basın.</div>`; $("pfLegend").innerHTML = ""; return; }
  el.innerHTML = "";
  if (!LC) { el.innerHTML = `<div class="callout warn">Grafik kütüphanesi yüklenemedi (internet bağlantısını kontrol edin). Tablolar çalışmaya devam eder.</div>`; return; }
  chart = LC.createChart(el, {
    autoSize: true,
    layout: { background: { color: "transparent" }, textColor: css("--muted"), fontSize: 12, attributionLogo: false },
    grid: { vertLines: { visible: false }, horzLines: { color: css("--line2") } },
    rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false },
    localization: { priceFormatter: (x) => usd(x) },
    handleScroll: { mouseWheel: false }, handleScale: { mouseWheel: false },
  });
  const up = PF.valuation.totals.pnl >= 0;
  const c = up ? css("--up") : css("--down");
  const val = chart.addSeries(LC.AreaSeries, { lineColor: c, topColor: c + "40", bottomColor: c + "05", lineWidth: 2, priceLineVisible: false });
  val.setData(h.map((p) => ({ time: p.month + "-01", value: p.value })));
  const inv = chart.addSeries(LC.LineSeries, { color: css("--muted"), lineStyle: 2, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  inv.setData(h.map((p) => ({ time: p.month + "-01", value: p.invested })));
  chart.timeScale().fitContent();
  $("pfLegend").innerHTML = `<span class="li"><span class="sw" style="background:${c}"></span>Portföy değeri</span><span class="li"><span class="sw" style="background:var(--muted)"></span>Yatırılan</span>`;
}

// ------------------------------------------------------------------ pozisyonlar
function targetWeights() {
  const k = $("target").value;
  return AL && AL.strategies[k] ? AL.strategies[k].weights : null;
}

function renderPositions() {
  const pos = PF.valuation.positions;
  const tw = targetWeights();
  if (!pos.length) { $("positions").innerHTML = `<p class="note">Pozisyon yok.</p>`; $("bars").innerHTML = ""; return; }
  const head = `<tr><th>Varlık</th><th>Miktar</th><th>Ort. maliyet</th><th>Güncel fiyat</th><th>Maliyet</th><th>Değer</th><th>Kâr / zarar</th><th>Pay</th>${tw ? "<th>Hedef</th><th>Sapma</th>" : ""}</tr>`;
  const rows = pos.map((p) => {
    const t = tw ? tw[p.asset] || 0 : 0;
    const drift = p.weight - t;
    return `<tr><td><span class="sw" style="background:${color(p.asset)}"></span> <b>${esc(NAMES[p.asset] || p.name)}</b>${p.priceLabel ? `<br><small>${esc(p.priceLabel)}</small>` : ""}</td>
      <td>${qtyFmt(p.quantity)} <small>${esc(p.unit)}</small></td>
      <td>${priceFmt(p.avgCost)}</td>
      <td>${priceFmt(p.price)}</td>
      <td>${usd(p.costBasis, 2)}</td>
      <td><b>${usd(p.value, 2)}</b></td>
      <td class="${cls(p.pnl)}"><b>${signed(p.pnl, 2)}</b><br><small class="${cls(p.pnl)}">${pct(p.pnlPct, 2)}</small></td>
      <td>${pctPlain(p.weight)}</td>
      ${tw ? `<td>${pctPlain(t)}</td><td class="${Math.abs(drift) > 0.03 ? (drift > 0 ? "neg" : "pos") : ""}">${drift >= 0 ? "+" : "−"}${Math.abs(drift * 100).toFixed(1)} puan</td>` : ""}</tr>`;
  }).join("");
  const t = PF.valuation.totals;
  const foot = `<tr><th>Toplam</th><th></th><th></th><th></th><th>${usd(t.costBasis, 2)}</th><th>${usd(t.value, 2)}</th><th class="${cls(t.pnl)}">${signed(t.pnl, 2)} <small>${pct(t.pnlPct, 2)}</small></th><th>%100</th>${tw ? "<th></th><th></th>" : ""}</tr>`;
  $("positions").innerHTML = `<table>${head}${rows}${foot}</table>`;

  // Mevcut pay ile hedef pay çubukları
  const keys = [...new Set([...pos.map((p) => p.asset), ...(tw ? Object.keys(tw).filter((k) => tw[k] > 0) : [])])];
  const w = Object.fromEntries(pos.map((p) => [p.asset, p.weight]));
  const max = Math.max(...keys.map((k) => Math.max(w[k] || 0, tw?.[k] || 0)), 0.01);
  $("bars").innerHTML = `<h3 style="margin:8px 0 4px">Dağılım: mevcut ${tw ? "↔ hedef (siyah çizgi)" : ""}</h3>` + keys.sort((a, b) => (w[b] || 0) - (w[a] || 0)).map((k) => `
    <div class="pf-bar"><span><span class="sw" style="background:${color(k)}"></span> ${esc(NAMES[k])}</span>
      <div class="tr"><i data-w="${((w[k] || 0) / max) * 100}" style="background:${color(k)}"></i>${tw ? `<em style="left:calc(${((tw[k] || 0) / max) * 100}% - 1px)"></em>` : ""}</div>
      <span class="dv">${pctPlain(w[k] || 0)}${tw ? ` <small>/ ${pctPlain(tw[k] || 0)}</small>` : ""}</span></div>`).join("");
  requestAnimationFrame(() => document.querySelectorAll(".pf-bar .tr i").forEach((i) => (i.style.width = i.dataset.w + "%")));
}

// ------------------------------------------------------------------ işlemler
function renderTxs() {
  const txs = PF.transactions;
  $("txLead").textContent = txs.length ? `${txs.length} işlem · yalnızca bu cihazın tarayıcısında saklanır; başka cihazlar ve panelin diğer kullanıcıları göremez. Yedek için Dışa aktar.` : "Henüz işlem yok.";
  if (!txs.length) { $("txs").innerHTML = ""; return; }
  const q = PF.quotes;
  const rows = txs.map((t) => {
    const cash = t.asset === "SWING" || t.asset === "NAKIT";
    const now = cash ? t.usd : (q[t.asset]?.price ?? t.price) * t.quantity;
    const pnl = t.side === "buy" ? now - t.usd : NaN;
    return `<tr class="${lastAdded.has(t.id) ? "flash" : ""}"><td>${t.date}</td><td><span class="sw" style="background:${color(t.asset)}"></span> ${esc(NAMES[t.asset])}</td>
      <td><span class="badge ${t.side === "buy" ? "on" : "off"}">${t.side === "buy" ? "Alış" : "Satış"}</span></td>
      <td>${usd(t.usd, 2)}</td><td>${cash ? "—" : priceFmt(t.price)}</td><td>${cash ? "—" : qtyFmt(t.quantity)}</td>
      <td>${t.side === "buy" ? usd(now, 2) : "—"}</td><td class="${cls(pnl)}">${Number.isFinite(pnl) ? `${signed(pnl, 2)} <small>${pct(pnl / t.usd, 1)}</small>` : "—"}</td>
      <td style="text-align:left;white-space:normal;max-width:220px"><small>${esc(t.note || t.strategy || "")}</small></td>
      <td><button class="icon-btn" data-id="${t.id}" aria-label="İşlemi sil" title="Sil">✕</button></td></tr>`;
  }).join("");
  $("txs").innerHTML = `<table><tr><th>Tarih</th><th>Varlık</th><th>İşlem</th><th>Tutar</th><th>Fiyat</th><th>Miktar</th><th>Bugünkü değer</th><th>Kâr / zarar</th><th style="text-align:left">Not</th><th></th></tr>${rows}</table>`;
  document.querySelectorAll("#txs .icon-btn").forEach((b) => (b.onclick = async () => {
    if (!confirm("Bu işlem silinsin mi?")) return;
    try { PF = await PfStore.sync({ transactions: PfStore.load().filter((t) => t.id !== b.dataset.id) }); renderAll(); toast("İşlem silindi."); }
    catch (e) { toast(`Silinemedi: ${esc(e.message)}`); }
  }));
  lastAdded = new Set();
}

function renderAll() { renderKpis(); renderChart(); renderPositions(); renderTxs(); updatePreview(); }

// ------------------------------------------------------------------ form
async function fillPrice() {
  const a = $("fAsset").value;
  const cash = a === "SWING" || a === "NAKIT";
  const q = PF?.quotes?.[a];
  const d = $("fDate").value;
  let price = q?.price;
  if (!cash && d && d < new Date().toISOString().slice(0, 10)) {
    // Geçmiş tarih: o günün kapanış fiyatı
    try { const r = await api(`/api/price?asset=${a}&date=${d}`); if (r.price) price = r.price; } catch { /* anlık fiyatla devam */ }
  }
  $("fPrice").value = cash ? 1 : price ? +price.toPrecision(8) : "";
  $("fPrice").disabled = cash;
  $("fQty").disabled = cash;
  $("fUnit").textContent = cash ? "(nakit)" : q ? `/ ${q.unit}` : "";
  updatePreview();
}

function updatePreview() {
  const a = $("fAsset").value;
  const price = Number($("fPrice").value);
  const usdIn = Number($("fUsd").value);
  const qty = Number($("fQty").value);
  const unit = PF?.quotes?.[a]?.unit || "";
  let txt = "";
  if (price > 0 && usdIn > 0 && !(qty > 0)) txt = `${usd(usdIn, 2)} ÷ ${priceFmt(price)} = <b>${qtyFmt(usdIn / price)} ${esc(unit)}</b>`;
  else if (price > 0 && qty > 0) txt = `${qtyFmt(qty)} ${esc(unit)} × ${priceFmt(price)} = <b>${usd(qty * price, 2)}</b>`;
  $("fPreview").innerHTML = txt ? `${side === "buy" ? "Alış" : "Satış"}: ${txt}` : "";
}

function initForm() {
  $("fDate").value = new Date().toISOString().slice(0, 10);
  $("fAsset").innerHTML = Object.entries(NAMES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  $("fAsset").value = store.get("pf.lastAsset") || "GLD";
  $("fAsset").onchange = () => { store.set("pf.lastAsset", $("fAsset").value); fillPrice(); };
  $("fDate").onchange = fillPrice;
  for (const id of ["fUsd", "fQty", "fPrice"]) $(id).oninput = updatePreview;
  $("fUsd").addEventListener("input", () => { if ($("fUsd").value) $("fQty").value = ""; });
  $("fQty").addEventListener("input", () => { if ($("fQty").value) $("fUsd").value = ""; });
  document.querySelectorAll("#fSide button").forEach((b) => (b.onclick = () => {
    side = b.dataset.v;
    document.querySelectorAll("#fSide button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    updatePreview();
  }));
  $("txForm").onsubmit = async (e) => {
    e.preventDefault();
    const body = { date: $("fDate").value, asset: $("fAsset").value, side, usd: Number($("fUsd").value) || undefined, quantity: Number($("fQty").value) || undefined, price: Number($("fPrice").value) || undefined, note: $("fNote").value || undefined };
    try {
      const before = new Set(PF.transactions.map((t) => t.id));
      PF = await PfStore.sync({ add: [body] });
      lastAdded = new Set(PF.transactions.filter((t) => !before.has(t.id)).map((t) => t.id));
      $("fUsd").value = ""; $("fQty").value = ""; $("fNote").value = "";
      renderAll(); fillPrice();
      toast("İşlem kaydedildi.");
    } catch (err) { toast(`Kaydedilemedi: ${esc(err.message)}`); }
  };
  $("exportBtn").onclick = () => {
    const blob = new Blob([JSON.stringify({ version: 1, transactions: PF.transactions.slice().reverse() }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `portfoy-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $("importFile").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const list = (j.transactions || []).map((t) => ({ date: t.date, asset: t.asset, side: t.side, quantity: t.quantity, price: t.price, note: t.note, strategy: t.strategy }));
      if (!list.length) throw new Error("Dosyada işlem yok");
      if (!confirm(`${list.length} işlem mevcut portföye eklensin mi?`)) return;
      PF = await PfStore.sync({ add: list });
      renderAll();
      toast(`${list.length} işlem eklendi.`);
    } catch (err) { toast(`İçe aktarılamadı: ${esc(err.message)}`); }
    e.target.value = "";
  };
}

(async () => {
  reveal();
  try {
    const h = await api("/api/health");
    if (!h.features?.includes("portfolio-local")) throw new Error("eski");
  } catch {
    $("staleBanner").innerHTML = `<div class="banner"><b>Panel sunucusuna ulaşılamadı ya da eski sürüm çalışıyor.</b> Terminalde çalışan <code>npm run web</code>'i <b>Ctrl+C</b> ile durdurup yeniden başlatın. Yeni sürüm, kod değişince kendini otomatik yeniden başlatır.</div>`;
    return;
  }
  await PfStore.migrate();
  [PF, AL] = await Promise.all([PfStore.sync(), api("/api/allocation").catch(() => null)]);
  const sel = $("target");
  sel.innerHTML = `<option value="">Hedef yok</option>` + (AL ? ["static", "hybrid", "main"].map((k) => `<option value="${k}">${AL.strategies[k].name}</option>`).join("") : "");
  sel.value = store.get("panel.alStrategy") || "static";
  sel.onchange = renderPositions;
  initForm();
  renderAll();
  fillPrice();
  $("refreshPrices").onclick = async () => {
    const b = $("refreshPrices");
    b.disabled = true; b.classList.add("loading");
    try { PF = await PfStore.sync({ refresh: true }); renderAll(); fillPrice(); toast("Fiyatlar güncellendi."); }
    catch (e) { toast(`Güncellenemedi: ${esc(e.message)}`); }
    finally { b.disabled = false; b.classList.remove("loading"); }
  };
})();
