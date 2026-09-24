const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const MONTHS_LONG = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const ELECTIONS = new Set(["us_presidential", "us_midterm", "tr_general", "tr_local"]);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const fmt = (x, d = 1) => (Number.isFinite(x) ? `${x >= 0 ? "+" : "−"}%${Math.abs(x * 100).toFixed(d)}` : "—");
const cls = (x) => (x > 0 ? "pos" : x < 0 ? "neg" : "");

let DATA;
let current;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* yok say */ } },
};

function hexToRgb(h) {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return x.map((v, i) => Math.round(v + (y[i] - v) * t));
}
function cellColor(ret, scale) {
  const t = Math.min(Math.abs(ret) / scale, 1) ** 0.75;
  const rgb = mix(css("--neutral"), ret >= 0 ? css("--up") : css("--down"), 0.15 + 0.85 * t);
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  return { bg: `rgb(${rgb.join(",")})`, fg: lum < 0.55 ? "#fff" : "#1b1f24" };
}

function visibleNote(n) {
  const on = (t) => document.querySelector(`#toggles input[data-t="${t}"]`).checked;
  if (ELECTIONS.has(n.type)) return on("elections");
  return on(n.type);
}

function renderFocus() {
  const f = DATA.focus.map((x, i) => `
    <div class="card"><h3>${i === 0 ? "Bu ay" : "Gelecek ay"}: ${x.label}<span class="pill">son ${DATA.lookbackYears} yıl</span></h3>
    <ul>${x.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>`);
  const cell = (up, n, avg) => `<td class="${cls(avg)}">${fmt(avg)} <small>${up}/${n}</small></td>`;
  const u = DATA.upcoming.map((x) => `
    <div class="card"><h3>${esc(x.title)}<span class="pill">${x.daysLeft} gün · ${x.date}</span></h3>
    ${x.rows.length ? `<div class="scroll"><table class="mini"><thead><tr><th>Geçmişte</th><th>Öncesi 6 ay</th><th>Öncesi 3 ay</th><th>Sonrası 3 ay</th></tr></thead><tbody>
    ${x.rows.map((r) => `<tr><td>${esc(r.asset)} <small>(${r.n} örnek)</small></td>${cell(r.preUp, r.n, r.preAvg)}${cell(r.pre3mUp, r.n, r.pre3mAvg)}${cell(r.post3mUp, r.n3m, r.post3mAvg)}</tr>`).join("")}
    </tbody></table></div>` : `<div class="note">Yeterli geçmiş örnek yok.</div>`}</div>`);
  document.getElementById("focus").innerHTML = f.join("");
  document.getElementById("upcoming").innerHTML = u.join("");
}

function renderChips() {
  document.getElementById("chips").innerHTML = DATA.assets
    .map((a) => `<button class="chip" data-id="${a.id}" aria-pressed="${a.id === current}">${esc(a.short)}</button>`).join("");
  document.querySelectorAll(".chip").forEach((b) => (b.onclick = () => select(b.dataset.id)));
}

function select(id) {
  current = id;
  store.set("takvim.asset", id);
  history.replaceState(null, "", `#${id}`);
  document.querySelectorAll(".chip").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === id)));
  renderAsset();
}

