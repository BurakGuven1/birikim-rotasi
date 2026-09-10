'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, CircleStop, Loader2, Play, RefreshCw, ShieldAlert, Square } from 'lucide-react';
import type { EthSettings, EthSnapshot } from '@/lib/bot/eth-config';
import '@/features/bot/bot.css';
import './eth.css';

const number = (value: number | null | undefined, digits = 2) => value == null || Number.isNaN(value) ? '—' : value.toLocaleString('tr-TR', { maximumFractionDigits: digits });
const clock = (value: number | null | undefined) => value ? new Date(value).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const closeReason: Record<string, string> = { stop: 'Stop', target: 'Kâr hedefi', end: 'Dönem sonu', emergency: 'Acil kapatma', reversal: 'Ters yapı', timeout: 'Süre sınırı (100 mum)', stagnation: 'Duraklama' };

async function request(path: string, init: RequestInit = {}, retry = true): Promise<unknown> {
  const response = await fetch(`/api/bot/${path}`, { ...init, cache: 'no-store', headers: { 'Content-Type': 'application/json' } });
  if (response.status === 401 && retry) {
    await request('session', { method: 'POST', body: '{}', signal: init.signal }, false);
    return request(path, init, false);
  }
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof (value as { error?: unknown })?.error === 'string' ? (value as { error: string }).error : `İstek tamamlanamadı (${response.status}).`);
  return value;
}

/**
 * Everything standing between this bot and a real order, in the order it has to be cleared.
 *
 * A switch that says "on" above a bot that cannot trade is the single most expensive thing a panel
 * like this can show, so each blocker names its own reason rather than leaving the operator to
 * infer it from a quiet log.
 */
function blockers(snapshot: EthSnapshot): string[] {
  const list: string[] = [];
  const state = snapshot.state;
  if (!snapshot.enabled) list.push('Bot durdurulmuş: yeni giriş açılmaz. Açık pozisyon varsa stop takibi yine de sürer.');
  if (!snapshot.worker.online) list.push('Bot süreci çevrimdışı: 15m kapanışları izlenmiyor. Başlat düğmesi süreci de açar.');
  if (snapshot.settings.mode !== 'live') list.push('Paper modu: kararlar burada görünür, OKX hesabına emir gitmez. Ayarlardan İcra modunu Canlı yapın.');
  else if (!snapshot.credentials.configured) list.push(`Canlı mod seçili ama API anahtarı eksik: ${snapshot.credentials.missing.join(', ')}. .env.local dosyasına ekleyip uygulamayı yeniden başlatın.`);
  if (state?.exchange?.foreign) list.push('Hesapta bota ait olmayan bir ETH pozisyonu var; bot ona dokunmaz ve kapanana kadar yeni işlem açmaz.');
  if (state?.lastError) list.push(state.lastError);
  return list;
}

function Toggle({ snapshot, pending, command }: { snapshot: EthSnapshot; pending: boolean; command: (body: object, success?: string) => void }) {
  const running = snapshot.enabled;
  return <div className="bot-actions">
    <button type="button" className={running ? 'button' : 'button primary'} disabled={pending}
      onClick={() => command({ action: 'enabled', enabled: !running }, running ? 'ETH botu durduruldu.' : 'ETH botu çalışıyor.')}>
      {running ? <><Square size={16} />Durdur</> : <><Play size={16} />Başlat</>}
    </button>
    <button type="button" className="button" disabled={pending} onClick={() => command({ action: 'cycle' }, 'Kontrol istendi.')}><RefreshCw size={16} />Şimdi kontrol et</button>
    <button type="button" className="button danger" disabled={pending}
      onClick={() => { if (confirm('Açık ETH pozisyonu piyasa emriyle kapatılacak ve tüm koruma emirleri iptal edilecek. Devam edilsin mi?')) command({ action: 'emergency' }, 'Acil kapatma istendi.'); }}>
      <CircleStop size={16} />Acil kapat
    </button>
  </div>;
}

const fields = [
  ['leverage', 'Kaldıraç', 1, 10, 1],
  ['equityPercent', 'Kullanılan bakiye (%)', 1, 100, 1],
  ['maxNotionalUsdt', 'Azami pozisyon büyüklüğü (USDT)', 10, 1_000_000, 10],
  ['minEquityUsdt', 'Asgari bakiye (USDT)', 5, 100_000, 1],
  ['commissionPercent', 'Komisyon (%)', 0, 1, .01],
  ['slippageTicks', 'Kayma (tick)', 0, 20, 1],
] as const;

