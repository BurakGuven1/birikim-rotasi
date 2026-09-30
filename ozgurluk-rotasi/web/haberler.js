const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* */ } } };
const TAG_COLOR = { BTC: "--s2", ETH: "--s5", GLD: "--s4", SPY: "--s1", QQQ: "--s7", BIST: "--s8", DBC: "--s3", MACRO: "--s9" };
const TAG_NAME = { BTC: "Bitcoin", ETH: "ETH/Kripto", GLD: "Altın", SPY: "S&P 500", QQQ: "Nasdaq", BIST: "BIST/TL", DBC: "Emtia", MACRO: "Makro" };
const CATS = [["top", "Önemli"], ["all", "Tümü"], ["crypto", "Kripto"], ["us", "ABD"], ["macro", "Makro"], ["commodity", "Emtia"], ["tr", "Türkiye"]];

let NEWS;
let cat = store.get("news.cat") || "top";
let tagSel = store.get("news.tag") || "";
let shown = 30;
let chat = [];
let busy = false;

let toastTimer;
function toast(html, ms = 4000) { const t = $("toast"); t.innerHTML = html; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), ms); }

function reveal() {
  const els = document.querySelectorAll(".reveal:not(.in)");
  if (REDUCED || !("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -40px 0px" });
  els.forEach((e) => io.observe(e));
}

