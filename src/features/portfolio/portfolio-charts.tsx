"use client";

import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui";
import type { PortfolioSummary } from "@/lib/domain/portfolio";
import type { Transaction } from "@/lib/domain/types";
import { formatMoney, formatPercent } from "@/lib/format";

const colors = ["#315f9d", "#b7791f", "#6941c6", "#087a61", "#c2414b", "#5b708a"];

export function PortfolioCharts({ summary, transactions, usdTry }: { summary: PortfolioSummary; transactions: Transaction[]; usdTry: number }) {
  const timeline = [...transactions].sort((a, b) => a.date.localeCompare(b.date)).reduce<Array<{ date: string; invested: number; value: number }>>((rows, transaction) => {
    const fx = transaction.currency === "USD" ? usdTry : 1;
    const cash = (transaction.quantity * transaction.unitPrice + (transaction.type === "buy" ? transaction.commission : -transaction.commission)) * fx;
    const previous = rows.at(-1)?.invested ?? 0;
    const cumulative = previous + (transaction.type === "buy" ? cash : -cash);
    return [...rows, { date: transaction.date.slice(0, 7), invested: Math.round(cumulative), value: Math.round(cumulative) }];
  }, []);
  if (timeline.length) timeline.push({ date: "Bugün", invested: Math.round(summary.investedCapital), value: Math.round(summary.currentValue) });
  const returns = summary.holdings.map((holding) => ({ name: holding.symbol, getiri: (holding.returnPercent ?? 0) * 100, kar: holding.unrealizedProfit ?? 0 }));
  const allocations = summary.holdings.map((holding) => ({ name: holding.symbol, value: holding.marketValue ?? 0 })).sort((a, b) => b.value - a.value);
  return <div className="grid grid-2 section-gap">
    <Card><div className="card-title"><div><h2>Yatırılan para ve portföy değeri</h2><p>İşlem tarihleri ve bugünkü değer</p></div></div><div className="chart-box"><ResponsiveContainer width="100%" height="100%"><LineChart data={timeline}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="date" tick={{ fill: "var(--muted)", fontSize: 11 }} /><YAxis tickFormatter={(v) => `${Math.round(v / 1000)}K`} tick={{ fill: "var(--muted)", fontSize: 11 }} /><Tooltip formatter={(v) => formatMoney(Number(v))} /><Legend /><Line name="Yatırılan" type="monotone" dataKey="invested" stroke="#b7791f" strokeWidth={2} strokeDasharray="6 4" dot={false} /><Line name="Portföy değeri" type="monotone" dataKey="value" stroke="#315f9d" strokeWidth={3} dot={false} /></LineChart></ResponsiveContainer></div></Card>
    <Card><div className="card-title"><div><h2>Varlık bazında yüzde getiri</h2><p>Komisyon dahil kalan maliyete göre</p></div></div><div className="chart-box"><ResponsiveContainer width="100%" height="100%"><BarChart data={returns} layout="vertical"><CartesianGrid stroke="var(--border)" horizontal={false} /><XAxis type="number" tickFormatter={(v) => `%${v}`} tick={{ fill: "var(--muted)", fontSize: 11 }} /><YAxis type="category" dataKey="name" tick={{ fill: "var(--muted)", fontSize: 11 }} width={70} /><Tooltip formatter={(v) => formatPercent(Number(v) / 100)} /><Bar dataKey="getiri" name="Getiri" radius={[0, 6, 6, 0]}>{returns.map((row) => <Cell key={row.name} fill={row.getiri >= 0 ? "#087a61" : "#c2414b"} />)}</Bar></BarChart></ResponsiveContainer></div></Card>
    <Card className="span-all"><div className="card-title"><div><h2>Mevcut varlık dağılımı</h2><p>Kesin tutarlar ve portföy içindeki pay</p></div></div><div className="progress" style={{ height: 20, display: "flex" }}>{allocations.map((row, index) => <span key={row.name} style={{ width: `${summary.currentValue ? row.value / summary.currentValue * 100 : 0}%`, background: colors[index % colors.length] }} />)}</div><div className="chart-legend">{allocations.map((row, index) => <span key={row.name}><i className="legend-dot" style={{ background: colors[index % colors.length] }} />{row.name} {formatPercent(summary.currentValue ? row.value / summary.currentValue : 0)} · {formatMoney(row.value)}</span>)}</div></Card>
  </div>;
}