function SettingsForm({ snapshot, pending, command }: { snapshot: EthSnapshot; pending: boolean; command: (body: object, success?: string) => void }) {
  const [draft, setDraft] = useState<EthSettings>(snapshot.settings);
  const saved = useRef(snapshot.settings);
  useEffect(() => { if (JSON.stringify(saved.current) !== JSON.stringify(snapshot.settings)) { saved.current = snapshot.settings; setDraft(snapshot.settings); } }, [snapshot.settings]);
  const locked = snapshot.enabled || !!snapshot.state?.openTrade;
  const submit = (event: FormEvent) => { event.preventDefault(); command({ action: 'settings', settings: draft }, 'Ayarlar kaydedildi.'); };
  return <form className="eth-settings" onSubmit={submit}>
    <div className="bot-section-heading"><div><h3>Ayarlar</h3><p>Botu durdurmadan ve pozisyon açıkken değiştirilemez.</p></div></div>
    <div className="eth-settings-grid">
      <label className="field">İcra modu
        <select className="input" value={draft.mode} disabled={locked} onChange={e => setDraft({ ...draft, mode: e.target.value as EthSettings['mode'] })}>
          <option value="paper">Paper · emir gönderilmez</option>
          <option value="live">Canlı · gerçek OKX hesabına emir gönderilir</option>
        </select>
      </label>
      <label className="field">Yön
        <select className="input" value={draft.direction} disabled={locked} onChange={e => setDraft({ ...draft, direction: e.target.value as EthSettings['direction'] })}>
          <option value="long">Sadece long</option>
          <option value="short">Sadece short</option>
          <option value="both">Her iki yön</option>
        </select>
      </label>
      {fields.map(([key, label, min, max, step]) => <label className="field" key={key}>{label}
        <input className="input" type="number" min={min} max={max} step={step} required disabled={locked}
          value={draft[key]} onChange={e => setDraft({ ...draft, [key]: Number(e.target.value) })} />
      </label>)}
    </div>
    {draft.mode === 'live' && <p className="eth-warning"><ShieldAlert size={15} />Canlı modda bu bot gerçek paranızla, {draft.leverage}× kaldıraçla, en fazla {number(draft.maxNotionalUsdt, 0)} USDT büyüklüğünde pozisyon açar. Stop borsada durur ama kayıp gerçektir.</p>}
    <button className="button primary" type="submit" disabled={pending || locked}>Ayarları kaydet</button>
  </form>;
}

function AccountCard({ snapshot }: { snapshot: EthSnapshot }) {
  const exchange = snapshot.state?.exchange;
  if (snapshot.settings.mode !== 'live') return <div className="panel eth-card"><h3>Gerçek OKX hesabı</h3><p className="bot-empty">Paper modunda hesap okunmaz. İcra modunu Canlı yapınca bakiye, pozisyon ve emirler burada görünür.</p></div>;
  if (!exchange) return <div className="panel eth-card"><h3>Gerçek OKX hesabı</h3><p className="bot-empty">Hesap henüz okunmadı. Bot süreci açıldığında ilk turda gelir.</p></div>;
  const position = exchange.position;
  return <div className="panel eth-card">
    <h3>Gerçek OKX hesabı</h3>
    <div className="eth-metrics">
      <div><span className="metric-label">USDT bakiye</span><p>{number(exchange.balanceUsdt)}</p><small>kullanılabilir</small></div>
      <div><span className="metric-label">Açık pozisyon</span><p>{position ? `${number(position.contracts, 4)} kontrat` : 'Yok'}</p><small>{position ? (position.direction === 'long' ? 'Long' : 'Short') : 'düz'}</small></div>
      <div><span className="metric-label">Anlık K/Z</span><p className={position?.unrealizedPnl == null ? '' : position.unrealizedPnl > 0 ? 'bot-positive' : position.unrealizedPnl < 0 ? 'bot-negative' : ''}>{position ? number(position.unrealizedPnl) : '—'}</p><small>USDT · gerçekleşmemiş</small></div>
      <div><span className="metric-label">Likidasyon</span><p>{position ? number(position.liquidationPrice) : '—'}</p><small>{position?.leverage ? `${number(position.leverage, 0)}× · teminat ${number(position.margin)}` : 'pozisyon yok'}</small></div>
    </div>
    {position && <p className="bot-small">Giriş {number(position.entryPrice)} · mark {number(position.markPrice)}</p>}
    <h4>Borsada bekleyen koruma emirleri</h4>
    {!exchange.algos.length ? <p className="bot-empty">Bekleyen emir yok.</p> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Tür</th><th>Tetik</th><th>Kontrat</th><th>Durum</th></tr></thead><tbody>
      {exchange.algos.map(algo => <tr key={algo.algoId}><td>{algo.kind === 'stop' ? 'Stop' : 'Kâr hedefi'}</td><td>{number(algo.trigger)}</td><td>{number(algo.contracts, 4)}</td><td>{algo.state}</td></tr>)}
    </tbody></table></div>}
    <h4>Son gerçekleşen işlemler (OKX)</h4>
    {!exchange.fills.length ? <p className="bot-empty">Bu sözleşmede kayıtlı dolum yok.</p> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Zaman</th><th>Yön</th><th>Fiyat</th><th>Kontrat</th><th>K/Z</th><th>Komisyon</th></tr></thead><tbody>
      {exchange.fills.map((fill, index) => <tr key={`${fill.orderId}:${fill.time}:${index}`}>
        <td>{clock(fill.time)}</td><td>{fill.side === 'buy' ? 'Alış' : 'Satış'}</td><td>{number(fill.price)}</td><td>{number(fill.contracts, 4)}</td>
        <td className={fill.pnl == null ? '' : fill.pnl > 0 ? 'bot-positive' : fill.pnl < 0 ? 'bot-negative' : ''}>{number(fill.pnl)}</td><td>{number(fill.fee, 4)}</td>
      </tr>)}
    </tbody></table></div>}
  </div>;
}