function ago(iso) {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 60) return `${m} dk önce`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} sa önce` : `${Math.round(h / 24)} gün önce`;
}

/** Güvenli mini markdown: önce kaçış, sonra başlık/madde/kalın/bağlantı. */
function md(text) {
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])_(.+?)_(?=[\s).,;:!?]|$)/g, "$1<i>$2</i>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  const out = [];
  let list = false;
  for (const raw of text.split("\n")) {
    const l = raw.trimEnd();
    const bullet = l.match(/^\s*[-*•]\s+(.*)/) || l.match(/^\s*\d+[.)]\s+(.*)/);
    if (bullet) { if (!list) { out.push("<ul>"); list = true; } out.push(`<li>${inline(bullet[1])}</li>`); continue; }
    if (list) { out.push("</ul>"); list = false; }
    const h = l.match(/^#{1,4}\s+(.*)/);
    if (h) out.push(`<h3>${inline(h[1])}</h3>`);
    else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  if (list) out.push("</ul>");
  return out.join("");
}

// ------------------------------------------------------------------ piyasa nabzı
function spark(values, up) {
  if (!values || values.length < 2) return "";
  const lo = Math.min(...values), hi = Math.max(...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${(28 - ((v - lo) / (hi - lo || 1)) * 26).toFixed(1)}`).join(" ");
  const c = up ? css("--up") : css("--down");
  return `<svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${c}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}
const fmtPrice = (p, unit) => (unit === "%" ? p.toFixed(2) + "%" : p >= 1000 ? p.toLocaleString("en-US", { maximumFractionDigits: 0 }) : p.toLocaleString("en-US", { maximumFractionDigits: 2 }));

function gauge(v) {
  // 0-100 yarım daire; renk bölgeleri korku (kırmızı) → açgözlülük (yeşil)
  const a = Math.PI * (1 - v / 100);
  const x = 100 + 78 * Math.cos(a), y = 100 - 78 * Math.sin(a);
  const seg = (from, to, color) => {
    const a1 = Math.PI * (1 - from / 100), a2 = Math.PI * (1 - to / 100);
    return `<path d="M ${100 + 88 * Math.cos(a1)} ${100 - 88 * Math.sin(a1)} A 88 88 0 0 1 ${100 + 88 * Math.cos(a2)} ${100 - 88 * Math.sin(a2)}" stroke="${color}" stroke-width="14" fill="none"/>`;
  };
  return `<svg class="gauge" viewBox="0 0 200 110" role="img" aria-label="Korku ve açgözlülük endeksi ${v}">
    ${seg(0, 24, css("--down"))}${seg(25, 44, css("--s2"))}${seg(45, 55, css("--s9"))}${seg(56, 74, css("--s3"))}${seg(75, 100, css("--up"))}
    <line x1="100" y1="100" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${css("--ink")}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="100" cy="100" r="5" fill="${css("--ink")}"/></svg>`;
}

async function loadPulse(force = false) {
  const p = await api(`/api/pulse${force ? "?refresh=1" : ""}`);
  $("tickers").innerHTML = p.tickers.map((t, i) => {
    const up = t.change >= 0;
    return `<div class="tick" style="animation-delay:${i * 25}ms" title="${esc(t.hint || "")}"><span class="g">${esc(t.group)}</span><small>${esc(t.label)}</small><b>${fmtPrice(t.price, t.unit)}</b><span class="chg ${up ? "pos" : "neg"}">${up ? "▲" : "▼"} ${Math.abs(t.change * 100).toFixed(2)}%</span>${spark(t.spark, (t.spark?.[t.spark.length - 1] ?? 0) >= (t.spark?.[0] ?? 0))}</div>`;
  }).join("") || `<p class="note">Fiyatlar alınamadı.</p>`;
  const fg = p.fearGreed;
  $("fearGreed").innerHTML = fg
    ? `<h3>Kripto korku / açgözlülük</h3>${gauge(fg.value)}<div class="gauge-val"><b>${fg.value}</b><span>${esc(fg.label)}</span><div class="note">Dün ${fg.previous ?? "—"} · 1 hafta önce ${fg.weekAgo ?? "—"}</div></div><p class="note">Aşırı korku tarihsel olarak uzun vadeli alım fırsatlarına, aşırı açgözlülük ise kısa vadeli ısınmaya işaret etti. Plan kurallarının yerine geçmez.</p>`
    : `<h3>Kripto korku / açgözlülük</h3><p class="note">Alınamadı.</p>`;
  $("upcoming").innerHTML = p.upcoming.map((u) => `<li><span>${esc(u.title)}</span><small>${new Date(u.date + "T12:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "short" })} · ${u.daysLeft} gün</small></li>`).join("") || `<li class="note">Yakın tarih yok.</li>`;
}

// ------------------------------------------------------------------ haberler
function renderFilters() {
  $("cats").innerHTML = CATS.map(([k, v]) => `<button role="tab" data-k="${k}" aria-selected="${k === cat}">${v}</button>`).join("");
  document.querySelectorAll("#cats button").forEach((b) => (b.onclick = () => { cat = b.dataset.k; store.set("news.cat", cat); shown = 30; renderFilters(); renderNews(); }));
  $("tagFilter").innerHTML = [["", "Tüm varlıklar"], ...Object.entries(TAG_NAME)].map(([k, v]) => `<button data-k="${k}" aria-selected="${k === tagSel}">${k ? `<span class="sw" style="background:${css(TAG_COLOR[k])};width:8px;height:8px;margin-right:4px"></span>` : ""}${v}</button>`).join("");
  document.querySelectorAll("#tagFilter button").forEach((b) => (b.onclick = () => { tagSel = b.dataset.k; store.set("news.tag", tagSel); shown = 30; renderFilters(); renderNews(); }));
}

function filtered() {
  if (!NEWS) return [];
  const q = $("newsSearch").value.trim().toLowerCase();
  let items = NEWS.items;
  if (cat === "top") items = items.filter((n) => n.highImpact.length || n.alsoIn.length >= 1).slice(0, 60);
  else if (cat !== "all") items = items.filter((n) => n.category === cat);
  if (tagSel) items = items.filter((n) => n.tags.includes(tagSel));
  if (q) items = items.filter((n) => (n.title + " " + n.summary + " " + n.source).toLowerCase().includes(q));
  return items;
}

function renderNews() {
  const items = filtered();
  const max = Math.max(...(NEWS?.items.slice(0, 10).map((n) => n.importance) ?? [1]));
  $("newsList").innerHTML = items.slice(0, shown).map((n, i) => {
    const lvl = n.importance >= max * 0.6 ? "hi" : n.importance >= max * 0.35 ? "mid" : "lo";
    const safeLink = /^https?:\/\//i.test(n.link) ? n.link : "#";
    const sent = n.sentiment > 0 ? `<span class="sent pos" title="Başlık olumlu/yükseliş yönlü">▲</span>` : n.sentiment < 0 ? `<span class="sent neg" title="Başlık olumsuz/düşüş yönlü">▼</span>` : "";
    return `<article class="news" style="animation-delay:${Math.min(i, 12) * 20}ms">
      <span class="imp ${lvl}" title="Önem: ${lvl === "hi" ? "yüksek" : lvl === "mid" ? "orta" : "düşük"}"></span>
      <div>
        <a class="t" href="${esc(safeLink)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
        <div class="m"><b>${esc(n.source)}</b><span>${ago(n.published)}</span>${n.alsoIn.length ? `<span title="${esc(n.alsoIn.join(", "))}">+${n.alsoIn.length} kaynak</span>` : ""}</div>
        ${n.summary && n.summary !== n.title ? `<div class="s">${esc(n.summary)}</div>` : ""}
        <div class="tags">${n.highImpact.map((h) => `<span class="tag hi">${esc(h)}</span>`).join("")}${n.tags.map((t) => `<span class="tag"><i style="background:${css(TAG_COLOR[t])}"></i>${TAG_NAME[t]}</span>`).join("")}</div>
      </div>
      <div class="side">${sent}<button class="ask-btn" data-i="${esc(n.title)}" data-s="${esc(n.source)}">✦ Claude'a sor</button></div>
    </article>`;
  }).join("") || `<p class="note">Bu filtrede haber yok.</p>`;
  $("moreNews").style.display = items.length > shown ? "" : "none";
  document.querySelectorAll(".ask-btn").forEach((b) => (b.onclick = () => {
    $("chatInput").value = `"${b.dataset.i}" (${b.dataset.s}) haberi benim portföyüm ve planım için ne anlama geliyor? Bir şey yapmam gerekir mi?`;
    $("chatInput").focus();
    $("chatInput").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "center" });
  }));
}

