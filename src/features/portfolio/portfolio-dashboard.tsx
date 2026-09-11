"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FileJson, PlusCircle, Upload } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { calculatePortfolio } from "@/lib/domain/portfolio";
import type { Transaction } from "@/lib/domain/types";
import { useMarketQuotes } from "@/lib/hooks/use-market-quotes";
import { exportPortfolioJson, exportTransactionsCsv, parsePortfolioJson } from "@/lib/storage/export-import";
import { portfolioRepository } from "@/lib/storage/portfolio-repository";
import { PortfolioCharts } from "./portfolio-charts";
import { PortfolioHistoryChart } from "./portfolio-history-chart";
import { SummaryCards } from "./summary-cards";
import { TransactionForm } from "./transaction-form";
import { TransactionTable } from "./transaction-table";

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}

export function PortfolioDashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [ready, setReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const symbols = [...new Set([...transactions.map((transaction) => transaction.symbol), "USDTRY"])];
  const { quotes, errors } = useMarketQuotes(symbols);
  const reload = useCallback(async () => { setTransactions(await portfolioRepository.list()); setReady(true); }, []);
  useEffect(() => { void Promise.resolve().then(reload); }, [reload]);
  const usdTry = quotes.USDTRY?.price;
  const valuationReady = !transactions.some(transaction => transaction.currency !== "TRY") || (Number.isFinite(usdTry) && usdTry! > 0 && !transactions.some(transaction => transaction.currency === "EUR"));
  const summary = useMemo(() => calculatePortfolio(valuationReady ? transactions : [], quotes, { TRY: 1, USD: usdTry }), [transactions, quotes, usdTry, valuationReady]);
  const save = async (transaction: Transaction) => { await portfolioRepository.update(transaction); setEditing(null); await reload(); };
  const remove = async (id: string) => { await portfolioRepository.remove(id); await reload(); };
  const importFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    try { await portfolioRepository.replaceAll(parsePortfolioJson(await file.text())); await reload(); }
    catch (error) { alert(error instanceof Error ? error.message : "Yedek içe aktarılamadı."); }
    event.target.value = "";
  };
  return <div>
    <PageHeader eyebrow="Yerel portföy" title="Portföyüm" description="Ne kadar yatırdığını, güncel değerini ve her varlığın yüzde getirisini tek yerde gör. Kayıtlar bu tarayıcıdan çıkmaz." actions={<><button className="button secondary" onClick={() => download("portfoy-yedegi.json", exportPortfolioJson(transactions), "application/json")}><FileJson size={17} />JSON</button><button className="button secondary" onClick={() => download("islemler.csv", exportTransactionsCsv(transactions), "text/csv;charset=utf-8")}><Download size={17} />CSV</button><button className="button secondary" onClick={() => inputRef.current?.click()}><Upload size={17} />İçe aktar</button><input ref={inputRef} hidden type="file" accept="application/json" onChange={(e) => void importFile(e)} /></>} />
    {transactions.length > 0 && !valuationReady && <div className="notice section-gap"><p>Gerekli döviz kuru eksik veya EUR değerlemesi desteklenmiyor. 1 USD = 1 TRY gibi varsayımsal kurla hesap yapılmadı.</p></div>}
    {transactions.length > 0 && valuationReady && <><SummaryCards summary={summary} /><div className="notice section-gap"><p>Bu eski rapor maliyetleri bugünkü kurla karşılaştırır; tarihsel kur kazancı ve ABD enflasyonu sonrası gerçekleşen getiri değildir. Vergi hesabında kullanma. Yatırım merkezindeki yeni katkı dağılımı güncel adet ve piyasa değerini esas alır.</p></div></>}
    {summary.missingQuotes.length > 0 && <div className="notice section-gap"><p>Fiyatı alınamayan varlıklar: {summary.missingQuotes.join(", ")}. Bu varlıklar güncel değer ve kâr toplamına uydurma fiyatla eklenmedi. {Object.values(errors)[0]}</p></div>}
    {transactions.length > 0 && <PortfolioHistoryChart transactions={transactions} quotes={quotes} />}
    {transactions.length > 0 && valuationReady && <PortfolioCharts summary={summary} />}
    <Card className="section-gap"><div className="card-title"><div><h2>{editing ? "İşlemi düzenle" : "Yeni işlem"}</h2><p>Alış ve satışlarda komisyonu işlem para biriminde gir</p></div></div><TransactionForm key={editing?.id ?? "new"} editing={editing} onSave={save} onCancel={() => setEditing(null)} /></Card>
    <Card className="section-gap"><div className="card-title"><div><h2>İşlem geçmişi</h2><p>{transactions.length} kayıt</p></div></div>{ready && transactions.length === 0 ? <EmptyState title="Henüz işlem yok" description="Kendi işlemini ekle veya özellikleri görmek için açıkça etiketlenen örnek portföyü yükle." action={<button className="button primary" onClick={async () => { await portfolioRepository.seedExample(); await reload(); }}><PlusCircle size={17} />DEMO portföyü yükle</button>} /> : <TransactionTable transactions={transactions} onEdit={setEditing} onRemove={remove} />}</Card>
    {transactions.some((transaction) => transaction.id.startsWith("demo-")) && <div className="notice section-gap"><p><strong>DEMO VERİ:</strong> Örnek işlemler yalnızca arayüzü denemek içindir; yatırım önerisi değildir.</p></div>}
  </div>;
}
