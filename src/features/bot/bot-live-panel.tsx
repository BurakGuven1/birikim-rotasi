'use client';

import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, CircleDot, Play } from 'lucide-react';
import { CandlestickChart, type ChartLevel, type ChartTrade } from '@/features/market/candlestick-chart';
import type { BotSnapshot } from '@/lib/bot/dashboard-types';
import type { BacktestResult, Position } from '@/lib/bot/types';
import type { PricePoint } from '@/lib/domain/types';

const number = (value: number | null | undefined, digits = 2) => value == null || Number.isNaN(value) ? '—' : value.toLocaleString('tr-TR', { maximumFractionDigits: digits });
const time = (value: number | null | undefined) => value ? new Date(value).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const coin = (value: string) => value.replace('-USDT-SWAP', '');
const exitReason = { stop: 'Stop', target: 'Kâr hedefi', end: 'Dönem sonu', emergency: 'Acil kapatma', reversal: 'Ters yapı', timeout: 'Süre sınırı', stagnation: 'Duraklama' };
/** What each exchange intent state means for the operator, in the order the machine walks them. */
const intentState: Record<string, string> = {
  prepared: 'Hazırlandı · borsaya gitmedi', submitted: 'Borsaya gönderildi · dolum bekleniyor',
  unknown: 'Sonuç belirsiz · mutabakat sürüyor', partial: 'Kısmi dolum · koruma kuruluyor',
  protected: 'Açık · stop ve kademeli hedefler borsada', closed: 'Kapandı · pozisyon düz',
  rejected: 'Borsa reddetti · pozisyon açılmadı', critical: 'KRİTİK · borsadan elle kontrol edin',
};

export interface Blocker { text: string; label?: string; command?: object }

/**
 * Everything standing between the bot and a real order, in the order it has to be cleared.
 *
 * The panel used to leave this implicit, which made a bot that was simply switched off look
 * identical to one that had found no setup. Each entry names the reason and, where the panel can
 * clear it in one click, carries the command that does.
 */
export function tradingBlockers(snapshot: BotSnapshot): Blocker[] {
  const blockers: Blocker[] = [];
  const { settings, paper } = snapshot;
  if (!snapshot.worker.online) blockers.push({ text: 'Worker çevrimdışı: tarama döngüsü hiç çalışmıyor, mum kapanışları izlenmiyor.', label: 'Worker başlat', command: { action: 'worker' } });
  if (!snapshot.enabled) blockers.push({ text: 'Otomatik tarama kapalı: açık pozisyon takip edilir ama yeni pozisyon açılmaz.', label: 'Otomatik başlat', command: { action: 'enabled', enabled: true } });
  if (settings.executionMode !== 'live') blockers.push({ text: 'Paper modu: kararlar defterde tutulur, borsaya emir gönderilmez. Ayarlar bölümünden İcra modunu değiştirin.' });
  else if (!snapshot.credentials.live.configured) blockers.push({ text: `Canlı mod seçili ama API anahtarı eksik: ${snapshot.credentials.live.missing.join(', ')}.` });
  if (paper.dailyHalted) blockers.push({ text: `Günlük kayıp sınırına ulaşıldı (%${number(settings.dailyLossPercent)}); yeni girişler yarına kadar durduruldu.` });
  if (paper.positions.length >= settings.maxPositions) blockers.push({ text: `Açık pozisyon sınırı dolu (${paper.positions.length}/${settings.maxPositions}).` });
  return blockers;
}

/** Unrealised result of an open position at the last price the panel knows about. */
function openPnl(position: Position, last: number | undefined) {
  if (!last || !Number.isFinite(last)) return null;
  const sign = position.direction === 'long' ? 1 : -1;
  return position.realizedPnl + position.remaining * (last - position.entry) * sign;
}

/**
 * One trade told as the sequence it actually was: where it got in, what it risked, and every
 * partial that came off along the way. A flat row of entry and final exit hides the whole point of
 * a staged plan — that the first target pays for the stop and the rest is played with house money.
 */
