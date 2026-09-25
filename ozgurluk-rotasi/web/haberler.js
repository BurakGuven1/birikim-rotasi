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

/** NDJSON akışını okur; her satırda onLine çağrılır. */
async function streamPost(path, body, onLine) {
  // Portföy sunucuda değil bu tarayıcıda durur; Claude'un görmesi için isteğe eklenir.
  const send = () => fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-ai-code": store.get("ai.code") || "" }, body: JSON.stringify({ ...body, transactions: PfStore.load() }) });
  let r = await send();
  if (r.status === 401) {
    const code = prompt("Claude analisti kullanmak için erişim anahtarınızı girin:");
    if (!code) throw new Error("Erişim anahtarı girilmedi.");
    store.set("ai.code", code.trim());
    r = await send();
    if (r.status === 401) store.set("ai.code", "");
  }
  if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onLine(JSON.parse(line));
    }
  }
}

const metaLine = (m) => m ? `${m.model} · ${m.usage.input.toLocaleString("tr-TR")} girdi / ${m.usage.output.toLocaleString("tr-TR")} çıktı token${m.usage.cacheRead ? ` · ${m.usage.cacheRead.toLocaleString("tr-TR")} önbellekten` : ""}${m.webSearches ? ` · ${m.webSearches} web araması` : ""}` : "";

async function runBrief() {
  if (busy) return;
  busy = true;
  const out = $("briefOut"), st = $("briefStatus"), btn = $("briefBtn");
  btn.disabled = true;
  let text = "";
  out.innerHTML = "";
  out.classList.add("cursor");
  st.innerHTML = `<span class="spin"></span><span>Başlıyor…</span>`;
  try {
    await streamPost("/api/ai/brief", { strategy: $("aiStrategy").value, webSearch: $("webSearch").checked }, (m) => {
      if (m.t === "text") { text += m.v; out.innerHTML = md(text); }
      else if (m.t === "status") st.innerHTML = `<span class="spin"></span><span>${esc(m.v)}</span>`;
      else if (m.t === "error") { out.innerHTML = `<div class="callout warn">${esc(m.v)}</div>`; st.textContent = ""; }
      else if (m.t === "done") { store.set("ai.lastBrief", JSON.stringify({ at: new Date().toISOString(), text, meta: m.meta })); st.textContent = `Hazır · ${new Date().toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" })}`; $("briefMeta").textContent = metaLine(m.meta); }
    });
  } catch (e) {
    out.innerHTML = `<div class="callout warn">${esc(e.message)}</div>`;
    st.textContent = "";
  } finally { out.classList.remove("cursor"); btn.disabled = false; busy = false; }
}

function renderChat() {
  $("chatLog").innerHTML = chat.length
    ? chat.map((m, i) => `<div class="msg ${m.role === "user" ? "user" : "bot"} ${m.pending && i === chat.length - 1 ? "cursor" : ""}">${m.role === "user" ? esc(m.content).replace(/\n/g, "<br>") : md(m.content) || `<span class="note">${esc(m.status || "…")}</span>`}</div>`).join("")
    : `<p class="note">Portföyünüz, planınız ya da haberler hakkında soru sorun. Claude güncel sinyalleri, piyasa nabzını ve önemli haberleri bağlam olarak görür.</p>`;
  $("chatLog").scrollTop = $("chatLog").scrollHeight;
}

async function ask(q) {
  if (busy || !q.trim()) return;
  busy = true;
  $("chatSend").disabled = true;
  const history = chat.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
  chat.push({ role: "user", content: q });
  const bot = { role: "assistant", content: "", pending: true, status: "Düşünüyor…" };
  chat.push(bot);
  renderChat();
  try {
    await streamPost("/api/ai/ask", { question: q, history, strategy: $("aiStrategy").value, webSearch: $("webSearch").checked }, (m) => {
      if (m.t === "text") bot.content += m.v;
      else if (m.t === "status") bot.status = m.v;
      else if (m.t === "error") { bot.content = `**Hata:** ${m.v}`; bot.error = true; }
      renderChat();
    });
  } catch (e) { bot.content = `**Hata:** ${e.message}`; bot.error = true; }
  finally { bot.pending = false; renderChat(); $("chatSend").disabled = false; busy = false; }
}

async function loadAiStatus() {
  const s = await api("/api/ai/status", { headers: { "x-ai-code": store.get("ai.code") || "" } });
  // Son brifing sunucuda değil bu tarayıcıda saklanır (portföy bilgisi içerebilir)
  try { s.lastBrief = JSON.parse(store.get("ai.lastBrief") || "null"); } catch { s.lastBrief = null; }
  $("aiStatus").innerHTML = `<div class="sig"><small>Model</small><b>${esc(s.model)}</b></div><div class="sig"><small>Durum</small><b class="${s.configured ? "pos" : ""}">${s.configured ? "Hazır" : "Anahtar gerekli"}</b></div>`;
  $("aiSetup").innerHTML = s.configured ? "" : `<div class="callout warn setup"><b>Claude'u etkinleştirmek için bir kez:</b><ol>
    <li><a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">console.anthropic.com</a> adresinden bir API anahtarı oluşturun.</li>
    <li>Yerelde: <code>ozgurluk-rotasi/.env</code> dosyasına <code>ANTHROPIC_API_KEY=sk-ant-...</code> satırını ekleyip sunucuyu yeniden başlatın (<code>npm run web</code>).</li>
    <li>Netlify'da: Project configuration → Environment variables'a aynı değişkeni ekleyip yeniden deploy edin. Her brifing/soru, API hesabınızdan küçük bir ücretle faturalanır.</li></ol></div>`;
  if (s.lastBrief) {
    $("briefOut").innerHTML = md(s.lastBrief.text);
    $("briefStatus").textContent = `Son brifing · ${new Date(s.lastBrief.at).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" })}`;
    $("briefMeta").textContent = metaLine(s.lastBrief.meta);
  }
}

// ------------------------------------------------------------------ başlatma
(async () => {
  reveal();
  const h = await api("/api/health").catch(() => null);
  if (!h?.features?.includes("news")) {
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
  renderFilters();
  renderChat();
  await Promise.allSettled([loadPulse(), loadNews(), loadAiStatus()]);
  setInterval(() => loadPulse().catch(() => {}), 5 * 60_000);
  setInterval(() => loadNews().catch(() => {}), 10 * 60_000);
  setInterval(renderNews, 60_000); // "x dk önce" etiketleri
})();
