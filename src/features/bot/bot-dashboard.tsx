'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, LockKeyhole, Radio, ScanLine, Settings2 } from 'lucide-react';
import type { BotSnapshot } from '@/lib/bot/dashboard-types';
import { BotLivePanel, tradingBlockers } from './bot-live-panel';
import type { BacktestResult, BotSettings, Position } from '@/lib/bot/types';
import './bot.css';

const number = (value: number | null | undefined, digits = 2) => value == null ? '—' : value.toLocaleString('tr-TR', { maximumFractionDigits: digits });
const time = (value: number | null | undefined) => value ? new Date(value).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const coin = (value: string) => value.replace('-USDT-SWAP', '');
// The most liquid OKX USDT perpetuals, so the operator does not have to type twenty tickers.
const TOP_COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'BNB', 'LTC', 'LINK', 'AVAX', 'TRX', 'DOT', 'BCH', 'NEAR', 'UNI', 'FIL', 'APT', 'ARB', 'OP', 'ATOM'];
const rowKey = (row: BacktestResult) => `${row.instrument}:${row.entryInterval ?? '15m'}:${row.strategy}`;
const modelName = (row: BacktestResult) => row.strategy.split('@')[0].replace(/ (15m|1H|4H)$/, '');
const reasons = { stop: 'Stop', target: 'Kâr hedefi', end: 'Dönem sonu', emergency: 'Acil kapatma', reversal: 'Ters yapı', timeout: 'Süre sınırı', stagnation: 'Duraklama' };
const primaryFields = [
  ['initialEquity', 'Sermaye (USDT)', 10, 1000000, 1], ['fixedRiskUsdt', 'Stop maliyeti (USDT)', 1, 500, 1],
  ['riskPercentFloor', 'Risk tabanı (%)', .1, 5, .1], ['riskPercent', 'Risk tavanı (%)', .1, 5, .1],
  ['totalRiskPercent', 'Toplam risk (%)', .1, 25, .1], ['maxPositions', 'Azami pozisyon', 1, 4, 1],
  ['leverage', 'Kaldıraç', 5, 10, 1], ['minRewardRisk', 'Asgari net getiri / risk', 1, 10, .1],
] as const;
const otherFields = [
  ['dailyLossPercent', 'Günlük kayıp sınırı (%)', .5, 20, .1], ['minVolumeUsdt', 'Asgari hacim (USDT)', 0, 1e12, 100000],
  ['maxSpreadBps', 'Azami spread (bp)', 1, 100, 1], ['scanLimit', 'Tarama sınırı', 1, 50, 1],
  ['feeBps', 'Komisyon (bp)', 0, 100, .1], ['slippageBps', 'Kayma (bp)', 0, 100, .1],
  ['fundingBufferBps', 'Fonlama tamponu (bp)', 0, 100, .1], ['maxMarginPercent', 'Azami teminat (%)', 5, 50, 1],
] as const;

async function request(path: string, init: RequestInit = {}, retry = true): Promise<unknown> {
  const response = await fetch(`/api/bot/${path}`, { ...init, cache: 'no-store', headers: { 'Content-Type': 'application/json' } });
  if (response.status === 401 && retry && path !== 'session') {
    await request('session', { method: 'POST', body: '{}', signal: init.signal }, false);
    return request(path, init, false);
  }
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof value?.error === 'string' ? value.error : `İstek tamamlanamadı (${response.status}). Yeniden deneyin.`);
  return value;
}

