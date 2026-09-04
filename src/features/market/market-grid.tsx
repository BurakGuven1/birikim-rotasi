"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { useMarketQuotes } from "@/lib/hooks/use-market-quotes";
import { formatDateTime, formatMoney, formatPercent } from "@/lib/format";
import { MacroIndicators } from "./macro-indicators";

const assets = [
  { symbol: "BTC", name: "Bitcoin", currency: "USD" as const },
  { symbol: "GOLD", name: "Altın", currency: "USD" as const },
  { symbol: "SILVER", name: "Gümüş", currency: "USD" as const },
  { symbol: "SP500", name: "S&P 500", currency: "USD" as const },
  { symbol: "QQQM", name: "Nasdaq 100 ETF", currency: "USD" as const },
  { symbol: "SGOV", name: "0–3 Ay ABD Hazine Bonosu", currency: "USD" as const },
  { symbol: "BIST100", name: "BIST 100", currency: "TRY" as const },
  { symbol: "USDTRY", name: "Dolar / TL", currency: "TRY" as const },
];

export function MarketGrid() {
  const { quotes, errors, loading, refresh } = useMarketQuotes(assets.map((asset) => asset.symbol));
  return <div>
    <PageHeader eyebrow="Ücretsiz veri katmanı" title="Piyasa göstergeleri" description="Her kart fiyatın kaynağını, zamanını ve gecikme durumunu taşır. Ücretsiz erişimde borsa fiyatları gecikmeli olabilir." actions={<button className="button secondary" onClick={() => void refresh()}><RefreshCw size={17} />Yenile</button>} />
    {loading && Object.keys(quotes).length === 0 ? <Card><EmptyState title="Piyasa verileri alınıyor" description="Ücretsiz sağlayıcılar sırayla kontrol ediliyor." /></Card> : <div className="market-list">
      {assets.map((asset) => {
        const quote = quotes[asset.symbol];
        return <Link href={`/varlik/${encodeURIComponent(asset.symbol)}`} className="card market-card" key={asset.symbol}>
          <div className="card-title"><div><div className="market-symbol">{asset.symbol}</div><h3>{asset.name}</h3></div>{quote ? <StatusBadge status={quote.status} /> : <StatusBadge status="unavailable" />}</div>
          {quote ? <><div className="market-price">{formatMoney(quote.price, quote.currency)}</div><div className={(quote.changePercent ?? 0) >= 0 ? "positive" : "negative"}>{formatPercent((quote.changePercent ?? 0) / 100)}</div><div className="source-line"><span>{quote.source}</span><span>{formatDateTime(quote.asOf)}</span></div></> : <p className="muted">{errors[asset.symbol] ?? "Fiyat alınamadı."}</p>}
        </Link>;
      })}
    </div>}
    <MacroIndicators />
    <div className="notice section-gap"><p>Bu ekran yatırım emri üretmez. “Güncel” rozeti yalnızca sağlayıcıdan alınan verinin yaşını belirtir; lisanslı borsa gerçek zaman verisi anlamına gelmez.</p></div>
  </div>;
}