function ModelCard({ snapshot }: { snapshot: EthSnapshot }) {
  const decision = snapshot.state?.decision;
  if (!decision) return <div className="panel eth-card"><h3>Modelin durumu</h3><p className="bot-empty">Henüz karar üretilmedi. Başlat düğmesine basın; ilk tur bir dakika içinde tamamlanır.</p></div>;
  const state = decision.state;
  const pending = state.pending;
  return <div className="panel eth-card">
    <h3>Modelin durumu</h3>
    <p className="bot-small">Karar {clock(state.barTime)} 15m mumunun kapanışına ait · ETH {number(state.close)} · pencere {decision.window.bars} mum, içinde {decision.window.trades} işlem.</p>
    {state.position ? <>
      <div className="eth-metrics">
        <div><span className="metric-label">Model pozisyonu</span><p>{state.position.direction === 'long' ? 'Long' : 'Short'}</p><small>giriş {number(state.position.entry)}</small></div>
        <div><span className="metric-label">Güncel stop</span><p>{number(state.position.stop)}</p><small>{state.position.beActive ? 'başabaşa çekildi' : `ilk stop ${number(state.position.initialStop)}`}</small></div>
        <div><span className="metric-label">Hedefler</span><p>{number(state.position.tp1)}</p><small>{state.position.partialFilled ? 'TP1 alındı · runner takipte' : `TP1 %${number(state.position.tp1Fraction * 100, 0)} · TP2 ${number(state.position.tp2)}`}</small></div>
        <div><span className="metric-label">Süre</span><p>{state.position.barsInTrade} mum</p><small>100 mumda süre sınırı</small></div>
      </div>
    </> : <p className="eth-idle">Pozisyon yok. Bu mumda giriş olmama nedeni: <strong>{state.blocked ?? 'kural sağlandı'}</strong>. Son çıkıştan bu yana {state.barsSinceExit > 900 ? 'uzun süre' : `${state.barsSinceExit} mum`} geçti.</p>}
    {pending && <p className="eth-pending">{pending.kind === 'entry'
      ? <>Sıradaki mumda <strong>{pending.direction === 'long' ? 'LONG' : 'SHORT'} giriş</strong> · stop {number(pending.stop)} · TP1 {number(pending.tp1)} · TP2 {number(pending.tp2)}</>
      : <>Sıradaki mumda <strong>kapatma</strong> · {closeReason[pending.reason] ?? pending.reason}</>}</p>}
    <h4>Bu pencerede girişi en çok engelleyen kurallar</h4>
    <ul className="eth-blocked">{decision.blocked.slice(0, 6).map(item => <li key={item.reason}><span>{item.reason}</span><b>{item.count}</b></li>)}</ul>
    {decision.warnings.map(warning => <p className="bot-small" key={warning}>{warning}</p>)}
  </div>;
}