async function loadNews(force = false) {
  const b = $("newsRefresh");
  b.disabled = true; b.classList.add("loading");
  try {
    NEWS = await api(`/api/news${force ? "?refresh=1" : ""}`);
    const ok = NEWS.sources.filter((s) => s.ok).length;
    $("sources").innerHTML = NEWS.sources.map((s) => `${s.ok ? "✓" : "✕"} ${esc(s.name)} (${esc(s.id)}): ${s.ok ? s.count + " haber" : esc(s.error || "hata")}`).join(" · ");
    const pill = $("freshness");
    pill.className = `pill ${ok > NEWS.sources.length / 2 ? "ok" : "warn"}`;
    pill.querySelector("span").textContent = `${NEWS.items.length} haber · ${ok}/${NEWS.sources.length} kaynak · ${new Date(NEWS.generatedAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`;
    renderNews();
  } catch (e) {
    $("newsList").innerHTML = `<div class="callout warn">Haberler alınamadı: ${esc(e.message)}</div>`;
  } finally { b.disabled = false; b.classList.remove("loading"); }
}

// ------------------------------------------------------------------ Claude
async function api(path, opts) {
  const r = await fetch(path, { cache: "no-store", ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

/**
 * NDJSON akışını okur; her satırda onLine çağrılır. `signal` ile durdurulabilir.
 * Sunucu 3 sn'de bir kalp atışı gönderir; 90 sn hiç veri gelmezse bağlantı kopmuş sayılır.
 */
async function streamPost(path, body, onLine, signal) {
  const ac = new AbortController();
  signal?.addEventListener("abort", () => ac.abort());
  let watchdog;
  const arm = () => { clearTimeout(watchdog); watchdog = setTimeout(() => ac.abort(new Error("Sunucudan 90 sn yanıt gelmedi; bağlantı kopmuş olabilir. Tekrar deneyin.")), 90_000); };
  arm();
  try {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ac.signal });
    if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status} — sunucuyu yeniden başlatmanız gerekebilir (npm run web)`); }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      arm();
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) onLine(JSON.parse(line));
      }
    }
  } catch (e) {
    if (signal?.aborted) throw new Error("Durduruldu.");
    if (ac.signal.aborted && ac.signal.reason instanceof Error) throw ac.signal.reason;
    throw e;
  } finally { clearTimeout(watchdog); }
}

const metaLine = (m) => m ? `${m.model} · ${m.usage.input.toLocaleString("tr-TR")} girdi / ${m.usage.output.toLocaleString("tr-TR")} çıktı token${m.usage.cacheRead ? ` · ${m.usage.cacheRead.toLocaleString("tr-TR")} önbellekten` : ""}${m.webSearches ? ` · ${m.webSearches} web araması` : ""}` : "";

let briefAbort;
async function runBrief() {
  if (busy) return;
  busy = true;
  const out = $("briefOut"), st = $("briefStatus"), btn = $("briefBtn"), think = $("briefThink");
  btn.disabled = true;
  $("briefStop").hidden = false;
  briefAbort = new AbortController();
  let text = "", phase = "Başlıyor…", secs = 0;
  const showStatus = () => (st.innerHTML = `<span class="spin"></span><span>${esc(phase)}${secs ? ` · ${secs} sn` : ""}</span>`);
  out.innerHTML = "";
  out.classList.add("cursor");
  showStatus();
  try {
    await streamPost("/api/ai/brief", { strategy: $("aiStrategy").value, webSearch: $("webSearch").checked }, (m) => {
      if (m.t === "text") { text += m.v; out.innerHTML = md(text); think.hidden = true; phase = "Yazıyor…"; showStatus(); }
      else if (m.t === "thinking") { think.hidden = false; think.textContent = "…" + m.v; }
      else if (m.t === "tick") { secs = m.s; showStatus(); }
      else if (m.t === "status") { phase = m.v; showStatus(); }
      else if (m.t === "error") { out.innerHTML = `<div class="callout warn">${esc(m.v)}</div>`; st.textContent = ""; }
      else if (m.t === "done") { st.textContent = `Hazır · ${new Date().toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" })}`; $("briefMeta").textContent = metaLine(m.meta); }
    }, briefAbort.signal);
    await loadAiStatus(true);
  } catch (e) {
    if (!text) out.innerHTML = `<div class="callout warn">${esc(e.message)}</div>`;
    st.textContent = e.message;
  } finally { out.classList.remove("cursor"); think.hidden = true; btn.disabled = false; $("briefStop").hidden = true; busy = false; }
}