function renderAsset() {
  const a = DATA.assets.find((x) => x.id === current);
  const scale = Math.max(a.typicalAbs * 2.5, 0.01);
  const curMonth = Number(DATA.asOf.slice(5, 7));
  let h = `<thead><tr><th style="text-align:left">Yıl</th>${MONTHS.map((m, i) => `<th class="${i + 1 === curMonth ? "cur" : ""}">${m}</th>`).join("")}<th>Yıl</th></tr></thead><tbody>`;
  for (const y of a.years) {
    h += `<tr><td class="y">${y}</td>`;
    let g = 1, any = false, partialYear = false;
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      const c = a.cells[key];
      const notes = (a.notes[key] || []).filter(visibleNote);
      const dot = notes.length ? `<span class="dot ${notes.every((n) => n.upcoming) ? "up" : ""}" aria-hidden="true"></span>` : "";
      if (!c) {
        h += `<td class="empty" data-k="${key}" ${notes.length ? 'tabindex="0"' : ""}>${dot}</td>`;
        continue;
      }
      any = true;
      g *= 1 + c.ret;
      if (c.partial) partialYear = true;
      const col = cellColor(c.ret, scale);
      h += `<td tabindex="0" data-k="${key}" class="${c.partial ? "partial" : ""}" style="background:${col.bg};color:${col.fg}" aria-label="${MONTHS_LONG[m - 1]} ${y}: ${fmt(c.ret)}${notes.length ? ", " + notes.map((n) => n.title).join("; ") : ""}">${fmt(c.ret)}${dot}</td>`;
    }
    if (any) {
      const col = cellColor(g - 1, scale * 3.5);
      h += `<td class="total" data-y="${y}" style="background:${col.bg};color:${col.fg}" title="${partialYear ? "Yılbaşından bugüne" : "Yıllık getiri"}">${fmt(g - 1, 0)}</td>`;
    } else h += `<td class="empty"></td>`;
    h += `</tr>`;
  }
  h += `<tr class="sep"><td colspan="14"></td></tr>`;
  const statRow = (label, f, klass) => `<tr class="stat"><td class="y">${label}</td>${a.stats.map((s) => f(s, klass)).join("")}<td></td></tr>`;
  h += statRow("Yeşil", (s) => {
    const r = s.n ? s.up / s.n : 0;
    return `<td class="${r >= 0.7 ? "hi" : r <= 0.3 ? "lo" : ""}" title="Son ${s.n} kapanmış ${MONTHS_LONG[s.month - 1]}">${s.up}/${s.n}<div class="bar"><i style="width:${r * 100}%"></i></div></td>`;
  });
  h += statRow("Ortalama", (s) => `<td class="${cls(s.avg)}">${fmt(s.avg)}</td>`);
  h += statRow("Medyan", (s) => `<td class="${cls(s.median)}">${fmt(s.median)}</td>`);
  h += statRow("En iyi / kötü", (s) => `<td style="font-size:11px">${fmt(s.best, 0)}<br>${fmt(s.worst, 0)}</td>`);
  h += `</tbody>`;
  const table = document.getElementById("heat");
  table.innerHTML = h;
  bindTips(table, a);

  const gUp = cellColor(scale, scale).bg, gDn = cellColor(-scale, scale).bg, gMid = css("--neutral");
  document.getElementById("legend").innerHTML = `
    <span class="scale">${fmt(-scale, 0)}<span class="g" style="background:linear-gradient(90deg,${gDn},${gMid},${gUp})"></span>${fmt(scale, 0)}</span>
    <span><span class="sw" style="outline:2px dashed var(--muted);outline-offset:-2px"></span>Devam eden ay (istatistiğe dahil değil)</span>
    <span><span class="sw" style="background:var(--ink);border-radius:50%;width:8px;height:8px"></span>Olay notu (üzerine gelin)</span>
    <span><span class="sw" style="background:var(--warn);border-radius:50%;width:8px;height:8px"></span>Yaklaşan olay</span>`;
  document.getElementById("assetnote").textContent =
    `${a.name} · ${a.currency} · veri ${a.dataStart} → ${a.lastDate} · tüm ayların %${Math.round(a.baseUpRate * 100)}'i yeşil (son ${DATA.lookbackYears} yıl). Renk yoğunluğu bu varlığın tipik aylık hareketine göre ölçeklenir.`;

  document.getElementById("insights").innerHTML = a.insights.length
    ? a.insights.map((i) => `<div class="ins"><b class="tag ${i.kind}">${i.kind === "strong" ? "Güçlü ay" : i.kind === "weak" ? "Zayıf ay" : "Olay"}</b><span>${esc(i.text)}</span><span class="ev">kanıt: ${i.evidence}</span></div>`).join("")
    : `<div class="note">Bu varlıkta belirgin bir aylık eğilim (≥7/10 veya ≤3/10) yok.</div>`;

  document.getElementById("events").innerHTML = a.events.length
    ? a.events.map((s) => `
      <details ${ELECTIONS.has(s.type) ? "open" : ""}><summary>${esc(s.label)} <span class="pill">${s.n} örnek</span></summary>
      <div class="scroll"><table class="plain"><thead><tr><th>Olay</th><th>Öncesi 6 ay</th><th>Öncesi 3 ay</th><th>Sonrası 1 ay</th><th>Sonrası 3 ay</th></tr></thead><tbody>
      ${s.rows.map((r) => `<tr><td>${r.event.date} · ${esc(r.event.title)}</td>${[r.pre, r.pre3m, r.post1m, r.post3m].map((x) => `<td class="${cls(x)}">${fmt(x)}</td>`).join("")}</tr>`).join("")}
      <tr><th>Ortalama (yükselen)</th><th class="${cls(s.preAvg)}">${fmt(s.preAvg)} (${s.preUp}/${s.n})</th><th class="${cls(s.pre3mAvg)}">${fmt(s.pre3mAvg)} (${s.pre3mUp}/${s.n})</th><th class="${cls(s.post1mAvg)}">${fmt(s.post1mAvg)} (${s.post1mUp})</th><th class="${cls(s.post3mAvg)}">${fmt(s.post3mAvg)} (${s.post3mUp}/${s.n3m})</th></tr>
      <tr><td>Herhangi bir dönem (karşılaştırma)</td><td>${fmt(s.baselinePre)}</td><td></td><td></td><td>${fmt(s.baselinePost3m)}</td></tr>
      </tbody></table></div></details>`).join("")
    : `<div class="note">Bu varlık için olay çalışması yok.</div>`;
}

