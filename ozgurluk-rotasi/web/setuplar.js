const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* */ } } };

let D;
let group = store.get("st.group") || "all";
let side = store.get("st.side") || "all";
let loading = false;
const odds = new Map(); // "SYM|side|R" -> sonuç ya da hata

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

const px = (x) => (!Number.isFinite(x) ? "—" : x >= 1000 ? x.toLocaleString("tr-TR", { maximumFractionDigits: 0 }) : x >= 1 ? x.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : x.toLocaleString("tr-TR", { maximumSignificantDigits: 4 }));
const pct = (x, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? "+" : "−"}%${Math.abs(x * 100).toFixed(d)}` : "—");
const money = (x) => `$${Math.round(x).toLocaleString("tr-TR")}`;
const hm = (sec) => new Date(sec * 1000).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
const dayhm = (sec) => new Date(sec * 1000).toLocaleString("tr-TR", { weekday: "short", hour: "2-digit", minute: "2-digit" });
const sym = (s) => s.replace(/-USD$/, "").replace(/\.IS$/, "").replace(/^SUI20947$/, "SUI");
const sideTag = (s) => `<span class="st-side ${s}">${s === "long" ? "LONG" : "SHORT"}</span>`;

function settings() {
  const acc = Math.max(0, Number($("account").value) || 0), ml = Math.max(0, Number($("maxLoss").value) || 0);
  return { acc, ml };
}

/** trader-budget + trader-risk'in özü: adet = taban(maks kayıp / risk), sonra kurallar. */
function sizing(p, crypto, extraChecks = []) {
  if (!p) return `<div class="callout warn">Plan reddedildi: risk fiyatın %0,05'inden küçük (çok dar).</div>`;
  const { acc, ml } = settings();
  let qty = ml / p.risk;
  qty = crypto ? Math.floor(qty * 1e4) / 1e4 : Math.floor(qty);
  const cost = qty * p.entry, loss = qty * p.risk;
  const checks = [
    [qty > 0, qty > 0 ? `Adet ${crypto ? qty.toLocaleString("tr-TR", { maximumFractionDigits: 4 }) : qty}` : "Maks. kayıp bir birime bile yetmiyor"],
    [cost <= acc, cost <= acc ? `Tutar ${money(cost)} hesabın içinde` : `Tutar ${money(cost)} hesabı aşıyor (${money(acc)})`],
    [p.R >= 1, `Ödül:risk ${p.R.toFixed(1)}`],
    ...extraChecks,
  ];
  const pass = checks.every((c) => c[0]);
  return `<div class="st-size"><span class="st-pass ${pass ? "ok" : "no"}">${pass ? "PASS" : "BLOCK"}</span>
    <span>${checks.map((c) => `<i class="${c[0] ? "ok" : "no"}">${c[0] ? "✓" : "✕"}</i> ${esc(c[1])}`).join(" · ")}</span>
    ${qty > 0 ? `<small>Stopta kayıp ≈ ${money(loss)} · hedefte kazanç ≈ ${money(loss * p.R)}</small>` : ""}</div>`;
}

function planRows(p, label) {
  if (!p) return "";
  return `<div class="st-plan"><b>${label}</b>
    <span><small>Giriş</small>${px(p.entry)}</span><span><small>Stop</small><em class="neg">${px(p.stop)}</em></span>
    <span><small>Hedef</small><em class="pos">${px(p.target)}</em></span><span><small>Risk</small>${pct(p.riskPct)}</span></div>`;
}

/** Seans içi mini grafik: kapanışlar, açılış aralığı bandı ve tetik noktası. */
function mini(o) {
  const b = o.bars;
  if (!b || b.length < 3) return "";
  const W = 300, H = 70;
  const lo = Math.min(o.orLow, ...b.map((x) => x[3])), hi = Math.max(o.orHigh, ...b.map((x) => x[2]));
  const n = Math.max(b.length, 12);
  const x = (i) => (i / (n - 1)) * W, y = (v) => H - 4 - ((v - lo) / (hi - lo || 1)) * (H - 8);
  const pts = b.map((r, i) => `${x(i).toFixed(1)},${y(r[4]).toFixed(1)}`).join(" ");
  const trig = o.trigger ? `<circle cx="${x(o.trigger.barIndex)}" cy="${y(o.trigger.price)}" r="3.5" class="st-dot ${o.side}"/>` : "";
  return `<svg class="st-mini" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <rect x="0" y="${y(o.orHigh)}" width="${W}" height="${Math.max(1, y(o.orLow) - y(o.orHigh))}" class="st-band"/>
    <line x1="0" x2="${W}" y1="${y(o.orHigh)}" y2="${y(o.orHigh)}" class="st-lvl pos"/><line x1="0" x2="${W}" y1="${y(o.orLow)}" y2="${y(o.orLow)}" class="st-lvl neg"/>
    <polyline points="${pts}" class="st-line"/>${trig}</svg>`;
}