function renderChat() {
  $("chatLog").innerHTML = chat.length
    ? chat.map((m, i) => {
      if (m.role === "user") return `<div class="msg user">${esc(m.content).replace(/\n/g, "<br>")}</div>`;
      const live = m.pending && i === chat.length - 1;
      const body = md(m.content) || `<span class="ai-status" style="margin:0"><span class="spin"></span>${esc(m.status || "Düşünüyor…")}${m.secs ? ` · ${m.secs} sn` : ""}</span>`;
      return `<div class="msg bot ${live && m.content ? "cursor" : ""}">${body}${live && m.think && !m.content ? `<div class="think">…${esc(m.think)}</div>` : ""}</div>`;
    }).join("")
    : `<p class="note">Portföyünüz, planınız, haberler ya da bu haftanın verileri hakkında soru sorun. Claude güncel sinyalleri, piyasa nabzını, ekonomik takvimi ve önemli haberleri bağlam olarak görür.</p>`;
  $("chatLog").scrollTop = $("chatLog").scrollHeight;
}

let chatAbort;
async function ask(q) {
  q = q.trim();
  if (!q) return;
  if (busy) { toast("Claude şu an başka bir yanıt üzerinde çalışıyor; bitmesini bekleyin ya da Durdur'a basın."); return; }
  busy = true;
  $("chatSend").disabled = true;
  $("chatStop").hidden = false;
  chatAbort = new AbortController();
  const history = chat.filter((m) => !m.error && m.content).map(({ role, content }) => ({ role, content }));
  chat.push({ role: "user", content: q });
  const bot = { role: "assistant", content: "", pending: true, status: "Gönderiliyor…" };
  chat.push(bot);
  renderChat();
  try {
    await streamPost("/api/ai/ask", { question: q, history, strategy: $("aiStrategy").value, webSearch: $("webSearch").checked }, (m) => {
      if (m.t === "text") bot.content += m.v;
      else if (m.t === "thinking") bot.think = m.v;
      else if (m.t === "tick") bot.secs = m.s;
      else if (m.t === "status") bot.status = m.v;
      else if (m.t === "error") { bot.content = `**Hata:** ${m.v}`; bot.error = true; }
      renderChat();
    }, chatAbort.signal);
    if (!bot.content) { bot.content = "_Claude boş yanıt döndürdü; soruyu yeniden deneyin._"; bot.error = true; }
  } catch (e) { bot.content = (bot.content ? bot.content + "\n\n" : "") + `**${e.message === "Durduruldu." ? "Durduruldu." : "Hata: " + e.message}**`; bot.error = true; }
  finally { bot.pending = false; renderChat(); $("chatSend").disabled = false; $("chatStop").hidden = true; busy = false; saveChat(); }
}