function bindTips(table, a) {
  const tip = document.getElementById("tip");
  const show = (td, x, y) => {
    const k = td.dataset.k;
    if (!k) return hide();
    const [yy, mm] = k.split("-").map(Number);
    const c = a.cells[k];
    const s = a.stats[mm - 1];
    const notes = (a.notes[k] || []).filter(visibleNote);
    if (!c && !notes.length) return hide();
    let html = `<div>${MONTHS_LONG[mm - 1]} ${yy}${c && c.partial ? " · devam ediyor" : ""}</div>`;
    if (c) html += `<b>${fmt(c.ret, 2)}</b><div>${MONTHS_LONG[mm - 1]} genelde: ${s.up}/${s.n} yeşil · ort. ${fmt(s.avg)}</div>`;
    if (notes.length) html += `<div class="n">${notes.map((n) => `• ${esc(n.date)} — ${esc(n.title)}${n.upcoming ? " (yaklaşan)" : ""}`).join("<br>")}</div>`;
    tip.innerHTML = html;
    tip.style.opacity = "1";
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(x + 12, innerWidth - r.width - 8) + "px";
    tip.style.top = (y + 16 + r.height > innerHeight ? y - r.height - 12 : y + 16) + "px";
  };
  const hide = () => (tip.style.opacity = "0");
  table.onmousemove = (e) => {
    const td = e.target.closest("td");
    td ? show(td, e.clientX, e.clientY) : hide();
  };
  table.onmouseleave = hide;
  table.onfocusin = (e) => {
    const td = e.target.closest("td");
    if (!td) return;
    const r = td.getBoundingClientRect();
    show(td, r.left, r.bottom - 8);
  };
  table.onfocusout = hide;
  table.onclick = (e) => {
    const td = e.target.closest("td");
    if (td) { const r = td.getBoundingClientRect(); show(td, r.left, r.bottom - 8); }
  };
}

(async () => {
  let res = await fetch("/api/takvim").catch(() => null);
  if (!res || !res.ok) res = await fetch("/out/takvim.json").catch(() => null);
  if (!res || !res.ok) {
    document.getElementById("meta").textContent = "Veri yüklenemedi — `npm run web` ile sunucuyu başlatın veya `npm run takvim` çalıştırın.";
    return;
  }
  DATA = await res.json();
  document.getElementById("meta").textContent =
    `Son ${DATA.lookbackYears} yıl · veri tarihi ${DATA.asOf} · istatistikler yalnız kapanmış ayları içerir; ay kapanışlarında otomatik güncellenir`;
  const fromHash = location.hash.slice(1);
  const saved = store.get("takvim.asset");
  current = [fromHash, saved, "BIST_TL"].find((id) => id && DATA.assets.some((a) => a.id === id));
  renderFocus();
  renderChips();
  renderAsset();
  document.querySelectorAll("#toggles input").forEach((i) => (i.onchange = renderAsset));
})();