function oddsBlock(key) {
  const r = odds.get(key);
  if (!r) return "";
  if (r === "loading") return `<div class="st-odds"><div class="skeleton" style="min-height:60px"></div></div>`;
  if (r instanceof Error) return `<div class="st-odds"><div class="callout warn">${esc(r.message)}</div></div>`;
  const bar = (v, c) => `<i class="${c}" style="width:${(v * 100).toFixed(1)}%"></i>`;
  return `<div class="st-odds">
    <div class="st-odds-h"><b>Zaman Makinesi</b> <small>${r.runs.toLocaleString("tr-TR")} tekrar · tohum ${r.seed} · ${r.sessions} geçmiş seans · kalan ${r.barsLeft} bar${r.hypothetical ? " · <span class='warn'>varsayımsal giriş (aralık sınırı)</span>" : ""}</small></div>
    <div class="st-stack">${bar(r.targetFirst, "pos")}${bar(r.neither, "mid")}${bar(r.stopFirst, "neg")}</div>
    <div class="st-odds-g">
      <span><small>Önce hedef</small><b class="pos">%${(r.targetFirst * 100).toFixed(1)}</b></span>
      <span><small>Önce stop</small><b class="neg">%${(r.stopFirst * 100).toFixed(1)}</b></span>
      <span><small>Hiçbiri</small><b>%${(r.neither * 100).toFixed(1)}</b></span>
      <span><small>Yeşil</small><b>%${(r.green * 100).toFixed(1)}</b></span>
      <span><small>Ort. R</small><b>${r.avgR >= 0 ? "+" : ""}${r.avgR.toFixed(3)}</b></span>
      <span><small>Kapanış (%5–%95)</small><b>${px(r.closeP5)} – ${px(r.closeP95)}</b></span>
    </div>
    <p class="note">Geçmiş: aynı kural ${r.sessions} gerçek seansta ${r.history.fired} kez tetiklendi: ${r.history.target} hedef, ${r.history.stop} stop, ${r.history.neither} hiçbiri. Ort. R ${r.history.avgR >= 0 ? "+" : ""}${r.history.avgR.toFixed(3)}.</p>
    <p class="st-verdict ${r.verdict.tone}">${esc(r.verdict.text)}</p>
    ${r.extra.map((e) => `<p class="note">${esc(e)}</p>`).join("")}
    ${(r.history.fired >= 5 && ((r.verdict.tone === "pos" && r.history.avgR < 0) || (r.verdict.tone === "neg" && r.history.avgR > 0))) ? `<p class="note"><b>Dikkat:</b> simülasyon ile gerçek geçmiş farklı yönü gösteriyor.</p>` : ""}
  </div>`;
}