function TradeStory({ position }: { position: Position }) {
  const sign = position.direction === 'long' ? 1 : -1;
  const risk = Math.abs(position.entry - position.initialStop);
  const reward = (price: number) => risk > 0 ? (price - position.entry) * sign / risk : null;
  const moved = position.stop !== position.initialStop;
  return <li className="bot-story">
    <div className="bot-story-head">
      <strong>{coin(position.instrument.id)} · {position.direction === 'long' ? 'Long' : 'Short'}</strong>
      <span>{time(position.openedAt)} → {time(position.closedAt)}</span>
      <span className={position.realizedPnl > 0 ? 'bot-positive' : position.realizedPnl < 0 ? 'bot-negative' : ''}>{position.realizedPnl > 0 ? '+' : ''}{number(position.realizedPnl)} USDT</span>
    </div>
    <ol className="bot-story-steps">
      <li><b>Giriş</b> {number(position.entry, 6)} · stop {number(position.initialStop, 6)} · 1R = {number(risk, 6)}</li>
      {position.exits.map((item, index) => <li key={index}>
        <b>{exitReason[item.reason]}</b> {number(item.price, 6)} · pozisyonun %{number(item.quantity / position.quantity * 100, 0)}&apos;i
        {reward(item.price) === null ? '' : ` · ${number(reward(item.price)!, 2)}R`} · <span className={item.pnl > 0 ? 'bot-positive' : item.pnl < 0 ? 'bot-negative' : ''}>{item.pnl > 0 ? '+' : ''}{number(item.pnl)} USDT</span>
        {index === 0 && moved && position.exits.length > 1 && <em> — ardından stop {number(position.stop, 6)} seviyesine çekildi</em>}
      </li>)}
    </ol>
  </li>;
}