function PositionTable({ positions }: { positions: Position[] }) {
  if (!positions.length) return <p className="bot-empty">Bu bölümde henüz işlem yok.</p>;
  return <div className="table-wrap"><table className="data-table bot-trades"><thead><tr><th>Coin / yön</th><th>Giriş</th><th>Çıkış</th><th>Çıkış nedeni</th><th>Net K/Z (USDT)</th><th>Ayrıntı</th></tr></thead><tbody>{[...positions].sort((a, b) => b.openedAt - a.openedAt).map(p => <tr key={p.id}>
    <td><strong>{coin(p.instrument.id)}</strong><small>{p.direction === 'long' ? 'Long' : 'Short'} · {p.entryInterval ?? '15m'}</small></td>
    <td>{number(p.entry, 6)}<small>{time(p.openedAt)}</small></td>
    <td>{p.closedAt ? number(p.exits.at(-1)?.price, 6) : 'Açık'}<small>{time(p.closedAt)}</small></td>
    <td>{p.closedAt && p.exits.length ? reasons[p.exits.at(-1)!.reason] : 'İzleniyor'}</td>
    <td className={p.realizedPnl > 0 ? 'bot-positive' : p.realizedPnl < 0 ? 'bot-negative' : ''}>{number(p.realizedPnl)}</td>
    <td><details><summary>İşlem detayları</summary><div className="bot-trade-detail"><p>Model: {p.model ?? '—'}</p><p>İlk stop: {number(p.initialStop, 6)} · Güncel stop: {number(p.stop, 6)}</p>{p.targets.map((target, i) => <p key={i}>TP{i + 1}: {number(target.price, 6)} · %{number(target.fraction * 100)} · {target.filled ? 'Gerçekleşti' : 'Bekliyor'}</p>)}<p>Miktar: {number(p.quantity, 6)} · Kalan: {number(p.remaining, 6)}</p>{p.exits.map((exit, i) => <p key={i}>{time(exit.time)} · {reasons[exit.reason]} · {number(exit.price, 6)} · miktar {number(exit.quantity, 6)}</p>)}<p>Komisyon: {number(p.fees)} · Fonlama: {number(p.funding)} USDT (net sonuca dahil)</p></div></details></td>
  </tr>)}</tbody></table></div>;
}