function orbCard(o, kind) {
  const crypto = o.group === "crypto";
  const s = o.side;
  const key = `${o.sym}|${s}|${o._R || 1}`;
  const p = (o._R || 1) === 2 ? o.plan2R : o.plan1R;
  const now = Date.now() / 1000;
  const late = o.trigger && o.trigger.barsAgo > 1;
  const head = kind === "ready"
    ? `<span class="badge ${late ? "half" : "on"}">${late ? `geç giriş · ${o.trigger.barsAgo} bar önce` : "taze tetik"}</span>`
    : "";
  const winOk = now < o.session.noEntryAfter;
  return `<article class="st-card" data-sym="${esc(o.sym)}">
    <header><div><b>${esc(sym(o.sym))}</b> <small>${esc(o.name)}</small></div>${sideTag(s)}</header>
    <div class="st-what"><span class="tag">ORB 15 dk</span> ${head}</div>
    <p>${hm(o.trigger.at)}'de ${s === "long" ? "aralık tepesinin üstünde" : "aralık dibinin altında"} kapandı: <b>${px(o.trigger.price)}</b> (${pct(o.trigger.pctOver)}) · aralık ${px(o.orLow)} – ${px(o.orHigh)} · hacim aralık ortalamasının ${o.trigger.volX.toFixed(2)}×'i. Şimdi ${px(o.last)}.</p>
    ${mini(o)}
    <div class="seg st-r" data-key="${esc(o.sym)}"><button data-r="1" aria-pressed="${(o._R || 1) === 1}">Hedef 1R</button><button data-r="2" aria-pressed="${o._R === 2}">Hedef 2R</button></div>
    ${planRows(p, "Plan (stop: aralık ortası)")}
    <p class="note">Pozisyonu en geç ${hm(o.session.flatBy)}'de kapat (seans kapanışı ${hm(o.session.end)}).</p>
    ${sizing(p, crypto, [[winOk, winOk ? `Giriş penceresi açık (${hm(o.session.noEntryAfter)}'e kadar)` : "Giriş penceresi kapalı"]])}
    <div class="actions"><button class="btn" data-odds="${esc(o.sym)}|${s}|${o._R || 1}">Zaman Makinesi: olasılıkları gör</button></div>
    ${oddsBlock(key)}
  </article>`;
}

function orbWatchCard(o) {
  const nearSide = Math.abs(o.distHigh) <= Math.abs(o.distLow) ? "long" : "short";
  const dist = nearSide === "long" ? o.distHigh : o.distLow;
  const key = `${o.sym}|${nearSide}|1`;
  return `<article class="st-card">
    <header><div><b>${esc(sym(o.sym))}</b> <small>${esc(o.name)}</small></div>${sideTag(nearSide)}</header>
    <div class="st-what"><span class="tag">ORB 15 dk</span> <span class="badge">bekliyor</span></div>
    <p>Aralık ${px(o.orLow)} – ${px(o.orHigh)}. Son kapanış ${px(o.last)} (${hm(o.lastBarClose)} barı): tepeye ${pct(o.distHigh)}, dibe ${pct(o.distLow)}.</p>
    ${mini(o)}
    <p class="st-trigger"><b>Tetik:</b> 5 dakikalık bir bar ${nearSide === "long" ? `${px(o.orHigh)} üstünde` : `${px(o.orLow)} altında`} KAPANIRSA (şu an ${pct(Math.abs(dist), 2).replace("+", "")} uzakta). Fitil sayılmaz. Son giriş ${hm(o.session.noEntryAfter)}.</p>
    <div class="actions"><button class="btn ghost" data-odds="${esc(o.sym)}|${nearSide}|1">Tetiklenirse olasılıklar (varsayımsal)</button></div>
    ${oddsBlock(key)}
  </article>`;
}


function usNextOpen() { return D.orb.find((o) => o.group === "us" && o.nextOpen)?.nextOpen; }

const TONE_RANK = { pos: 0, neutral: 1, neg: 2 };
/** Geçmişi iyi olan önce: karar tonu, sonra ortalama R. */
const byHistory = (a, b) => (TONE_RANK[a.history?.verdict.tone ?? "neutral"] - TONE_RANK[b.history?.verdict.tone ?? "neutral"]) || ((b.history?.avgR ?? 0) - (a.history?.avgR ?? 0));

/** Günlük kurulumlar sıkışık tablo olarak; satıra tıklayınca kural, tetik ve boyutlama açılır. */
function dailyTable(rows, ready) {
  if (!rows.length) return "";
  const body = rows.map((h, i) => {
    const info = D.info[h.key], p = h.plan, hist = h.history;
    const { ml } = settings();
    const crypto = h.group === "crypto";
    const qty = p ? (crypto ? Math.floor((ml / p.risk) * 1e4) / 1e4 : Math.floor(ml / p.risk)) : 0;
    return `<tr class="st-row" data-i="${i}">
      <td><b>${esc(sym(h.sym))}</b> <small>${esc(h.name)}</small></td><td>${sideTag(h.side)}</td>
      <td>${esc(info.label)}${info.fromSkill ? "" : ' <small class="note">(ek)</small>'}</td>
      <td>${px(h.close)}${h.level ? `<br><small>seviye ${px(h.level)} (${pct(h.distPct, 1)})</small>` : ""}</td>
      <td>${p ? `<span class="neg">${px(p.stop)}</span> / <span class="pos">${px(p.target)}</span><br><small>risk ${pct(p.riskPct, 1).replace("+", "")}</small>` : "—"}</td>
      ${ready ? `<td>${p && qty > 0 ? `${crypto ? qty.toLocaleString("tr-TR", { maximumFractionDigits: 4 }) : qty}<br><small>${money(qty * p.entry)}</small>` : "—"}</td>` : ""}
      <td>${hist && hist.n ? `${hist.n}× · <span class="pos">${hist.win}</span>/<span class="neg">${hist.loss}</span>/${hist.open}<br><small>ort. R ${hist.avgR >= 0 ? "+" : ""}${hist.avgR.toFixed(2)}</small>` : "—"}</td>
      <td><span class="st-verdict ${hist?.verdict.tone ?? ""}">${hist && hist.n >= 5 ? (hist.verdict.tone === "pos" ? "hedefe eğilimli" : hist.verdict.tone === "neg" ? "stopa eğilimli" : "başabaş") : "az örnek"}</span></td></tr>
      <tr class="st-detail" hidden><td colspan="${ready ? 8 : 7}">
        <p class="note">${esc(info.rule)}</p>${info.trigger ? `<p class="st-trigger"><b>Tetik:</b> ${esc(info.trigger)}</p>` : ""}
        ${p ? planRows(p, ready ? "Plan (stop 1,5×ATR14, hedef 2R)" : "Tetiklenirse plan (1,5×ATR stop, 2R)") : ""}
        ${ready ? sizing(p, crypto) : ""}
        ${hist && hist.n ? `<p class="note">Bu sembolde son 2 yılda ${hist.n} kez: ${hist.win} hedef, ${hist.loss} stop, ${hist.open} 20 seans içinde ikisine de değmedi. ${esc(hist.verdict.text)}</p>` : ""}
        <p class="note">Sinyal günü ${esc(h.date)} kapanışı. Fiyat ilerlediyse setup bayatlamıştır; işlemden önce yeniden tarayın.</p></td></tr>`;
  }).join("");
  return `<div class="scroll st-table"><table class="mini"><thead><tr><th>Sembol</th><th>Yön</th><th>Setup</th><th>Kapanış</th><th>Stop / Hedef</th>${ready ? "<th>Adet</th>" : ""}<th>Geçmiş (hedef/stop/açık)</th><th>Karar</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function filt(x) {
  return (group === "all" || x.group === group) && (side === "all" || (x.side ?? side) === side);
}

function render() {
  if (!D) return;
  const now = Date.now() / 1000;
  const live = D.orb.filter((o) => !o.ended && o.session);
  const readyOrb = live.filter((o) => o.status === "triggered" && o.after === "open" && now < o.session.noEntryAfter && filt(o))
    .sort((a, b) => a.trigger.barsAgo - b.trigger.barsAgo);
  const readyDaily = D.daily.filter((h) => h.status === "ready" && filt(h));
  const waitOrb = live.filter((o) => o.status === "waiting" && (side === "all" || side === (Math.abs(o.distHigh) <= Math.abs(o.distLow) ? "long" : "short")) && (group === "all" || o.group === group))
    .sort((a, b) => Math.min(Math.abs(a.distHigh), Math.abs(a.distLow)) - Math.min(Math.abs(b.distHigh), Math.abs(b.distLow)));
  const watchDaily = D.daily.filter((h) => h.status === "watch" && filt(h)).sort((a, b) => Math.abs(a.distPct ?? 0.05) - Math.abs(b.distPct ?? 0.05));

  const fresh = readyOrb.filter((o) => o.trigger.barsAgo <= 1).length;
  $("counts").innerHTML = `
    <div class="sig"><small>Şimdi girilebilir</small><b>${fresh + readyDaily.length}</b> <small>${fresh} taze ORB · ${readyDaily.length} günlük${readyOrb.length - fresh ? ` · ${readyOrb.length - fresh} geç` : ""}</small></div>
    <div class="sig"><small>Beklenen</small><b>${waitOrb.length + watchDaily.length}</b> <small>${waitOrb.length} ORB · ${watchDaily.length} günlük</small></div>
    <div class="sig"><small>Taranan</small><b>${D.scanned}</b> <small>${D.failed.length ? `${D.failed.length} alınamadı` : "hepsi alındı"}</small></div>`;

  const sec = (title, html, empty) => `<h3 class="st-h">${title}</h3>${html || `<p class="note">${empty}</p>`}`;
  $("ready").innerHTML =
    sec("Açılış aralığı kırılımları (gün içi, taze)", readyOrb.filter((o) => o.trigger.barsAgo <= 1).map((o) => orbCard(o, "ready")).join(""), `Açık seanslarda şu an girilebilir ORB yok.${usNextOpen() ? ` ABD seansı ${dayhm(usNextOpen())}'de açılır; ilk sinyal en erken 15 dakika sonra.` : ""}`) +
    (readyOrb.some((o) => o.trigger.barsAgo > 1) ? sec("Tetiklendi, hâlâ açık — geç giriş (farklı bir işlemdir)", readyOrb.filter((o) => o.trigger.barsAgo > 1).map((o) => orbCard(o, "ready")).join(""), "") : "") +
    sec("Günlük kurulumlar (son kapanışta tetiklendi)", dailyTable([...readyDaily].sort(byHistory), true), "Son kapanışta tetiklenen günlük kurulum yok.");
  $("watch").innerHTML =
    sec("ORB: aralık içinde bekleyenler", waitOrb.map(orbWatchCard).join(""), "Açık seansta aralık içinde bekleyen sembol yok.") +
    sec("Günlük: tetiğe yakın olanlar", dailyTable(watchDaily, false), "Tetiğe yakın günlük kurulum yok.");

  const past = D.orb.filter((o) => (o.ended || o.status === "expired" || (o.status === "triggered" && o.after !== "open")) && o.orHigh !== undefined && (group === "all" || o.group === group));
  const OUT = { stop: ["neg", "Stop oldu"], target1R: ["pos", "1R hedef"], target2R: ["pos", "2R hedef"], open: ["", "Kapanışa kadar açık"] };
  $("past").innerHTML = past.length ? `<table class="mini"><thead><tr><th>Sembol</th><th>Seans</th><th>Aralık</th><th>Tetik</th><th>Sonra</th></tr></thead><tbody>${past.map((o) => `<tr>
    <td><b>${esc(sym(o.sym))}</b> <small>${esc(o.name)}</small></td><td>${dayhm(o.session.start)}${o.ended ? " · kapandı" : ""}</td><td>${px(o.orLow)} – ${px(o.orHigh)}</td>
    <td>${o.trigger ? `${sideTag(o.side)} ${hm(o.trigger.at)} @ ${px(o.trigger.price)}` : o.status === "expired" ? "tetik yok (süre doldu)" : "tetik yok"}</td>
    <td>${o.trigger ? `<span class="${OUT[o.after][0]}">${OUT[o.after][1]}</span>` : "—"}</td></tr>`).join("")}</tbody></table>` : `<p class="note">Kayıt yok.</p>`;

  const sessions = D.orb.filter((o) => o.session);
  const usOpen = sessions.find((o) => o.group === "us" && !o.ended);
  const usNext = sessions.find((o) => o.group === "us" && o.nextOpen)?.nextOpen;
  $("clock").innerHTML = `Saatler tarayıcınızın saat dilimiyle. ABD seansı: ${usOpen ? `açık, kapanış ${hm(usOpen.session.end)}` : usNext ? `kapalı, açılış ${dayhm(usNext)}` : "kapalı"}. Kripto ORB'si UTC günü başlangıcına (${hm(Math.floor(Date.now() / 86400000) * 86400)}) göredir; BIST, Yahoo'nun BIST seansına göre.`;
  bindCards();
}

function bindCards() {
  document.querySelectorAll(".st-row").forEach((r) => (r.onclick = () => { const d = r.nextElementSibling; d.hidden = !d.hidden; r.classList.toggle("open", !d.hidden); }));
  document.querySelectorAll("[data-odds]").forEach((b) => (b.onclick = () => loadOdds(b.dataset.odds)));
  document.querySelectorAll(".st-r").forEach((seg) => seg.querySelectorAll("button").forEach((b) => (b.onclick = () => {
    const o = D.orb.find((x) => x.sym === seg.dataset.key);
    o._R = Number(b.dataset.r);
    render();
  })));
}

async function loadOdds(key) {
  if (odds.get(key) === "loading") return;
  const [s, sd, r] = key.split("|");
  odds.set(key, "loading");
  render();
  try { odds.set(key, await api(`/api/setups/odds?symbol=${encodeURIComponent(s)}&side=${sd}&r=${r}`)); }
  catch (e) { odds.set(key, e); }
  render();
}

const SKILLS = [
  ["trader-scanner", "Grafik tarayıcı: ~5.900 ABD hissesinde günlük setuplar ve ORB."],
  ["trader-news", "Takip ettiğiniz hisselerde son dakika haberleri ve 8-K'lar."],
  ["trader-entry", "Setup'ı bar bar izler, giriş anını söyler."],
  ["trader-exit", "Girişten önce stop ve hedef planı."],
  ["trader-timemachine", "10.000 tekrar + geçmiş: dürüst olasılıklar."],
  ["trader-risk", "Her emri limitlerinize göre denetler (PASS / BLOCK)."],
  ["trader-budget", "Pozisyonu bütçe ve işlem başı maks. kayba göre boyutlar."],
  ["trader-broker", "Onaylı emri aracı kuruma gönderir (varsayılan kâğıt hesap, her zaman sizin evet'inizle)."],
  ["trader-alerts", "Fiyat, stop ve kapanış alarmları."],
  ["trader-analyst", "Bilanço raporlarını okur, neyin değiştiğini özetler."],
  ["trader-pelosi", "Kongre üyelerinin hisse işlem bildirimleri."],
];

function renderSkills() {
  $("skills").innerHTML = `<p>Paketin tamamı bu depoda <code>.claude/skills/</code> altında. Depoyu Claude Code ile açtığınızda bu komutlar doğrudan çalışır (Python 3.8+, kurulum gerekmez). Bu sayfa paketin tarama, giriş, çıkış ve Zaman Makinesi kurallarını sunucuda çalıştırır; haber, bilanço, alarm ve emir adımları için skill'leri kullanın.</p>
  <ul>${SKILLS.map(([k, v]) => `<li><code>/${k}</code> — ${esc(v)}</li>`).join("")}</ul>
  <p class="note">Akış: scanner → news → entry → exit → timemachine → budget → risk → broker. Emir yalnız trader-broker'dan, risk kontrolü geçtikten ve siz o emre açıkça "evet" dedikten sonra çıkabilir. Bu web sayfası hiçbir koşulda emir göndermez.</p>`;
}

async function load(force = false) {
  if (loading) return;
  loading = true;
  const b = $("refresh");
  b.disabled = true; b.classList.add("loading");
  const pill = $("freshness");
  try {
    D = await api(`/api/setups${force ? "?refresh=1" : ""}`);
    $("source").textContent = D.source;
    pill.className = "pill ok";
    pill.querySelector("span").textContent = `Tarama · ${new Date(D.generatedAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`;
    render();
    if (force) toast("Yeniden tarandı.");
  } catch (e) {
    pill.className = "pill warn";
    pill.querySelector("span").textContent = "Tarama başarısız";
    $("ready").innerHTML = `<div class="callout warn">Setuplar alınamadı: ${esc(e.message)}</div>`;
  } finally { loading = false; b.disabled = false; b.classList.remove("loading"); }
}

(async () => {
  reveal();
  renderSkills();
  const h = await api("/api/health").catch(() => null);
  if (!h?.features?.includes("setups")) {
    $("staleBanner").innerHTML = `<div class="banner"><b>Panel sunucusu eski sürüm çalışıyor ya da kapalı.</b> Terminalde <code>npm run web</code>'i <b>Ctrl+C</b> ile durdurup yeniden başlatın (ya da <code>baslat-windows.bat</code>'a çift tıklayın).</div>`;
    return;
  }
  const G = [["all", "Tümü"], ["core", "Planımız"], ["us", "ABD"], ["crypto", "Kripto"], ["tr", "BIST"]];
  $("groupChips").innerHTML = G.map(([k, v]) => `<button data-v="${k}" aria-selected="${k === group}">${v}</button>`).join("");
  $("groupChips").querySelectorAll("button").forEach((b) => (b.onclick = () => {
    group = b.dataset.v; store.set("st.group", group);
    $("groupChips").querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    render();
  }));
  $("sideSeg").querySelectorAll("button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.v === side));
    b.onclick = () => { side = b.dataset.v; store.set("st.side", side); $("sideSeg").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); render(); };
  });
  for (const id of ["account", "maxLoss"]) {
    const v = store.get(`st.${id}`);
    if (v) $(id).value = v;
    $(id).oninput = () => { store.set(`st.${id}`, $(id).value); render(); };
  }
  $("refresh").onclick = () => load(true);
  await load();
  // ORB 5 dakikalık barlarla çalışır: bar kapanışından hemen sonra yenile
  const tick = () => { if (document.visibilityState === "visible") load(); };
  setTimeout(() => { tick(); setInterval(tick, 5 * 60_000); }, (300 - ((Date.now() / 1000) % 300) + 75) * 1000);
})();
