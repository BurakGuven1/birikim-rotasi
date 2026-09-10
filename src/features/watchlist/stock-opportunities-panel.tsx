"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, CircleHelp, ShieldCheck, TrendingUp } from "lucide-react";
import type { StockMarket, StockSnapshot } from "@/lib/domain/stock-watchlist";
import { opportunityChanges, rankStockOpportunities } from "@/lib/domain/stock-opportunities";
import { formatDateTime, formatMoney } from "@/lib/format";
import "./stock-opportunities.css";

const number = (value: number | null | undefined, suffix = "") => value == null ? "—" : `${value.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}${suffix}`;
function Score({ value, label }: { value: number; label: string }) {
  return <span className="opportunity-score" aria-label={`${label}: ${number(value)} / 100`}><strong>{number(value)}</strong><span aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></span></span>;
}

export function StockOpportunitiesPanel({ market, snapshot, previous }: { market: StockMarket; snapshot?: StockSnapshot; previous?: StockSnapshot }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    const initial = setTimeout(update, 0);
    const timer = setInterval(update, 60_000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, []);
  const result = useMemo(() => rankStockOpportunities(now ? snapshot : undefined, now ?? new Date(0)), [snapshot, now]);
  const changes = useMemo(() => now ? opportunityChanges(previous, snapshot, now) : [], [previous, snapshot, now]);
  const supported = result.candidates.filter(c => c.recovery === "supported").length;
  const sectorCount = new Set(result.candidates.map(c => c.stock.sector)).size;

  return <section className="opportunities" aria-labelledby="opportunities-title">
    <header className="opportunities-header"><div><span className="watchlist-eyebrow"><ShieldCheck size={15} /> UZUN VADE · ADAY TARAMASI</span><h2 id="opportunities-title">Kaliteyi uygun fiyatla bul.</h2><p>{market === "TR" ? "BIST 100" : "ABD ilk 100"} içinde en fazla 20 aday. Güçlü birleşik puandan aşağıya.</p></div><span className="opportunities-preview">Ön değerlendirme · geçmiş test yok</span></header>
    <div className="opportunities-stats"><span><strong>{result.candidates.length}</strong> aday / en fazla 20</span><span><strong>{result.assessed}/{result.universe}</strong> hesaplanabilir veri</span><span><strong>{supported}</strong> toparlanma destekli</span><span><strong>{sectorCount}</strong> sektör</span></div>
    {snapshot?.fundamentalsWarning && <p className="opportunities-note" role="status">{snapshot.fundamentalsWarning}</p>}
    <p className="opportunities-context">Bu bölüm tüm seçili piyasa evrenini tarar; aşağıdaki arama ve SMA filtrelerinden bağımsızdır. Sıra, portföy ağırlığı veya kesin getiri değildir.</p>
    {result.candidates.length > 0 ? <>
      <div className="watchlist-table-scroll" tabIndex={0} role="region" aria-label="Uzun vade fırsat sıralaması; yatay kaydırılabilir">
        <table className="watchlist-table opportunities-table"><thead><tr><th scope="col">Sıra</th><th scope="col">Hisse / son fiyat</th><th scope="col">Fırsat puanı</th><th scope="col">Ucuzluk</th><th scope="col">Kalite</th><th scope="col">Momentum</th><th scope="col">Toparlanma / veri</th><th scope="col">Oranları incele</th></tr></thead><tbody>
          {result.candidates.map((candidate, index) => {
            const { stock, value, quality, momentum, score } = candidate;
            const f = stock.fundamentals!;
            return <tr key={stock.symbol}>
              <td><span className={`opportunity-rank${index < 3 ? " leading" : ""}`}>{index + 1}</span></td>
              <th scope="row"><Link className="opportunity-company" href={`/varlik/${encodeURIComponent(stock.symbol)}`}><strong>{stock.ticker}<ArrowUpRight size={13} /></strong><small>{stock.name}</small></Link><span className="opportunity-price">{formatMoney(stock.price!, stock.currency)}</span><small>{stock.priceAsOf ? `Son işlem: ${formatDateTime(stock.priceAsOf)}` : stock.priceUpdatedAt ? `Kaynak güncellemesi: ${formatDateTime(stock.priceUpdatedAt)}` : "Fiyat zamanı yok"} · {stock.delayMinutes == null ? "gecikme bilinmiyor" : stock.delayMinutes > 0 ? `${stock.delayMinutes} dk gecikmeli` : "kaynak son fiyatı"}</small></th>
              <td><Score value={score} label="Fırsat" /></td><td><Score value={value} label="Ucuzluk" /></td><td><Score value={quality} label="Kalite" /></td><td><Score value={momentum} label="Momentum" /></td>
              <td><span className={`opportunity-recovery ${candidate.recovery}`}><TrendingUp size={13} />{candidate.recovery === "supported" ? "Toparlanma destekli" : "Toparlanma bekleniyor"}</span><small>{candidate.peers} sektör emsali · {candidate.model === "bank" ? "Banka modeli" : "Şirket modeli"}</small><small>Veri güveni: sınırlı · tek kaynak</small></td>
              <td><details className="opportunity-details"><summary>Veri ve riskler</summary><dl>
                <div><dt>F/K · PD/DD</dt><dd>{number(stock.pe, "×")} · {number(stock.pb, "×")}</dd></div>
                <div><dt>FD/FVAÖK</dt><dd>{number(stock.evEbitda, "×")}</dd></div>
                {candidate.model === "operating" && <><div><dt>Serbest nakit akışı getirisi</dt><dd>{number(100 / f.priceFcf!, "%")}</dd></div><div><dt>ROIC · ROE</dt><dd>{number(f.roic, "%")} · {number(f.roe, "%")}</dd></div><div><dt>Borç/FVAÖK · Nakit/kâr</dt><dd>{number(candidate.debtEbitda, "×")} · {number(candidate.cashConversion, "×")}</dd></div><div><dt>Piotroski F skoru</dt><dd>{number(f.fScore)} / 9</dd></div></>}
                {candidate.model === "bank" && <div><dt>ROE · ROA</dt><dd>{number(f.roe, "%")} · {number(f.roa, "%")}</dd></div>}
                <div><dt>Hisse başı kâr · gelir büyümesi</dt><dd>{number(f.epsGrowth, "%")} · {number(f.revenueGrowth, "%")}</dd></div>
                <div><dt>6–1 · 12–1 fiyat getirisi</dt><dd>{number(candidate.momentum6, "%")} · {number(candidate.momentum12, "%")}</dd></div>
                <div><dt>Sonuç açıklaması (kaynak)</dt><dd>{f.reportedAt ? formatDateTime(f.reportedAt) : "—"}</dd></div>
              </dl><p>{stock.sector} · {f.industry}</p>{candidate.limitations.map(text => <p key={text}>{text}</p>)}<p>Bilanço dönemi ayrıca teyit edilmedi. Nakit üretimi, büyüme veya göreli ucuzluk bozulursa adaylık sona erebilir.</p></details></td>
            </tr>;
          })}
        </tbody></table>
      </div>
      <div className="opportunities-explanation"><strong>Bu liste neden oluştu?</strong><p>{result.candidates.length} şirket, kendi sektöründe ucuzluk ve kalite puanında en az 50/100 aldı; kâr ve büyüme eşiklerini geçti. Finans dışı şirketler ayrıca pozitif nakit akışı ve borç sınırından geçti. {supported} adayda fiyat toparlanması da destekleyici. En fazla 5 aday/sektör; sayı 20’ye zorlanmaz. Bankalarda sermaye yeterliliği ayrıca incelenmeli.</p></div>
    </> : <div className="opportunities-empty"><ShieldCheck size={26} /><strong>{!snapshot ? "Önce iki piyasayı güncelle." : !now ? "Veri kontrol ediliyor…" : "Şu an koşulları geçen aday yok."}</strong><p>{!snapshot ? "Güncelle düğmesi fiyatla birlikte kalite ve bilanço verilerini de alır." : "Eksik veri, eski tarih, az emsal veya zayıf finansallar varsa liste doldurulmaz. Eleme nedenlerini aşağıda görebilirsin."}</p></div>}
    {changes.length > 0 && <div className="opportunities-exits"><strong>Önceki güncellemeden çıkanlar</strong><p>Önceki kayıt: {formatDateTime(previous!.fetchedAt)}. Çıkış, otomatik satış talimatı değildir.</p>{changes.map(change => <p key={change.symbol}><b>{change.symbol}</b> — {change.reason}</p>)}</div>}
    <details className="opportunities-method"><summary><CircleHelp size={16} /> Puan nasıl hesaplanıyor?</summary>
      <p>Ucuzluk ve kalite, aynı piyasa ve sektörde en az 5 tam verili emsalin yüzdelik sırasıdır. Momentum, hesaplanabilir piyasa evrenindeki 6–1 ve 12–1 fiyat getirilerinin yüzdelik sırasıdır; temettü dahil getiri değildir. Son ay bileşik olarak çıkarılır. Eşit değerler aynı puanı alır.</p>
      <p>Fırsat puanı = (ucuzluk + kalite + momentum) / 3. Bu eşit ağırlıklı başlangıç modeli optimize edilmedi. 80 puan, %80 kazanma ihtimali demek değildir. Yakın puanlar kesin üstünlük göstermez.</p>
      <p>Şirket modeli: F/K, FD/FVAÖK ve serbest nakit akışı getirisi; ROE, ROIC, faaliyet nakit akışı/kâr ve Piotroski F skoru. Pozitif kâr/nakit/sermaye kârlılığı, negatif olmayan kâr ve gelir büyümesi, borç/FVAÖK ≤4, nakit/kâr ≥0,8 ve F skoru ≥5 şartı aranır. Bu eşikler doğrulanmış optimum değildir.</p>
      <p>Banka modeli: F/K ve PD/DD; ROE ve ROA. Sanayi borç ve nakit eşikleri bankaya uygulanmaz. Sermaye yeterliliği ve kredi kalitesi verisi yoktur. Diğer finans, GYO ve holding şirketleri ayrı model gerektirdiğinden sıralanmaz.</p>
      <p>Kaydın ve fiyatın yaşı en fazla 5 takvim günü; sonuç açıklamasının yaşı en fazla 180 gün olabilir. Bu tolerans tatil günlerini kapsar, anlık fiyat garantisi değildir. Son işlem saati yoksa kaynağın güncelleme saati kullanılır ve ayrı etiketlenir; uygulamanın veriyi aldığı saat kullanılmaz. İkisi de bilinmeyen aday sıralanmaz. Tek kaynaktaki sonuç tarihi bilanço döneminin teyidi değildir.</p>
      <p>Kendi tarihine göre ucuzluk, çok yıllı kâr istikrarı, marj seyri ve sulandırma henüz ölçülmüyor. BIST büyümesi nominaldir; enflasyon muhasebesi karşılaştırılabilirliği ve şirket olayları ayrıca kontrol edilmelidir.</p>
      <p>1 / 3 / 5 / 10 yıl başarı oranı: <strong>Hesaplanmadı.</strong> O tarihte bilinen bilançoları ve borsadan çıkan şirketleri içeren veri olmadan tarihsel başarı gösterilmez. Mevcut fiyat backtestleri bu sıralamanın kanıtı değildir.</p>
      <p><a href="https://www.msci.com/indexes/index/705973/msci-usa-enhanced-value-index" target="_blank" rel="noreferrer">MSCI değer yaklaşımı</a> · <a href="https://www.msci.com/indexes/group/quality-indexes" target="_blank" rel="noreferrer">MSCI kalite yaklaşımı</a> · <a href="https://funds.aqr.com/Insights/Strategies/Value-Factor" target="_blank" rel="noreferrer">AQR değer, kalite ve momentum</a>. Araştırma dayanaklarıdır; bu modelin birebir kopyası veya başarı kanıtı değildir.</p>
    </details>
    {result.excluded.length > 0 && <details className="opportunities-method"><summary>Listeye alınmayan {result.excluded.length} hisse ve nedenleri</summary><div className="opportunities-exclusions">{result.excluded.map(item => <p key={item.symbol}><b>{item.symbol}</b><span>{item.reasons.join(" ")}</span></p>)}</div></details>}
  </section>;
}