function PortfolioPanel({ snapshot, coins, setCoins, busy, pending, command }: {
  snapshot: BotSnapshot; coins: number; setCoins: (value: number) => void; busy: boolean; pending: boolean;
  command: (body: object, success?: string) => Promise<void>;
}) {
  const study = snapshot.portfolio;
  const forward = study?.walkForward;
  const best = study?.grid.slice().sort((a, b) => b.metrics.returnPercent - a.metrics.returnPercent).slice(0, 5) ?? [];
  return <>
    <div className="bot-section-heading"><div><h2>Kesitsel momentum</h2><p>Tek coini zamanlamaz: her gün evreni sıralar, en güçlüleri long, en zayıfları short tutar.</p></div>
      <span className="bot-tag">{study ? `${study.coins.length} coin` : 'çalıştırılmadı'}</span></div>
    <form className="bot-compare-form" onSubmit={event => { event.preventDefault(); void command({ action: 'portfolio', coins, days: 365 }); }}>
      <label className="field">Evren büyüklüğü<input className="input" type="number" min={10} max={60} required value={coins} onChange={e => setCoins(Number(e.target.value))} /></label>
      <label className="field">Dönem<input className="input" value="365 gün" readOnly /></label>
      <button className="button primary" disabled={pending || busy}><ArrowUpRight size={17} />{busy ? 'Çalışıyor…' : 'Çalıştır'}</button>
    </form>
    {!study ? <p className="bot-empty">Çalıştırın; günlük kapanışlarla 365 günlük yürüyen doğrulama yaklaşık bir dakikada tamamlanır.</p> : <>
      <div className="bot-portfolio-headline">
        <div><span className="metric-label">Dış-örnek getiri</span><p className={forward && forward.returnPercent > 0 ? 'bot-positive' : 'bot-negative'}>{forward ? `%${number(forward.returnPercent, 1)}` : '—'}</p><small>{forward ? `${forward.days} gün` : 'ölçülemedi'}</small></div>
        <div><span className="metric-label">Sharpe</span><p>{forward ? number(forward.sharpe) : '—'}</p><small>yıllıklandırılmış</small></div>
        <div><span className="metric-label">Azami düşüş</span><p>{forward ? `%${number(forward.maxDrawdownPercent, 1)}` : '—'}</p><small>gün sonu bazında</small></div>
        <div><span className="metric-label">Günlük devir</span><p>{forward ? `%${number(forward.averageTurnoverPercent, 1)}` : '—'}</p><small>maliyet buradan çıkar</small></div>
      </div>
      {study.sensitivity.length > 1 && (() => {
        const values = study.sensitivity.map(row => row.metrics.returnPercent);
        const low = Math.min(...values), high = Math.max(...values);
        return <div className="bot-feedback bot-negative" role="note"><span><strong>Bu sayıya güvenmeyin.</strong> Aynı kural yalnızca evren büyüklüğü değiştirilerek %{number(low, 1)} ile %{number(high, 1)} arasında sonuç veriyor: {study.sensitivity.map(row => `${row.universe} coin: %${number(row.metrics.returnPercent, 1)}`).join(' · ')}. Bu genişlik, sonucun birkaç aşırı hareket eden coin tarafından belirlendiğini ve tahminin kararsız olduğunu gösterir.</span></div>;
      })()}
      <p className="bot-small">Bu getiri <strong>yürüyen doğrulamadan</strong> gelir: her ayın parametresi yalnızca kendinden önceki 180 günden seçilir, geleceğe bakılmaz. Aşağıdaki ızgara duyarlılık içindir, seçim gerekçesi değildir.</p>
      {study.current && <div className="bot-allocation"><div><span className="metric-label">Bugünkü long</span><p>{study.current.longs.map(coin).join(', ') || '—'}</p></div><div><span className="metric-label">Bugünkü short</span><p>{study.current.shorts.map(coin).join(', ') || '—'}</p></div></div>}
      {!!best.length && <div className="table-wrap"><table className="data-table"><thead><tr><th>Momentum penceresi</th><th>Pozisyon</th><th>Tüm dönem</th><th>Sharpe</th><th>Azami düşüş</th></tr></thead><tbody>
        {best.map(row => <tr key={`${row.lookbackDays}/${row.positions}`}><td>{row.lookbackDays} gün</td><td>{row.positions} long / {row.positions} short</td><td className={row.metrics.returnPercent > 0 ? 'bot-positive' : 'bot-negative'}>%{number(row.metrics.returnPercent, 1)}</td><td>{number(row.metrics.sharpe)}</td><td>%{number(row.metrics.maxDrawdownPercent, 1)}</td></tr>)}
      </tbody></table></div>}
      <details className="bot-method"><summary>Yöntem, sınırlar ve atlanan coinler</summary>
        <p>Günlük kapanışlarla yeniden dengelenir; funding dahildir, maliyet {number(study.costRate * 10_000, 1)} bp olarak uygulanır. {time(study.from)} – {time(study.to)}.</p>
        <p>Evren bugünkü likit kontratlardan seçildiği için hayatta kalma yanlılığı vardır. Gün içi fiyat yolu modellenmez. Gerçek emirler kilitlidir.</p>
        {!!study.skipped.length && <p>Yetersiz geçmiş nedeniyle atlanan: {study.skipped.join(', ')}</p>}
      </details>
    </>}
  </>;
}

