"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui";
import type { PortfolioSummary } from "@/lib/domain/portfolio";
import { formatMoney, formatPercent } from "@/lib/format";

const colors = ["#315f9d", "#b7791f", "#6941c6", "#087a61", "#c2414b", "#5b708a"];

export function PortfolioCharts({ summary }: { summary: PortfolioSummary }) {
  const returns = summary.holdings.map((holding) => ({ name: holding.symbol, getiri: (holding.returnPercent ?? 0) * 100, kar: holding.unrealizedProfit ?? 0 }));
  const allocations = summary.holdings.map((holding) => ({ name: holding.symbol, value: holding.marketValue ?? 0 })).sort((a, b) => b.value - a.value);
  return <div className="grid grid-2 section-gap">
    <Card><div className="card-title"><div><h2>Varlık bazında yüzde getiri</h2><p>Komisyon dahil kalan maliyete göre</p></div></div><div className="chart-box"><ResponsiveContainer width="100%" height="100%"><BarChart data={returns} layout="vertical"><CartesianGrid stroke="var(--border)" horizontal={false} /><XAxis type="number" tickFormatter={(v) => `%${v}`} tick={{ fill: "var(--muted)", fontSize: 11 }} /><YAxis type="category" dataKey="name" tick={{ fill: "var(--muted)", fontSize: 11 }} width={70} /><Tooltip formatter={(v) => formatPercent(Number(v) / 100)} /><Bar dataKey="getiri" name="Getiri" radius={[0, 6, 6, 0]}>{returns.map((row) => <Cell key={row.name} fill={row.getiri >= 0 ? "#087a61" : "#c2414b"} />)}</Bar></BarChart></ResponsiveContainer></div></Card>
    <Card><div className="card-title"><div><h2>Mevcut varlık dağılımı</h2><p>Kesin tutarlar ve portföy içindeki pay</p></div></div><div className="progress" style={{ height: 20, display: "flex" }}>{allocations.map((row, index) => <span key={row.name} style={{ width: `${summary.currentValue ? row.value / summary.currentValue * 100 : 0}%`, background: colors[index % colors.length] }} />)}</div><div className="chart-legend">{allocations.map((row, index) => <span key={row.name}><i className="legend-dot" style={{ background: colors[index % colors.length] }} />{row.name} {formatPercent(summary.currentValue ? row.value / summary.currentValue : 0)} · {formatMoney(row.value)}</span>)}</div></Card>
  </div>;
}