function saveChat() { store.set("ai.chat", JSON.stringify(chat.filter((m) => !m.pending).slice(-20))); }

function showBrief(b) {
  const today = new Date().toDateString() === new Date(b.at).toDateString();
  $("briefOut").innerHTML = md(b.text);
  const hrs = Math.round((Date.now() - Date.parse(b.at)) / 3_600_000);
  $("briefStatus").innerHTML = `Brifing · ${esc(new Date(b.at).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" }))} (${hrs < 1 ? "az önce" : hrs < 24 ? hrs + " saat önce" : Math.round(hrs / 24) + " gün önce"})${today ? "" : `<span class="stale">Bugüne ait değil — yenisini oluşturun</span>`}`;
  $("briefMeta").textContent = metaLine(b.meta);
}

let AI;
async function loadAiStatus(afterRun = false) {
  AI = await api("/api/ai/status");
  $("aiStatus").innerHTML = `<div class="sig"><small>Model</small><b>${esc(AI.model)}</b></div><div class="sig"><small>Durum</small><b class="${AI.configured ? "pos" : ""}">${AI.configured ? "Hazır" : "Anahtar gerekli"}</b></div>`;
  $("aiSetup").innerHTML = AI.configured ? "" : `<div class="callout warn setup"><b>Claude'u etkinleştirmek için bir kez:</b><ol>
    <li><a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">console.anthropic.com</a> adresinden bir API anahtarı oluşturun.</li>
    <li><code>ozgurluk-rotasi/.env</code> dosyasına <code>ANTHROPIC_API_KEY=sk-ant-...</code> satırını ekleyin (Git'e girmez).</li>
    <li>Sunucuyu yeniden başlatın (<code>npm run web</code>). Her brifing/soru, API hesabınızdan küçük bir ücretle faturalanır.</li></ol></div>`;
  const briefs = AI.briefs || [];
  $("briefHistory").innerHTML = briefs.length
    ? briefs.map((b, i) => `<option value="${esc(b.id)}">${i === 0 ? "En yeni · " : ""}${esc(new Date(b.at).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" }))}${b.webSearch ? " · web" : ""}</option>`).join("")
    : `<option value="">Henüz brifing yok</option>`;
  $("briefHistory").onchange = async () => {
    const id = $("briefHistory").value;
    if (!id) return;
    try { showBrief(await api(`/api/ai/briefs?id=${encodeURIComponent(id)}`)); } catch (e) { toast(esc(e.message)); }
  };
  if (!afterRun && AI.lastBrief) showBrief(AI.lastBrief);
  if (afterRun) $("briefHistory").value = briefs[0]?.id ?? "";
}

