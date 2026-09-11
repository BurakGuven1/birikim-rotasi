"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDownUp, ArrowUpRight, Check, ChevronLeft, ChevronRight, CircleHelp, Clock3, ListFilter, Minus, Plus, RefreshCw, Search, WalletCards } from "lucide-react";
import catalog from "@/lib/data/stock-watchlist-catalog.json";
import type { StockIdentity, StockMarket, StockSnapshot } from "@/lib/domain/stock-watchlist";
import type { Transaction } from "@/lib/domain/types";
import { formatDateTime, formatMoney } from "@/lib/format";
import { portfolioRepository } from "@/lib/storage/portfolio-repository";
import { readWatchlistCache, saveWatchlistCache, readPreviousWatchlistCache, savePreviousWatchlistCache } from "@/lib/storage/watchlist-cache";
import { TradeDialog } from "./trade-dialog";
import { StockOpportunitiesPanel } from "./stock-opportunities-panel";
import "./watchlist.css";

type SortKey = "ticker" | "price" | "change" | "pe" | "pb" | "evEbitda" | "sma200Weekly" | "smaDistance";
const metricHelp = { evEbitda: "Firma değeri / son 12 aylık FVAÖK. Finans sektöründe karşılaştırılabilir olmadığı için gösterilmez.", pe: "Fiyat / son 12 aylık hisse başına kâr. Negatif veya eksik oran gösterilmez.", pb: "Piyasa değeri / son çeyrek özkaynak. Negatif veya eksik oran gösterilmez.", sma200Weekly: "Kaynağın 200 haftalık basit hareketli ortalaması. Devam eden haftanın fiyatını içerebilir; 200 günlük ortalama değildir.", smaDistance: "(Son fiyat / haftalık SMA200 − 1) × 100. Eksi değer, fiyatın ortalamanın altında olduğunu gösterir." };
const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const multiple = (value: number | null | undefined) => value == null ? "—" : `${value.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}×`;

