import { ArrowDownRight, ArrowUpRight, PiggyBank, Scale, Wallet } from "lucide-react";
import { Card } from "@/components/ui";
import type { PortfolioSummary } from "@/lib/domain/portfolio";
import { formatMoney, formatPercent } from "@/lib/format";

export function SummaryCards({ summary }: { summary: PortfolioSummary }) {
  const positive = summary.totalProfit >= 0;
  const cards = [
    { label: "Net yatırılan para", value: formatMoney(summary.investedCapital), meta: `${formatMoney(summary.grossPurchases)} toplam alış`, icon: PiggyBank },
    { label: "Güncel portföy", value: formatMoney(summary.currentValue), meta: summary.missingQuotes.length ? `${summary.missingQuotes.length} fiyat eksik` : "Tüm fiyatlar hesaplandı", icon: Wallet },
    { label: "Toplam kâr / zarar", value: formatMoney(summary.totalProfit), meta: formatPercent(summary.returnPercent), icon: positive ? ArrowUpRight : ArrowDownRight, tone: positive ? "positive" : "negative" },
    { label: "Gerçekleşen / bekleyen", value: `${formatMoney(summary.realizedProfit)} / ${formatMoney(summary.unrealizedProfit)}`, meta: "FIFO ve komisyon dahil", icon: Scale },
  ];
  return <div className="grid grid-4">{cards.map(({ label, value, meta, icon: Icon, tone }) => <Card className="metric-card" key={label}><div className="metric-label">{label}</div><div className={`metric-value ${tone ?? ""}`}>{value}</div><div className="metric-meta"><Icon size={15} />{meta}</div></Card>)}</div>;
}
