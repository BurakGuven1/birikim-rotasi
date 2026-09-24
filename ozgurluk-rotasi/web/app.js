/* global LightweightCharts */
const LC = LightweightCharts;
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const pct = (x, d = 1) => (Number.isFinite(x) ? (x * 100).toFixed(d) + "%" : "—");
const usd = (x) => (Number.isFinite(x) ? "$" + Math.round(x).toLocaleString("en-US") : "—");
const PALETTE = ["#8b949e", "#bf8700", "#8250df", "#0a7ea4", "#d1242f", "#57606a", "#1a7f37", "#e16f24", "#6e7781"];

function baseChart(el) {
  return LC.createChart(el, {
    autoSize: true,
    layout: { background: { color: "transparent" }, textColor: css("--muted") },
    grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } },
    rightPriceScale: { borderColor: css("--line") },
    timeScale: { borderColor: css("--line") },
  });
}

async function loadBacktest() {
  const res = await fetch("/out/backtest.json");
  if (!res.ok) throw new Error("out/backtest.json yok — `npm run backtest` çalıştırın");
  return res.json();
}

function renderKpis(bt) {
  const m = bt.periods[0].results.main.metrics;
  document.getElementById("meta").textContent = `Veri sonu ${bt.end} · hedef ${usd(bt.plan.targetWealth)} (bugünün doları)`;
  const items = [
    ["Reel IRR", pct(m.realIrr)], ["Reel CAGR", pct(m.realCagr)], ["Maks düşüş", pct(m.maxDrawdown)],
    ["Sharpe", m.sharpe.toFixed(2)], ["Yatırılan", usd(m.totalContributed)], ["Son değer", usd(m.finalValue)],
  ];
  document.getElementById("kpis").innerHTML = items.map(([k, v]) => `<div class="kpi"><span>${k}</span><b>${v}</b></div>`).join("");
}

let equityChart;
function renderEquity(bt, pIdx) {
  const el = document.getElementById("equity");
  if (equityChart) equityChart.remove();
  equityChart = baseChart(el);
  equityChart.priceScale("right").applyOptions({ mode: LC.PriceScaleMode.Logarithmic });
  const p = bt.periods[pIdx];
  const legend = [];
  bt.variants.forEach((v, k) => {
    const r = p.results[v.key];
    const color = v.key === "main" ? css("--accent") : PALETTE[k % PALETTE.length];
    const s = equityChart.addSeries(LC.LineSeries, { color, lineWidth: v.key === "main" ? 3 : 1.5, priceLineVisible: false, lastValueVisible: false });
    s.setData(r.months.map((m, i) => ({ time: m + "-01", value: r.value[i] })));
    legend.push(`<span><i style="background:${color}"></i>${v.name}</span>`);
  });
  const first = p.results.main;
  const c = equityChart.addSeries(LC.LineSeries, { color: css("--muted"), lineStyle: 2, lineWidth: 1, priceLineVisible: false });
  c.setData(first.months.map((m, i) => ({ time: m + "-01", value: first.contributed[i] })));
  legend.push(`<span><i style="background:${css("--muted")}"></i>Yatırılan</span>`);
  document.getElementById("legend").innerHTML = legend.join("");
  equityChart.timeScale().fitContent();

  const head = ["Strateji", "Reel IRR", "Reel CAGR", "Maks DD", "Sharpe", "En kötü yıl", "Son değer"];
  const rows = bt.variants.map((v) => {
    const m = p.results[v.key].metrics;
    return [v.name, pct(m.realIrr), pct(m.realCagr), pct(m.maxDrawdown), m.sharpe.toFixed(2), pct(m.worstYear), usd(m.finalValue)];
  });
  document.getElementById("table").innerHTML = `<table><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`;
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
    const bt = await loadBacktest();
    renderKpis(bt);
    const sel = document.getElementById("period");
    sel.innerHTML = bt.periods.map((p, i) => `<option value="${i}">${p.label}: ${p.start} → ${bt.end}</option>`).join("");
    sel.onchange = () => renderEquity(bt, Number(sel.value));
    renderEquity(bt, 0);
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