export function WatchlistDashboard() {
  const [market, setMarket] = useState<StockMarket>("US");
  const [snapshots, setSnapshots] = useState<Partial<Record<StockMarket, StockSnapshot>>>({});
  const [previousSnapshots, setPreviousSnapshots] = useState<Partial<Record<StockMarket, StockSnapshot>>>({});
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("");
  const [below, setBelow] = useState(false);
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({ key: "ticker", ascending: true });
  const [page, setPage] = useState(0);
  const [trade, setTrade] = useState<{ stock: StockIdentity; type: "buy" | "sell" }>();
  const abort = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const reloadPortfolio = useCallback(async () => { setTransactions(await portfolioRepository.list()); }, []);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      const problems: string[] = [];
      try { const saved = readWatchlistCache(); if (!cancelled) setSnapshots(saved); } catch { problems.push("Kayıtlı piyasa verisi okunamadı. Güncelle ile yeniden alabilirsin."); }
      try { const saved = readPreviousWatchlistCache(); if (!cancelled) setPreviousSnapshots(saved); } catch { problems.push("Önceki fırsat kaydı okunamadı; çıkış karşılaştırması kullanılamıyor."); }
      try { const rows = await portfolioRepository.list(); if (!cancelled) setTransactions(rows); } catch { problems.push("Yerel portföy okunamadı."); }
      if (!cancelled) { setErrors(problems); setReady(true); }
    });
    return () => { cancelled = true; abort.current?.abort(); };
  }, []);

  const refresh = async () => {
    if (busy.current || !ready) return;
    busy.current = true; setLoading(true); setErrors([]); setNotice("");
    const controller = new AbortController(); abort.current = controller;
    const next = { ...snapshots }; const problems: string[] = [];
    const results = await Promise.allSettled((["US", "TR"] as const).map(async selected => {
      const response = await fetch("/api/market/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ market: selected }), signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(`${selected === "US" ? "ABD" : "Türkiye"}: ${body.error ?? "Veri alınamadı"}`);
      if (body.market !== selected || !Array.isArray(body.rows)) throw new Error("Geçersiz piyasa yanıtı.");
      return body as StockSnapshot;
    }));
    if (!controller.signal.aborted) {
      const previous = { ...previousSnapshots };
      results.forEach(result => {
        if (result.status === "fulfilled") {
          const updated = result.value;
          const old = snapshots[updated.market];
          if (old && updated.fetchedAt > old.fetchedAt) previous[updated.market] = old;
          next[updated.market] = updated;
        } else problems.push(result.reason instanceof Error ? result.reason.message : "Güncelleme başarısız.");
      });
      setPreviousSnapshots(previous);
      setSnapshots(next);
      try { saveWatchlistCache(next); savePreviousWatchlistCache(previous); } catch { problems.push("Veriler alındı ama cihazda saklanamadı."); }
      setErrors(problems); setLoading(false);
      setNotice(problems.length ? "Alınabilen piyasalar güncellendi. Diğer piyasanın önceki kaydı korundu." : results.some(r => r.status === "fulfilled" && r.value.cached) ? "Son 30 saniyedeki kayıt kullanıldı. Veri alınma saati değişmedi." : "İki piyasa güncellendi. Otomatik yenileme kapalı.");
    }
    busy.current = false;
  };
  const quantities = useMemo(() => transactions.reduce<Record<string, number>>((result, transaction) => { result[transaction.symbol] = (result[transaction.symbol] ?? 0) + (transaction.type === "buy" ? 1 : -1) * transaction.quantity; return result; }, {}), [transactions]);
  const snapshot = snapshots[market];
  const stocks: StockIdentity[] = snapshot?.rows ?? (catalog.rows as StockIdentity[]).filter(stock => stock.market === market);
  const values = useMemo(() => new Map(snapshot?.rows.map(row => [row.symbol, row]) ?? []), [snapshot]);
  const sectors = [...new Set(stocks.map(stock => stock.sector))].sort();
  const filtered = stocks.filter(stock => {
    const row = values.get(stock.symbol);
    return (!query || `${stock.ticker} ${stock.name}`.toLocaleLowerCase("tr-TR").includes(query.toLocaleLowerCase("tr-TR"))) && (!sector || sector === stock.sector) && (!below || (row?.smaDistance != null && row.smaDistance < 0)) && (!ownedOnly || quantities[stock.symbol] > 1e-9);
  }).sort((a, b) => {
    if (sort.key === "ticker") return a.ticker.localeCompare(b.ticker) * (sort.ascending ? 1 : -1);
    const left = values.get(a.symbol)?.[sort.key]; const right = values.get(b.symbol)?.[sort.key];
    if (left == null) return right == null ? a.ticker.localeCompare(b.ticker) : 1;
    if (right == null) return -1;
    return (left - right) * (sort.ascending ? 1 : -1);
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / 25));
  const currentPage = Math.min(page, pageCount - 1);
  const shown = filtered.slice(currentPage * 25, currentPage * 25 + 25);
  const sortBy = (key: SortKey) => { setSort(previous => ({ key, ascending: previous.key === key ? !previous.ascending : true })); setPage(0); };
  const ownedCount = stocks.filter(stock => quantities[stock.symbol] > 1e-9).length;
  const priced = snapshot?.rows.filter(row => row.price !== null).length ?? 0;
  const under = snapshot?.rows.filter(row => row.smaDistance !== null && row.smaDistance < 0).length ?? 0;
  const header = (key: SortKey, title: string, help?: string) => <th scope="col" aria-sort={sort.key === key ? sort.ascending ? "ascending" : "descending" : "none"}><button onClick={() => sortBy(key)} title={help} aria-label={`${title} sıralaması`}><span>{title}</span><ArrowDownUp size={12} /></button></th>;

  return <div className="watchlist-page">
    <header className="watchlist-header"><div><div className="watchlist-eyebrow"><span />PİYASALAR · HİSSE TAKİP</div><h1>Piyasayı gör. <span>Listeni oluştur.</span></h1><p>ABD ve Türkiye’nin önde gelen hisseleri; fiyat, değerleme ve uzun vadeli trend aynı tabloda.</p></div><div className="watchlist-update"><button className="button primary" onClick={() => void refresh()} disabled={loading || !ready}><RefreshCw size={17} className={loading ? "refresh-spin" : ""} />{loading ? "İki piyasa güncelleniyor…" : "Güncelle"}</button><span><Clock3 size={13} /> Otomatik yenileme kapalı</span></div></header>
    {errors.length > 0 && <div className="notice watchlist-notice" role="alert">{errors.map(error => <p key={error}>{error}</p>)}</div>}
    {notice && <p className="watchlist-feedback" role="status"><Check size={16} />{notice}</p>}
    <div className="watchlist-summary">
      <div><span>TAKİP EVRENİ</span><strong>{stocks.length}<small>hisse</small></strong><p>{market === "US" ? "ABD · piyasa değerine göre ilk 100" : "Türkiye · BIST 100 bileşenleri"}</p></div>
      <div><span>FİYAT KAPSAMI</span><strong>{priced}<small>/ {stocks.length}</small></strong><p>{snapshot ? "Son alınan kayıtta fiyatı bulunan" : "Güncelle düğmesiyle verileri al"}</p></div>
      <div><span>HAFTALIK SMA200 ALTINDA</span><strong>{snapshot ? under : "—"}<small>{snapshot ? "hisse" : ""}</small></strong><p>Uzun vadeli ortalamaya göre konum</p></div>
      <div><span>PORTFÖYÜNDE</span><strong>{ownedCount}<small>hisse</small></strong><p><Link href="/portfoyum">İşlemlerini görüntüle <ArrowUpRight size={12} /></Link></p></div>
    </div>
    <section className="watchlist-panel" aria-label="Hisse takip tablosu">
      <div className="watchlist-panel-top"><div className="watchlist-tabs" role="tablist" aria-label="Piyasa seçimi">{(["US", "TR"] as const).map(selected => <button role="tab" key={selected} aria-selected={selected === market} onClick={() => { setMarket(selected); setSector(""); setPage(0); }}><span className="watchlist-country">{selected}</span>{selected === "US" ? "ABD 100" : "BIST 100"}<span className="watchlist-tab-count">{snapshots[selected]?.rows.length ?? 100}</span></button>)}</div><div className="watchlist-timestamp"><Clock3 size={14} /><span>{snapshot ? `Alındı: ${formatDateTime(snapshot.fetchedAt)}` : `Liste: ${catalog.asOf} · fiyatlar bekleniyor`}</span></div></div>
      <StockOpportunitiesPanel market={market} snapshot={snapshot} previous={previousSnapshots[market]} />
      <div className="watchlist-toolbar"><label className="watchlist-search"><Search size={17} /><input aria-label="Hisse ara" placeholder="Hisse kodu veya şirket ara…" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label><label className="watchlist-sector"><ListFilter size={16} /><select aria-label="Sektör filtresi" value={sector} onChange={event => { setSector(event.target.value); setPage(0); }}><option value="">Tüm sektörler</option>{sectors.map(value => <option key={value}>{value}</option>)}</select></label><button className={`watchlist-filter${below ? " active" : ""}`} aria-pressed={below} onClick={() => { setBelow(value => !value); setPage(0); }}>SMA altında</button><button className={`watchlist-filter${ownedOnly ? " active" : ""}`} aria-pressed={ownedOnly} onClick={() => { setOwnedOnly(value => !value); setPage(0); }}><WalletCards size={15} />Portföyümdekiler</button></div>
      <div className="watchlist-table-scroll" tabIndex={0} role="region" aria-label="Hisse verileri; küçük ekranda yatay kaydırılabilir"><table className="watchlist-table"><thead><tr>{header("ticker", "Hisse")}{header("price", "Son fiyat")}{header("change", "Değişim")}{header("evEbitda", "FD/FVAÖK", metricHelp.evEbitda)}{header("pe", "F/K", metricHelp.pe)}{header("pb", "PD/DD", metricHelp.pb)}{header("sma200Weekly", "SMA200 · Haftalık", metricHelp.sma200Weekly)}{header("smaDistance", "SMA farkı", metricHelp.smaDistance)}<th scope="col">Portföy işlemi</th></tr></thead><tbody>
        {shown.map(stock => { const row = values.get(stock.symbol); const held = quantities[stock.symbol] ?? 0; return <tr key={stock.symbol}>
          <th scope="row"><Link className="watchlist-stock" href={`/varlik/${encodeURIComponent(stock.symbol)}`}><span className="watchlist-monogram">{stock.ticker.slice(0, 2)}</span><span><strong>{stock.ticker}{held > 1e-9 && <i title="Portföyünde" />}</strong><small title={stock.name}>{stock.name}</small></span></Link></th>
          <td><strong>{row?.price != null ? formatMoney(row.price, row.currency) : "—"}</strong><small>{row ? row.delayMinutes === null ? "Gecikme bilinmiyor" : row.delayMinutes > 0 ? `${row.delayMinutes} dk gecikmeli` : "Kaynak: son fiyat" : stock.market === "US" ? "USD" : "TRY"}</small></td>
          <td className={row?.change == null ? "muted" : row.change >= 0 ? "positive" : "negative"}>{row?.change != null ? signed(row.change) : "—"}</td>
          <td title={row?.evEbitda == null ? "Eksik, negatif veya sektör için uygun olmayan oran" : metricHelp.evEbitda}>{multiple(row?.evEbitda)}</td><td title={metricHelp.pe}>{multiple(row?.pe)}</td><td title={metricHelp.pb}>{multiple(row?.pb)}</td>
          <td>{row?.sma200Weekly != null ? formatMoney(row.sma200Weekly, row.currency) : <span title="200 haftalık ortalama kaynakta bulunamadı">—</span>}</td>
          <td>{row?.smaDistance != null ? <span className={`watchlist-distance ${row.smaDistance >= 0 ? "above" : "below"}`}>{signed(row.smaDistance)}<small>{row.smaDistance >= 0 ? "Üzerinde" : "Altında"}</small></span> : "—"}</td>
          <td><div className="watchlist-actions"><button className="watchlist-icon-button buy" aria-label={`${stock.ticker} alış ekle`} title="Alış ekle" disabled={!ready} onClick={() => setTrade({ stock, type: "buy" })}><Plus size={17} /></button><button className="watchlist-icon-button" aria-label={`${stock.ticker} satış ekle`} title={held > 1e-9 ? "Satış ekle" : "Portföyünde bu hisse yok"} disabled={!ready || held <= 1e-9} onClick={() => setTrade({ stock, type: "sell" })}><Minus size={17} /></button></div>{held > 1e-9 && <small>{held.toLocaleString("tr-TR", { maximumFractionDigits: 4 })} adet</small>}</td>
        </tr>; })}
        {!shown.length && <tr><td colSpan={9} className="watchlist-empty"><Search size={24} /><strong>Eşleşen hisse yok</strong><p>Aramayı veya filtreleri değiştir.{!snapshot && " Oran ve SMA filtreleri için önce Güncelle düğmesine bas."}</p></td></tr>}
      </tbody></table></div>
      <footer className="watchlist-pagination"><span>{filtered.length ? currentPage * 25 + 1 : 0}–{Math.min((currentPage + 1) * 25, filtered.length)} / {filtered.length} hisse</span><span>Sayfa {currentPage + 1} / {pageCount}</span><div><button className="watchlist-icon-button" aria-label="Önceki sayfa" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18} /></button><button className="watchlist-icon-button" aria-label="Sonraki sayfa" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18} /></button></div></footer>
    </section>
    <details className="watchlist-methodology"><summary><CircleHelp size={16} /> Veriler ve hesaplama hakkında</summary><p>ABD listesi ABD merkezli şirketlerin birincil hisse kotasyonlarını piyasa değerine göre sıralar; S&P 100 endeksi değildir. Türkiye listesi BIST 100 bileşenleridir. Endeks üyeliği ve sıralama her başarılı güncellemede kaynaktan yenilenir.</p><p>Haftalık SMA200 kaynak tarafından hesaplanır ve devam eden haftayı içerebilir. F/K ve FD/FVAÖK son 12 ayı, PD/DD son çeyreği esas alır. Oranların bilanço güncelliği fiyat güncelliğinden farklıdır. “—” eksik veya anlamlı olmayan veridir; sıfır değildir.</p><p>“Alındı” uygulamanın veriyi aldığı saattir; son işlem zamanı değildir. Sağlayıcı her hisse için fiyat ve bilanço zamanını vermeyebilir. Kaynak hata verirse eski sonuçlar ve eski alınma saati korunur. Tekrarlanan tıklamalarda 30 saniyelik kaynak koruması uygulanır.</p><p><a href="https://www.tradingview.com/screener/" target="_blank" rel="noreferrer">TradingView hisse tarayıcı</a> · Herkese açık tarama verisi, sözleşmeli bir veri API’si değildir; erişim ve kapsam değişebilir. Veriler yalnız Güncelle ile istenir.</p></details>
    {trade && <TradeDialog stock={trade.stock} row={values.get(trade.stock.symbol)} type={trade.type} held={quantities[trade.stock.symbol] ?? 0} onClose={() => setTrade(undefined)} onSaved={async () => { await reloadPortfolio(); setNotice(`${trade.stock.ticker} ${trade.type === "buy" ? "alış" : "satış"} işlemi portföye kaydedildi.`); }} />}
  </div>;
}