// ------------------------------------------------------------------ ekonomik takvim
let ECON;
let econCur = store.get("econ.cur") || "";
const TR_TIME = (iso) => new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
const TR_DAY = (iso) => new Date(iso).toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Istanbul" });
const dayKey = (iso) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });

function renderEcon() {
  if (!ECON) return;
  $("econLead").innerHTML = `Piyasalarda en yüksek volatiliteyi yaratması beklenen veri açıklamaları ve merkez bankası kararları. Saatler Türkiye saatiyle. <span class="note">Kaynak: ${esc(ECON.sourceNote)}</span>`;
  const curs = [...new Set(ECON.events.map((e) => e.currency))];
  $("econCur").innerHTML = [["", "Tümü"], ...curs.map((c) => [c, c])].map(([k, v]) => `<button data-k="${k}" aria-selected="${k === econCur}">${esc(v)}</button>`).join("");
  document.querySelectorAll("#econCur button").forEach((b) => (b.onclick = () => { econCur = b.dataset.k; store.set("econ.cur", econCur); renderEcon(); }));
  const now = Date.now();
  const evs = ECON.events.filter((e) => !econCur || e.currency === econCur);
  const next = ECON.events.find((e) => Date.parse(e.time) > now);
  if (next) {
    const mins = Math.round((Date.parse(next.time) - now) / 60000);
    $("nextEvent").innerHTML = `<small class="note">Sıradaki veri</small><b>${esc(next.currency)} · ${esc(next.title)}</b><span>${TR_DAY(next.time)} ${TR_TIME(next.time)} · ${mins < 60 ? mins + " dk" : mins < 1440 ? Math.floor(mins / 60) + " sa " + (mins % 60) + " dk" : Math.round(mins / 1440) + " gün"} sonra</span>`;
  } else $("nextEvent").innerHTML = `<small class="note">Bu hafta başka 3 yıldızlı veri yok.</small>`;
  if (!evs.length) { $("econList").innerHTML = `<p class="note">${ECON.source === "none" ? esc(ECON.sourceNote) : "Bu filtrede veri yok."}</p>`; return; }
  const today = dayKey(new Date().toISOString());
  const byDay = new Map();
  for (const e of evs) { const k = dayKey(e.time); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); }
  $("econList").innerHTML = [...byDay.entries()].map(([k, list]) => `<div class="econ-day ${k === today ? "today" : ""}"><h3>${TR_DAY(list[0].time)}</h3>${list.map((e, i) => {
    const t = Date.parse(e.time);
    const cls2 = t < now ? "past" : t - now < 2 * 3_600_000 ? "soon" : "";
    const surprise = e.actual && e.forecast ? (parseFloat(e.actual) > parseFloat(e.forecast) ? "pos" : parseFloat(e.actual) < parseFloat(e.forecast) ? "neg" : "") : "";
    return `<div class="ev ${cls2}" style="animation-delay:${i * 25}ms"><span class="tm">${TR_TIME(e.time)}</span><span class="cur">${esc(e.currency)}<small>${esc(e.country)}</small></span><span class="ti">${esc(e.title)}<span class="stars" title="Yüksek önem">★★★</span></span>
      <span class="num"><small>Gerçekleşen</small><b class="${surprise}">${esc(e.actual || "—")}</b></span><span class="num"><small>Beklenti</small>${esc(e.forecast || "—")}</span><span class="num"><small>Önceki</small>${esc(e.previous || "—")}</span></div>`;
  }).join("")}</div>`).join("");
}