export function BotDashboard() {
  const [snapshot, setSnapshot] = useState<BotSnapshot | null>(null);
  const [settings, setSettings] = useState<BotSettings | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [tab, setTab] = useState<'backtest' | 'portfolio' | 'live'>('live');
  const [coins, setCoins] = useState('BTC, ETH, SOL, XRP, ADA');
  const coinList = coins.split(',').map(value => value.trim()).filter(Boolean);
  const [days, setDays] = useState(1095);
  const [portfolioCoins, setPortfolioCoins] = useState(45);
  const [selected, setSelected] = useState('');
  const [modelFilter, setModelFilter] = useState('all');
  const controller = useRef<AbortController | null>(null);
  const refreshNow = useRef<() => void>(() => {});
  const lastCommand = useRef<object | null>(null);
  useEffect(() => {
    const abort = new AbortController(); controller.current = abort;
    let timer: ReturnType<typeof setTimeout>;
    let fetching = false;
    async function refresh() {
      if (fetching || abort.signal.aborted) return;
      fetching = true; clearTimeout(timer); let active = false;
      try {
        const next = await request('status', { signal: abort.signal }) as BotSnapshot;
        active = next.progress?.state === 'running' || next.jobs.some(job => job.status === 'queued' || job.status === 'running');
        if (!abort.signal.aborted) { setSnapshot(next); setSettings(current => current ?? next.settings); }
      } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Bağlantı kurulamadı; yeniden deneniyor.'); }
      finally { fetching = false; if (!abort.signal.aborted) timer = setTimeout(() => void refresh(), active ? 1500 : 5000); }
    }
    refreshNow.current = () => void refresh();
    void refresh();
    return () => { abort.abort(); clearTimeout(timer); };
  }, []);
  async function command(body: object, success = 'İstek alındı; ilerleme burada güncellenecek.') {
    if (pending) return;
    lastCommand.current = body; setPending(true); setError(''); setNotice('');
    try {
      await request('command', { method: 'POST', body: JSON.stringify(body), signal: controller.current?.signal });
      setNotice(success); refreshNow.current();
    } catch (cause) { if (!controller.current?.signal.aborted) setError(cause instanceof Error ? cause.message : 'İstek tamamlanamadı.'); }
    finally { setPending(false); }
  }
  const busy = !!snapshot?.jobs.some(job => job.status === 'queued' || job.status === 'running');
  const settingsLocked = !!snapshot && (snapshot.enabled || snapshot.paper.positions.length > 0 || busy);
  const sourceRows = snapshot?.comparison?.rows ?? snapshot?.backtests ?? [];
  const rows = sourceRows.filter((row, index) => sourceRows.findIndex(item => rowKey(item) === rowKey(row)) === index).sort((a, b) => {
    const am = a.validation?.development ?? a.metrics, bm = b.validation?.development ?? b.metrics;
    return Number(bm.trades > 0) - Number(am.trades > 0) || bm.netPnl - am.netPnl || a.instrument.localeCompare(b.instrument);
  });
  const visible = rows.filter(row => modelFilter === 'all' || modelName(row).startsWith(modelFilter));
  const result = visible.find(row => rowKey(row) === selected) ?? visible[0];
  const progress = snapshot?.progress;
  const currentJob = snapshot?.jobs.find(job => job.status === 'running' || job.status === 'queued');
  const latestJob = snapshot?.jobs[0];
  const failedJob = latestJob && (latestJob.status === 'failed' || latestJob.status === 'blocked') ? latestJob : null;
  const failureMessage = failedJob?.result && typeof failedJob.result === 'object' && 'message' in failedJob.result ? String(failedJob.result.message) : 'İstek tamamlanamadı; yeniden deneyin.';
  function compare(event: FormEvent) {
    event.preventDefault();
    const instruments = [...new Set(coins.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).map(s => s.endsWith('-USDT-SWAP') ? s : `${s}-USDT-SWAP`))];
    if (!instruments.length || instruments.length > 20 || instruments.some(s => !/^[A-Z0-9]+-USDT-SWAP$/.test(s))) { setError('Virgülle ayırarak 1–20 coin girin; örneğin BTC, ETH, SOL.'); return; }
    void command({ action: 'comparison', instruments, days });
  }
  function field([key, label, min, max, step]: readonly [keyof BotSettings, string, number, number, number]) {
    return <label className="field" key={key}>{label}<input className="input" type="number" required min={min} max={max} step={step} value={typeof settings![key] === 'number' && !Number.isNaN(settings![key]) ? settings![key] as number : ''} onChange={event => setSettings({ ...settings!, [key]: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>;
  }
  return <div className="bot-workspace">
    <header className="bot-header"><div><p className="eyebrow">OKX · STRATEJİ LABORATUVARI</p><h1>Trading bot</h1>{snapshot?.settings.executionMode === 'live'
        ? <p className="bot-mode bot-mode-live"><Radio size={13} /> CANLI · gerçek para{snapshot.settings.liveVerified ? '' : ' · doğrulama aşaması (asgari kontrat)'}</p>
        : <p className="bot-mode"><LockKeyhole size={13} /> Paper · gerçek emirler kapalı</p>}</div><div className="bot-header-controls"><span className={`bot-status ${snapshot?.worker.online ? 'online' : ''}`}><i />{!snapshot ? 'Bağlanıyor' : !snapshot.worker.online ? 'Worker çevrimdışı' : busy ? 'Çalışıyor' : snapshot.enabled ? 'Otomatik tarama açık' : 'Hazır · otomatik tarama kapalı'}</span><div className="bot-actions"><button className="button secondary small" disabled={pending || !snapshot} onClick={() => void command({ action: 'enabled', enabled: !snapshot?.enabled })}>{snapshot?.enabled ? 'Duraklat' : 'Otomatik başlat'}</button><button className="button secondary small" disabled={pending || busy || !snapshot} onClick={() => void command({ action: 'scan' })}><ScanLine size={15} /> Tara</button></div><small>Son bağlantı {time(snapshot?.worker.heartbeat)}</small></div></header>
    {error && <div className="bot-feedback bot-negative" role="alert"><span>{error}</span><button className="button secondary small" disabled={pending} onClick={() => { setError(''); if (lastCommand.current) void command(lastCommand.current); else refreshNow.current(); }}>Yeniden dene</button></div>}
    {!snapshot || !settings ? <p className="bot-empty" role="status">Bot durumu yükleniyor…</p> : <>
      {(progress || currentJob || notice) && <div className="bot-progress" role="status" aria-live="polite"><div><span>{currentJob?.status === 'queued' ? 'Sırada · ' : ''}{progress?.message ?? notice ?? 'İşleniyor'}</span><small>{progress ? `${progress.current} / ${progress.total} · ${time(progress.updatedAt)}` : 'Worker isteği işleyecek'}</small></div>{progress && progress.total > 0 && <progress max={progress.total} value={progress.current} aria-label="İş ilerlemesi" />}{(busy || progress?.state === 'running') && <button className="button danger small" disabled={pending} onClick={() => void command({ action: 'cancel' }, 'Çalışan işler durduruldu.')}>Durdur</button>}{!snapshot.worker.online && <button className="button secondary small" disabled={pending} onClick={() => void command({ action: 'worker' })}>Worker başlat</button>}</div>}
      {failedJob && <div className="bot-feedback bot-negative" role="alert"><span>{failureMessage}</span><button className="button secondary small" disabled={pending || busy} onClick={() => void command({ ...failedJob.input, action: failedJob.kind })}>İsteği yeniden dene</button></div>}
      <section className="card bot-verdict">
        <div className="bot-verdict-head"><h2>Bot ne çalıştırıyor?</h2><span className={`bot-tag bot-verdict-tag${snapshot.settings.executionMode === 'live' ? ' is-live' : ''}`}>{snapshot.settings.executionMode === 'live' ? `Canlı · gerçek emir${snapshot.settings.liveVerified ? '' : ' · doğrulama boyutu'}` : 'Kağıt üzerinde · emir gönderilmez'}</span></div>
        <p><strong>Efloud Beast {snapshot.live.interval}, yalnızca {snapshot.live.instruments.map(coin).join(', ')}.</strong> Ondört koşul puanlanır, üst zaman dilimi yönü ve rejim filtresi geçilirse girer; çıkış kademelidir — %40 birinci hedefte, %40 modelin ölçtüğü range sınırında, %20 takip stoplu runner. Üç yıllık OKX verisinde 231 işlem, kâr faktörü 1,27, kazanma %55,0. Ayrılmış üçte birlik dönem de artı (77 işlem, PF 1,31).</p>
        <p>Bu <strong>henüz kanıt değil</strong>: ayrılmış örneklem 100 işlem eşiğinin, kazanma oranı %60 eşiğinin altında ve azami düşüş %20,7 ile %10 sınırını aşıyor. Aynı model ETH üzerinde para kaybettiği için evren tek sözleşmede tutuluyor.</p>
        <p className="bot-verdict-risk">Hesap {number(snapshot.settings.initialEquity)} USDT · {snapshot.settings.riskMode === 'fixed' ? `her stop ${number(snapshot.settings.fixedRiskUsdt)} USDT'ye mal olur, pozisyon buna göre boyutlanır` : `işlem riski %${number(Math.min(snapshot.settings.riskPercentFloor, snapshot.settings.riskPercent))}–%${number(snapshot.settings.riskPercent)} güvene göre`} · kaldıraç {snapshot.settings.leverage}× · en çok {snapshot.settings.maxPositions} pozisyon · günlük kayıp sınırı %{number(snapshot.settings.dailyLossPercent)}.</p>
      </section>
      <div className="bot-tabs" role="tablist" aria-label="Bot görünümü"><button id="live-tab" role="tab" aria-selected={tab === 'live'} aria-controls="bot-panel" onClick={() => setTab('live')}>Bot işlemleri <span>{tradingBlockers(snapshot).length ? `${tradingBlockers(snapshot).length} engel` : snapshot.paper.positions.length ? `${snapshot.paper.positions.length} açık` : 'çalışıyor'}</span></button><button id="backtest-tab" role="tab" aria-selected={tab === 'backtest'} aria-controls="bot-panel" onClick={() => setTab('backtest')}>Backtest <span>{rows.length || 'MPA · SuperTrend'}</span></button><button id="portfolio-tab" role="tab" aria-selected={tab === 'portfolio'} aria-controls="bot-panel" onClick={() => setTab('portfolio')}>Kesitsel <span>{snapshot.portfolio?.walkForward ? `%${number(snapshot.portfolio.walkForward.returnPercent, 1)}` : 'test edilmedi'}</span></button></div>
      <section id="bot-panel" role="tabpanel" aria-labelledby={`${tab}-tab`} className="card bot-main-panel">
        {tab === 'live' ? <BotLivePanel snapshot={snapshot} pending={pending} command={command} /> : tab === 'portfolio' ? <PortfolioPanel snapshot={snapshot} coins={portfolioCoins} setCoins={setPortfolioCoins} busy={busy} pending={pending} command={command} /> : <>
          <div className="bot-section-heading"><div><h2>Coin × zaman dilimi</h2><p>Aynı dönemde iki strateji × üç giriş dilimi karşılaştırılır; işlemleri görmek için bir satır seçin.</p></div></div>
          <form className="bot-compare-form" onSubmit={compare}><label className="field">Coinler<input className="input" value={coins} onChange={e => setCoins(e.target.value)} required placeholder="BTC, ETH, SOL" /></label><label className="field">Gün<input className="input" type="number" min={7} max={1095} required value={days} onChange={e => setDays(Number(e.target.value))} /></label><button className="button primary" disabled={pending || busy || !snapshot.strategy}><ArrowUpRight size={17} />{busy ? 'Çalışıyor…' : 'Karşılaştır'}</button></form>
          <div className="bot-quickfill"><button type="button" className="button secondary small" disabled={pending || busy} onClick={() => setCoins(TOP_COINS.join(', '))}>En likit 20 coini doldur</button><small>{coinList.length} coin × 3 strateji × 1H = {coinList.length * 3} backtest{coinList.length > 3 ? ` · yaklaşık ${Math.round(coinList.length * 2.5)} dakika` : ''}</small></div>
          {rows.length > 6 && <div className="bot-filters">
            {[['all', 'Tüm modeller'], ['Efloud', 'Efloud'], ['SuperTrend', 'SuperTrend'], ['MPA + Trend', 'MPA + Trend']].map(([value, label]) =>
              <button key={value} type="button" className={`bot-chip ${modelFilter === value ? 'is-active' : ''}`} aria-pressed={modelFilter === value} onClick={() => setModelFilter(value)}>{label}</button>)}
            <small>{visible.length} / {rows.length} satır</small>
          </div>}
          {visible.length ? <><div className="bot-table-caption"><span>Geliştirme net K/Z sıralaması ↓ · Gösterilen metrikler tüm dönem</span><span>{time(snapshot.comparison?.from ?? result?.from)} – {time(snapshot.comparison?.to ?? result?.to)}</span></div><div className="table-wrap"><table className="data-table bot-comparison"><thead><tr><th>Coin / giriş</th><th>Model</th><th>İşlem</th><th>Kazanma</th><th>Net K/Z (USDT)</th><th title="Kâr faktörü">PF</th><th>Azami düşüş</th><th>Örneklem</th></tr></thead><tbody>{visible.map(row => { const m = row.metrics; return <tr key={rowKey(row)} className={result === row ? 'is-selected' : ''} onClick={() => setSelected(rowKey(row))}><td><button className="bot-row-button" aria-pressed={result === row} onClick={() => setSelected(rowKey(row))}><strong>{coin(row.instrument)}</strong><span>{row.entryInterval ?? '15m'}</span></button></td><td className="bot-model-cell">{modelName(row)}</td><td>{m.trades || 'İşlem yok'}</td><td>{m.trades ? `${number(m.winRate)}%` : '—'}</td><td className={m.trades ? m.netPnl > 0 ? 'bot-positive' : m.netPnl < 0 ? 'bot-negative' : '' : ''}>{m.trades ? number(m.netPnl) : '—'}</td><td>{m.trades ? number(m.profitFactor) : '—'}</td><td>{m.trades ? `${number(m.maxDrawdownPercent)}%` : '—'}</td><td><span className="bot-sample">{!m.trades ? 'Örnek yok' : m.trades < 100 ? 'Sınırlı örnek' : 'Geçmiş simülasyon'}</span></td></tr>; })}</tbody></table></div></> : <p className="bot-empty">Karşılaştırmayı başlatın; her coin için Efloud, SuperTrend ve MPA + Trend modellerinin 1H sonuçları burada oluşacak.</p>}
          {!!snapshot.comparison?.errors.length && <details className="bot-method"><summary>{snapshot.comparison.errors.length} coin tamamlanamadı</summary>{snapshot.comparison.errors.map(item => <p key={item.instrument}>{coin(item.instrument)}: {item.message}</p>)}<button className="button secondary small" disabled={busy || pending} onClick={() => void command({ action: 'comparison', instruments: [...new Set([...snapshot.comparison!.rows.map(item => item.instrument), ...snapshot.comparison!.errors.map(item => item.instrument)])], days })}>Karşılaştırmayı yeniden dene</button></details>}
          {result && <div className="bot-selected-trades"><div className="bot-section-heading"><div><p className="eyebrow">SEÇİLİ SONUÇ</p><h3>{coin(result.instrument)} <span> / {modelName(result)} · {result.entryInterval ?? '15m'}</span></h3></div><span className="bot-tag">{result.trades.length} işlem</span></div><PositionTable positions={result.trades} /><details className="bot-method"><summary>Yöntem, maliyetler ve test ayrımı</summary><p>{result.strategy} · Sermaye {number(result.settings.initialEquity)} USDT · Risk %{number(result.settings.riskPercent)} · Kaldıraç {result.settings.leverage}×. Komisyon {result.settings.feeBps} bp, kayma {result.settings.slippageBps} bp; fonlama net sonuca dahildir.</p><p>Sıralama geliştirme dönemini kullanır (yoksa tüm dönem); coin seçimi bağımsız doğrulama değildir. Geçmiş simülasyon gelecekteki başarıyı garanti etmez.</p>{result.validation && <p>Ayrılmış test: {result.validation.holdout.trades ? `${result.validation.holdout.trades} işlem · net ${number(result.validation.holdout.netPnl)} USDT · kazanma %${number(result.validation.holdout.winRate)}` : 'İşlem yok; başarı oranı ölçülemedi.'}</p>}{result.diagnostics && <p>Ham sinyal: {result.diagnostics.signals} · Elenen: {Object.entries(result.diagnostics.rejected).map(([reason, count]) => `${reason} (${count})`).join(', ') || 'Yok'}</p>}<ul>{[...new Set(result.warnings)].map(warning => <li key={warning}>{warning}</li>)}</ul></details></div>}
        </>}
      </section>
      <details className="card bot-settings"><summary><Settings2 size={16} /> Ayarlar ve çalışma ayrıntıları <span>{snapshot.settings.initialEquity} USDT · %{snapshot.settings.riskPercent} risk · {snapshot.settings.maxPositions} pozisyon</span></summary><form onSubmit={event => { event.preventDefault(); if (!settingsLocked) void command({ action: 'settings', settings }, 'Ayarlar kaydedildi.'); }}>{settingsLocked && <p className="bot-small">Ayarları değiştirmek için otomatik taramayı durdurun ve açık işlemlerin tamamlanmasını bekleyin.</p>}<fieldset disabled={pending || settingsLocked} className="bot-fields">{primaryFields.map(field)}<label className="field">Risk modu<select className="input" value={settings.riskMode} onChange={e => setSettings({ ...settings, riskMode: e.target.value as BotSettings['riskMode'] })}><option value="fixed">Sabit · her stop aynı USDT&apos;ye mal olur</option><option value="percent">Yüzde · risk bakiyeyle büyür ve küçülür</option></select></label><label className="field">Giriş zaman dilimi<select className="input" value={settings.entryInterval} onChange={e => setSettings({ ...settings, entryInterval: e.target.value as BotSettings['entryInterval'] })}><option value="auto">Otomatik · 1H (tek işlem gören varyant)</option><option>1H</option></select></label><label className="field">İcra modu<select className="input" value={settings.executionMode} onChange={e => {
              const next = e.target.value as BotSettings['executionMode'];
              // Switching to real money is a deliberate act, so it is confirmed and never silent.
              if (next === 'live' && !window.confirm(`Gerçek para ile işlem açılacak. Hesap ${number(snapshot.settings.initialEquity)} USDT, ${settings.riskMode === 'fixed' ? `her stop ${number(settings.fixedRiskUsdt)} USDT'ye mal olacak` : `işlem riski bakiyenin %${number(settings.riskPercentFloor)}–%${number(settings.riskPercent)}'i`}, kaldıraç ${settings.leverage}×.\n\nAyrılmış test pozitif ama doğrulama eşiklerini geçmiyor: örneklem 100 işlemin altında, kazanma oranı %60'ın altında, azami düşüş %10 sınırını aşıyor. Kâr edeceği kanıtlanmamıştır. Devam edilsin mi?`)) return;
              setSettings({ ...settings, executionMode: next, liveVerified: next === 'live' ? settings.liveVerified : false });
            }}><option value="paper">Paper · emir gönderilmez</option><option value="live">Canlı · gerçek para</option></select></label>{settings.executionMode === 'live' && <label className="field">Canlı emir boyutu<select className="input" value={settings.liveVerified ? 'planned' : 'proving'} onChange={e => {
              const verified = e.target.value === 'planned';
              // Leaving the proving phase multiplies every order. It is allowed only once a real
              // trade has opened, carried its exchange stop and closed, because that is the only
              // evidence the whole order chain works on this account.
              if (verified && !window.confirm('Emirler artık hesaplanan tam boyutta gönderilecek.\n\nBunu yalnızca en az bir canlı işlem açılıp borsada stopunu taşıyıp kapandıysa seçin. Asgari boyutta kademeli kâr emirleri borsaya konulamaz; tam boyutta konulur.')) return;
              setSettings({ ...settings, liveVerified: verified });
            }}><option value="proving">Doğrulama · borsanın asgari kontratı</option><option value="planned">Planlanan boyut · risk ayarına göre</option></select></label>}</fieldset><details className="bot-method"><summary>Maliyetler ve tarama filtreleri</summary><fieldset disabled={pending || settingsLocked} className="bot-fields">{otherFields.map(field)}</fieldset></details><button className="button secondary small" disabled={pending || settingsLocked}>Ayarları kaydet</button></form><div className="bot-runtime"><h3>Son tarama</h3><p>{snapshot.scan ? `${time(snapshot.scan.time)} · ${snapshot.scan.total} sözleşme incelendi · ${snapshot.scan.instruments.length} uygun · ${snapshot.scan.signals.length} sinyal` : 'Henüz tarama yapılmadı.'}</p>{snapshot.scan?.signals.map((signal, i) => <p key={i}>{coin(signal.instrument)} · {signal.direction} · {signal.reason}</p>)}{snapshot.scan?.warnings.map((warning, i) => <p key={i}>{warning}</p>)}<h3>Bağlantı</h3><div className="bot-actions">{(['demo', 'live'] as const).map(mode => <button className="button secondary small" key={mode} disabled={pending} onClick={() => void command({ action: 'connection', mode })}>{mode === 'demo' ? 'Demo' : 'Gerçek hesap'} bağlantısını denetle</button>)}</div>{latestJob && <p>Son istek: {latestJob.kind} · {latestJob.status}{latestJob.result != null && <span> · {typeof latestJob.result === 'object' && 'message' in latestJob.result ? String(latestJob.result.message) : 'Sonuç kaydedildi'}</span>}</p>}<details className="bot-method"><summary>Son olaylar</summary>{snapshot.events.slice(0, 8).map(event => <p key={event.id}>{time(event.time)} · {event.message}</p>)}</details></div></details>
    </>}
  </div>;
}