export function EthBotDesk() {
  const [snapshot, setSnapshot] = useState<EthSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // The poll owns itself: one request in flight at a time, rescheduled from its own completion so
  // a slow exchange read cannot stack up behind a fixed interval.
  const refresh = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let fetching = false;
    async function poll() {
      if (fetching || abort.signal.aborted) return;
      fetching = true; clearTimeout(timer);
      try {
        const next = await request('eth/status', { signal: abort.signal }) as EthSnapshot;
        if (!abort.signal.aborted) { setSnapshot(next); setError(null); }
      } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Durum okunamadı; yeniden deneniyor.'); }
      finally { fetching = false; if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 5_000); }
    }
    refresh.current = poll;
    timer = setTimeout(() => void poll(), 0);
    return () => { abort.abort(); clearTimeout(timer); };
  }, []);

  const command = useCallback((body: object, success?: string) => {
    setPending(true); setNotice(null);
    void (async () => {
      try { await request('eth/command', { method: 'POST', body: JSON.stringify(body) }); setNotice(success ?? 'Tamam.'); setError(null); await refresh.current(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'Komut tamamlanamadı.'); }
      finally { setPending(false); }
    })();
  }, []);

  if (!snapshot) return <div className="bot-workspace"><p className="bot-empty"><Loader2 size={16} className="eth-spin" /> ETH bot durumu yükleniyor…</p></div>;
  const list = blockers(snapshot);
  const live = snapshot.settings.mode === 'live';

  return <div className="bot-workspace eth-workspace">
    <header className="bot-header">
      <div>
        <p className="eyebrow">ETH BOT</p>
        <h1>ETH Momentum Breakout · 15m</h1>
        <p className="bot-mode">{snapshot.instrument} · sadece bu strateji, sadece bu sözleşme · {live ? 'CANLI hesap' : 'paper'}</p>
      </div>
      <div className="bot-header-controls">
        <Toggle snapshot={snapshot} pending={pending} command={command} />
        <span className={snapshot.worker.online ? 'bot-status online' : 'bot-status'}><i />{snapshot.worker.online ? 'Süreç çalışıyor' : 'Süreç kapalı'} · son tur {clock(snapshot.state?.cycleAt)}</span>
      </div>
    </header>

    {error && <div className="bot-feedback bot-negative" role="alert"><span><AlertTriangle size={15} /> {error}</span></div>}
    {notice && <div className="bot-feedback" role="status"><span>{notice}</span></div>}

    {list.length > 0 && <div className="panel eth-card eth-blockers">
      <h3>Şu anda gerçek emir gönderilmesini engelleyenler</h3>
      <ul>{list.map(item => <li key={item}>{item}</li>)}</ul>
    </div>}

    {snapshot.enabled && live && !list.length && <div className="bot-feedback" role="status">
      <span><strong>Bot açık ve canlı.</strong> Kural sağlandığı anda, siz hiçbir şey yapmadan, OKX hesabınızda pozisyon açar; stop ve kâr hedefleri aynı anda borsaya yazılır.</span>
    </div>}

    <div className="eth-columns">
      <AccountCard snapshot={snapshot} />
      <ModelCard snapshot={snapshot} />
    </div>

    <div className="panel eth-card">
      <h3>Bot günlüğü</h3>
      {!snapshot.events.length ? <p className="bot-empty">Kayıt yok.</p> : <ul className="eth-log">
        {snapshot.events.map(event => <li key={event.id} className={`eth-log-${event.level}`}><span>{clock(event.time)}</span>{event.message}</li>)}
      </ul>}
    </div>

    <div className="panel eth-card"><SettingsForm snapshot={snapshot} pending={pending} command={command} /></div>

    <div className="bot-method">
      <p><strong>Bu botun kuralları.</strong> Günlük EMA200 uzaklığı ve volatilite rejimi uygunsa, 1H EMA50 trendi teyit ediyorsa ve fiyat son 6 mum içinde biten bir Bollinger/Keltner sıkışmasından hacimli ve gövdeli bir mumla çıkıyorsa giriş açar. Stop ATR×2, ilk hedef ATR×1.5&apos;te pozisyonun yarısı, kalan kısım ATR×3.5 hedefi ya da takip eden stopla yönetilir; 1.2 ATR kârda stop başabaşa çekilir, 100 mumda süre sınırı ve 10 mumda duraklama çıkışı vardır. Rejime göre bu çarpanlar ölçeklenir.</p>
      <p><strong>Dürüst sınırlar.</strong> Karar yalnızca kapanmış 15m mumlarda üretilir; emirler kapanıştan hemen sonra piyasa emriyle gider, yani testteki &ldquo;sonraki mum açılışı&rdquo; ile fiili dolum arasında fark olur. Stop borsada mark fiyatıyla tetiklenir, model ise mum düşük/yüksek değerine bakar; bu ikisi zaman zaman ayrışır. Fonlama maliyeti modelde hesaplanmaz, gerçek sonucu düşürür. Bilgisayar kapalıyken hiçbir şey çalışmaz — açık pozisyonu yalnızca borsadaki stop korur.</p>
    </div>
  </div>;
}