async function loadEcon(force = false) {
  try { ECON = await api(`/api/econ${force ? "?refresh=1" : ""}`); renderEcon(); }
  catch (e) { $("econList").innerHTML = `<div class="callout warn">Ekonomik takvim alınamadı: ${esc(e.message)}</div>`; }
}

// ------------------------------------------------------------------ başlatma
(async () => {
  reveal();
  const h = await api("/api/health").catch(() => null);
  if (!h?.features?.includes("briefs")) {
    $("staleBanner").innerHTML = `<div class="banner"><b>Panel sunucusu eski sürüm çalışıyor ya da kapalı.</b> Terminalde <code>npm run web</code>'i <b>Ctrl+C</b> ile durdurup yeniden başlatın (ya da <code>baslat-windows.bat</code>'a çift tıklayın).</div>`;
    return;
  }
  $("aiStrategy").value = store.get("panel.alStrategy") || "static";
  $("aiStrategy").onchange = () => store.set("panel.alStrategy", $("aiStrategy").value);
  $("webSearch").checked = store.get("ai.web") === "1";
  $("webSearch").onchange = () => store.set("ai.web", $("webSearch").checked ? "1" : "0");
  $("briefBtn").onclick = runBrief;
  $("chatForm").onsubmit = (e) => { e.preventDefault(); const q = $("chatInput").value; $("chatInput").value = ""; ask(q); };
  $("chatInput").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("chatForm").requestSubmit(); } };
  const SUGGEST = ["Bu ayki $1.000'ı planıma göre dağıtırken dikkat etmem gereken bir gelişme var mı?", "Yaklaşan Fed kararı portföyümü nasıl etkiler?", "BTC ve altının trendi neden 'yarım'?", "Son haberlere göre en büyük risk hangi varlığımda?"];
  $("suggest").innerHTML = SUGGEST.map((q) => `<button>${esc(q)}</button>`).join("");
  document.querySelectorAll("#suggest button").forEach((b) => (b.onclick = () => ask(b.textContent)));
  $("newsSearch").oninput = () => { shown = 30; renderNews(); };
  $("moreNews").onclick = () => { shown += 30; renderNews(); };
  $("newsRefresh").onclick = () => loadNews(true).then(() => toast("Haberler yenilendi."));
  $("briefStop").onclick = () => briefAbort?.abort();
  $("chatStop").onclick = () => chatAbort?.abort();
  $("chatClear").onclick = () => { if (busy) return; chat = []; saveChat(); renderChat(); };
  $("autoBrief").checked = store.get("ai.autoBrief") === "1";
  $("autoBrief").onchange = () => store.set("ai.autoBrief", $("autoBrief").checked ? "1" : "0");
  try { chat = JSON.parse(store.get("ai.chat") || "[]"); } catch { chat = []; }
  renderFilters();
  renderChat();
  await Promise.allSettled([loadPulse(), loadNews(), loadEcon(), loadAiStatus()]);
  // Günlük otomatik brifing: bugün henüz oluşturulmadıysa ve Claude yapılandırılmışsa
  if ($("autoBrief").checked && AI?.configured && (!AI.lastBrief || new Date(AI.lastBrief.at).toDateString() !== new Date().toDateString())) runBrief();
  setInterval(renderEcon, 60_000);
  setInterval(() => loadEcon().catch(() => {}), 30 * 60_000);
  setInterval(() => loadPulse().catch(() => {}), 5 * 60_000);
  setInterval(() => loadNews().catch(() => {}), 10 * 60_000);
  setInterval(renderNews, 60_000); // "x dk önce" etiketleri
})();