export function BotLivePanel({ snapshot, pending, command }: { snapshot: BotSnapshot; pending: boolean; command: (body: object, success?: string) => void }) {
  const { settings, paper, scan, live } = snapshot;
  const blockers = tradingBlockers(snapshot);
  const bars = useMemo(() => scan?.candles?.bars ?? [], [scan?.candles?.bars]);
  const last = bars.at(-1)?.close;

  const points = useMemo<PricePoint[]>(() => bars.map(bar => ({ date: new Date(bar.time).toISOString(), open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume })), [bars]);
  const instrument = scan?.candles?.instrument;
  const history = useMemo(() => [...paper.trades, ...paper.positions].filter(position => position.instrument.id === instrument), [paper.trades, paper.positions, instrument]);
  // Entry and every partial exit are marked, so a scaled-out trade reads as the staged plan it is.
  const marks = useMemo<ChartTrade[]>(() => history.flatMap(position => {
    const entrySide = position.direction === 'long' ? 'buy' as const : 'sell' as const;
    return [{ date: new Date(position.openedAt).toISOString(), type: entrySide, quantity: position.quantity },
      ...position.exits.map(item => ({ date: new Date(item.time).toISOString(), type: entrySide === 'buy' ? 'sell' as const : 'buy' as const, quantity: item.quantity }))];
  }), [history]);
  // The bot's own closed trades, newest first. Five is enough to read the pattern without turning
  // the panel into a ledger.
  const own = useMemo(() => [...paper.trades].sort((a, b) => b.openedAt - a.openedAt).slice(0, 5), [paper.trades]);
  // Until it has five of its own, the same model's most recent backtest trades stand in as the
  // worked example. Matched on the exact strategy id the bot reports, never on a label.
  const sample = useMemo<{ trades: Position[]; run: BacktestResult } | null>(() => {
    if (own.length >= 5 || !snapshot.strategy) return null;
    const runs = [...(snapshot.comparison?.rows ?? []), ...snapshot.backtests]
      .filter((run: BacktestResult) => run.strategy.startsWith(`${snapshot.strategy!.id}@`) && live.instruments.includes(run.instrument) && run.trades.length);
    const best = runs.sort((a, b) => b.trades.length - a.trades.length)[0];
    return best ? { run: best, trades: [...best.trades].sort((a, b) => b.openedAt - a.openedAt).slice(0, 5 - own.length) } : null;
  }, [own.length, snapshot.strategy, snapshot.comparison, snapshot.backtests, live.instruments]);
  const openHere = paper.positions.find(position => position.instrument.id === instrument);
  const levels = useMemo<ChartLevel[]>(() => !openHere ? [] : [
    { price: openHere.entry, title: 'Giriş' },
    { price: openHere.stop, title: 'Stop', color: '#c2414b' },
    ...openHere.targets.map((target, index) => ({ price: target.price, title: `TP${index + 1}${target.filled ? ' ✓' : ''}`, color: '#087a61' })),
  ], [openHere]);

  return <>
    <div className="bot-section-heading"><div><h2>Bot işlemleri</h2>
      <p>{live.model === 'efloud' ? 'Efloud Beast' : live.model} {live.interval} · {live.instruments.map(coin).join(', ')} · {settings.riskMode === 'fixed' ? `her stop ${number(settings.fixedRiskUsdt)} USDT` : `risk %${number(settings.riskPercent)}`} · {settings.leverage}× · {settings.executionMode === 'live' ? `CANLI${settings.liveVerified ? '' : ' · doğrulama boyutu'}` : 'paper'}</p></div>
      <button className="button danger small" disabled={pending || !paper.positions.length} onClick={() => command({ action: 'emergency' })}>{settings.executionMode === 'live' ? 'Borsada hepsini kapat' : 'Pozisyonları kapat'}</button></div>

    <div className="bot-blockers">
      {blockers.length
        ? blockers.map((blocker, index) => <div key={index} className="bot-blocker"><AlertTriangle size={15} /><span>{blocker.text}</span>{blocker.command && <button className="button secondary small" disabled={pending} onClick={() => command(blocker.command!)}>{blocker.label}</button>}</div>)
        : <div className="bot-blocker is-clear"><CheckCircle2 size={15} /><span>Bot çalışıyor. {live.interval} mumu her kapandığında {live.instruments.map(coin).join(', ')} taranıyor; kurulum çıkarsa pozisyon kendiliğinden açılır. Son döngü {time(paper.lastCycle)}.</span></div>}
      {!blockers.length && !paper.positions.length && <p className="bot-small">Şu an açık pozisyon yok — bu normaldir. Model üç yılda 231 işlem açtı, yani ortalama beş günde bir; çoğu mumda kurulum yoktur.</p>}
    </div>

    <h3>Açık pozisyon</h3>
    {paper.positions.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Coin / yön</th><th>Giriş</th><th>Stop</th><th>Hedefler</th><th>Kalan</th><th>Anlık K/Z</th></tr></thead><tbody>{paper.positions.map(position => {
      const pnl = openPnl(position, position.instrument.id === instrument ? last : undefined);
      return <tr key={position.id}>
        <td><strong>{coin(position.instrument.id)}</strong><small>{position.direction === 'long' ? 'Long' : 'Short'} · {time(position.openedAt)}</small></td>
        <td>{number(position.entry, 6)}</td>
        <td>{number(position.stop, 6)}<small>{position.stop === position.initialStop ? 'ilk stop' : 'taşındı'}</small></td>
        <td>{position.targets.map((target, index) => <span key={index} className="bot-tag">TP{index + 1} {number(target.price, 6)}{target.filled ? ' ✓' : ''}</span>)}</td>
        <td>{number(position.remaining / position.quantity * 100, 0)}%<small>{number(position.remaining, 6)} / {number(position.quantity, 6)}</small></td>
        <td className={pnl == null ? '' : pnl > 0 ? 'bot-positive' : pnl < 0 ? 'bot-negative' : ''}>{pnl == null ? '—' : number(pnl)}<small>gerçekleşen {number(position.realizedPnl)}</small></td>
      </tr>; })}</tbody></table></div> : <p className="bot-empty">Açık pozisyon yok.</p>}

    {points.length > 0 && <>
      <h3>{coin(instrument ?? '')} {scan?.candles?.interval} · botun baktığı mumlar</h3>
      <CandlestickChart points={points} trades={marks} levels={levels} intraday />
      <p className="bot-small">İşaretler botun kendi giriş ve kısmi çıkışlarıdır. Çizgiler açık pozisyonun girişi, güncel stopu ve kademeli hedefleridir. Mumlar son taramada modelin okuduğu kapanmış {scan?.candles?.interval} barlarıdır.</p>
    </>}

    {settings.executionMode === 'live' && <>
      <h3>Borsa emirleri</h3>
      {snapshot.intents.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Coin / yön</th><th>Durum</th><th>Dolan kontrat</th><th>Stop</th></tr></thead><tbody>{snapshot.intents.map(intent => <tr key={intent.signalId}>
        <td><strong>{coin(intent.id)}</strong><small>{intent.direction === 'long' ? 'Long' : 'Short'}</small></td>
        <td className={intent.state === 'critical' ? 'bot-negative' : intent.state === 'protected' ? 'bot-positive' : ''}>{intentState[intent.state] ?? intent.state}{intent.reason && <small>{intent.reason}</small>}</td>
        <td>{number(intent.filledContracts, 6)} / {number(intent.contracts, 6)}</td>
        <td>{number(intent.stop, 6)}</td>
      </tr>)}</tbody></table></div> : <p className="bot-empty">Borsada takip edilen emir yok.</p>}
    </>}

    <h3>Botun son işlemleri</h3>
    {own.length
      ? <><ol className="bot-stories">{own.map(position => <TradeStory key={position.id} position={position} />)}</ol>
        {paper.trades.length > own.length && <p className="bot-small">Daha eski {paper.trades.length - own.length} işlem var; toplam {number(paper.trades.reduce((sum, position) => sum + position.realizedPnl, 0))} USDT.</p>}</>
      : <p className="bot-empty">Bot henüz işlem açmadı.</p>}

    {!own.length && !sample && <>
      <h3>Modelin son işlemleri</h3>
      <div className="bot-blocker"><AlertTriangle size={15} /><span>Gösterilecek örnek koşu yok: kayıtlı backtest&apos;lerin hiçbiri {live.instruments.map(coin).join(', ')} üzerinde bu modelle işlem içermiyor. Tek coinlik bir karşılaştırma çalıştırın, işlemler buraya adım adım dökülsün.</span><button className="button secondary small" disabled={pending} onClick={() => command({ action: 'comparison', instruments: [...live.instruments], days: 1095 })}>{coin(live.instruments[0] ?? '')} için çalıştır</button></div>
    </>}
    {sample && <>
      <h3>Modelin son işlemleri <span className="bot-tag">geçmiş test · botun kendi işlemi değil</span></h3>
      <p className="bot-small">Bot kendi geçmişini biriktirene kadar aynı modelin geçmiş {coin(sample.run.instrument)} verisinde açtığı son işlemler; kademeli planın nasıl işlediği burada adım adım görünür. Bu koşu {sample.run.settings.riskMode === 'fixed' ? `stop başına ${number(sample.run.settings.fixedRiskUsdt)} USDT` : `%${number(sample.run.settings.riskPercent)} risk`} · {sample.run.settings.leverage}× · komisyon {number(sample.run.settings.feeBps, 1)} bp · kayma {number(sample.run.settings.slippageBps, 1)} bp varsayımıyla üretildi{sample.run.settings.feeBps !== settings.feeBps || sample.run.settings.slippageBps !== settings.slippageBps ? `; şu anki ayarların ${number(settings.feeBps, 1)} / ${number(settings.slippageBps, 1)} bp, yani rakamlar birebir karşılaştırılamaz` : ''}.</p>
      <ol className="bot-stories">{sample.trades.map(position => <TradeStory key={position.id} position={position} />)}</ol>
    </>}

    <h3>Son aksiyonlar</h3>
    {snapshot.events.length ? <ul className="bot-events">{snapshot.events.slice(0, 12).map(event => <li key={event.id} className={event.level === 'error' ? 'bot-negative' : ''}><CircleDot size={12} /><span>{time(event.time)}</span> {event.message}</li>)}</ul> : <p className="bot-empty">Kayıtlı olay yok.</p>}
    {!!scan?.signals.length && <><h3>Son taramanın sinyalleri</h3>{scan.signals.map((signal, index) => <p key={index} className="bot-small">{coin(signal.instrument)} · {signal.direction} · {signal.reason}</p>)}</>}
    {!!scan?.warnings.length && <details className="bot-method"><summary>Son tarama uyarıları ({scan.warnings.length})</summary>{scan.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details>}
    <div className="bot-actions"><button className="button secondary small" disabled={pending} onClick={() => command({ action: 'scan' })}><Play size={14} /> Şimdi tara</button></div>
  </>;
}
