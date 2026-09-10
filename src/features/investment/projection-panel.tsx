"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowUpRight, House } from "lucide-react";
import { Card } from "@/components/ui";
import { projectInvestment, realReturn } from "@/lib/domain/investment-projection";
import { formatMoney, formatUnsignedPercent } from "@/lib/format";
import { DEFAULT_INVESTMENT_POLICY, type InvestmentPolicy } from "@/lib/domain/investment-policy";

export function ProjectionPanel({ monthlyUsd, initialUsd, usdTry, policy = DEFAULT_INVESTMENT_POLICY }: { monthlyUsd: number; initialUsd: number; usdTry?: number; policy?: InvestmentPolicy }) {
  const [years, setYears] = useState(10);
  const [nominal, setNominal] = useState(13.3);
  const [inflation, setInflation] = useState(3);
  const [trInflation, setTrInflation] = useState(25);
  const [fxChange, setFxChange] = useState(20);
  const [observedCpi, setObservedCpi] = useState<{ rate: number; asOf: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/market/macro", { signal: controller.signal }).then(response => response.ok ? response.json() : null).then((data: { id: string; change: number; asOf: string; status: string }[] | null) => {
      const cpi = Array.isArray(data) ? data.find(row => row.id === "CPIAUCSL" && row.status !== "stale") : undefined;
      if (cpi && Number.isFinite(cpi.change) && Number.isFinite(Date.parse(cpi.asOf))) setObservedCpi({ rate: cpi.change, asOf: cpi.asOf });
    }).catch(() => {});
    return () => controller.abort();
  }, []);
  const inputs = { monthlyUsd, initialUsd, years, nominalReturn: nominal / 100, usInflation: inflation / 100, trInflation: trInflation / 100, fxDepreciation: fxChange / 100, usdTry, startDate: policy.startDate, annualUsd: policy.annualContributionUsd, annualMonth: policy.annualContributionMonth, firstAnnualYear:policy.firstAnnualYear };
  const data = projectInvestment(inputs);
  const end = data.at(-1)!;
  const real = realReturn(nominal / 100, inflation / 100);
  const requiredNominal = (1.1 * (1 + inflation / 100) - 1);
  return <Card className="projection-card"><div className="card-title"><div><h2>Ev hedefine giden yol</h2><p>Gelecek tahmini değil; varsayımları değiştir, alım gücünü karşılaştır.</p></div><House size={22} /></div>
    <div className="projection-summary"><div><span className="metric-label">HEDEF SENARYOSU · {years} yıl sonra · başlangıç gününün dolarıyla</span><p className="projection-value">{formatMoney(end.realUsd, "USD")}</p><span className="muted small-copy">Nominal birikim {formatMoney(end.nominalUsd, "USD")} · toplam katkı {formatMoney(end.contributedUsd, "USD")} · katkıların aynı alım gücüyle değeri {formatMoney(end.realContributedUsd,"USD")}</span></div><span className="scenario-chip"><ArrowUpRight size={17} />{formatUnsignedPercent(real, 1)} reel / yıl</span></div>
    <div className="projection-controls">
      <label htmlFor="scenario-years">Vade <strong>{years} yıl</strong><input id="scenario-years" type="range" min="3" max="15" value={years} onChange={e => setYears(Number(e.target.value))} /></label>
      <label htmlFor="scenario-return">Nominal USD getiri <strong>%{nominal.toFixed(2)}</strong><input id="scenario-return" type="range" min="-20" max="35" step=".05" value={nominal} onChange={e => setNominal(Number(e.target.value))} /></label>
      <label htmlFor="scenario-inflation">ABD enflasyonu <strong>%{inflation}</strong><input id="scenario-inflation" type="range" min="0" max="10" step="0.5" value={inflation} onChange={e => setInflation(Number(e.target.value))} /></label>
    </div>
    <div className="projection-chart" role="img" aria-label="Nominal birikim, ABD enflasyonu sonrası alım gücü ve yatırılan para senaryosu">
      <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}><LineChart data={data} margin={{ top: 10, right: 14, left: 0, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="4 5" /><XAxis dataKey="year" tickFormatter={v => `${v}. yıl`} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} /><YAxis width={54} tickFormatter={v => `$${Math.round(v / 1000)}b`} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} /><Tooltip formatter={(value, name) => [formatMoney(Number(value), "USD"), name]} labelFormatter={v => `${v}. yıl`} contentStyle={{ background: "var(--surface)", borderColor: "var(--border)", borderRadius: 10, color: "var(--text)" }} /><Line name="Reel USD" type="monotone" dataKey="realUsd" stroke="#16a085" strokeWidth={3} dot={false} isAnimationActive={false} /><Line name="Nominal USD" type="monotone" dataKey="nominalUsd" stroke="#548ee4" strokeWidth={2} dot={false} isAnimationActive={false} /><Line name="Yatırılan USD" dataKey="contributedUsd" stroke="#8795a8" strokeDasharray="5 5" dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer>
    </div><div className="chart-legend"><span><i className="legend-dot" style={{ background: "#16a085" }} />Reel USD</span><span><i className="legend-dot" style={{ background: "#548ee4" }} />Nominal USD</span><span><i className="legend-dot" style={{ background: "#8795a8" }} />Yatırılan para</span></div>
    <div className="projection-note"><strong>%10 reel için {formatUnsignedPercent(requiredNominal, 2)} nominal USD gerekir.</strong><p>Maliyet sonrası, vergi öncesi hedef hesabıdır; portföyün beklenen getirisi değildir. {policy.startDate} başlangıcı, ayın {policy.contributionDay}’inde sabit nominal katkı ve yılda {formatMoney(policy.annualContributionUsd,"USD")} ek katkı ({policy.annualContributionMonth}. ay, {policy.firstAnnualYear}’den itibaren; {policy.annualDateEstimated ? "tahmini tarih" : "seçilen tarih"}) kullanılır. Ay içi gün farkı aylık bileşik hesapta ihmal edilir. Rezerv ödülü toplam getiriye ayrıca eklenerek çift sayılmaz.</p><button className="button secondary small" onClick={()=>setNominal((1.1*(1+inflation/100)-1)*100)}>Yıllık %10 reel hedefi uygula</button></div>
    {observedCpi && <p className="muted small-copy">Son alınan ABD TÜFE yıllık değişimi: {formatUnsignedPercent(observedCpi.rate, 1)} · {observedCpi.asOf.slice(0, 7)} · FRED. Gelecek enflasyon varsayımı yukarıdaki ayrı seçimdir.</p>}
    <details className="method-details"><summary>Türkiye’de alım gücü ve yıllık tablo</summary><div className="settings-grid section-gap"><label className="field">Türkiye enflasyonu varsayımı (%)<input className="input" type="number" min="0" max="100" value={trInflation} onChange={e => setTrInflation(Math.max(0, Math.min(100, Number(e.target.value))))} /></label><label className="field">Yıllık USD/TRY artışı varsayımı (%)<input className="input" type="number" min="-20" max="100" value={fxChange} onChange={e => setFxChange(Math.max(-20, Math.min(100, Number(e.target.value))))} /></label></div><p className="small-copy">Türkiye enflasyonu canlı veri değildir. {usdTry ? `Bugünkü TL alım gücüyle sonuç: ${formatMoney(end.realTry!, "TRY")}.` : "Güncel kur alınamadı; TL alım gücü hesaplanmıyor."} Ev fiyatları tüketici enflasyonundan farklı hareket edebilir.</p><div className="table-wrap"><table className="data-table"><thead><tr><th>Yıl</th><th>Yatırılan USD</th><th>Nominal USD</th><th>Reel USD</th></tr></thead><tbody>{data.map(row => <tr key={row.year}><td>{row.year}</td><td>{formatMoney(row.contributedUsd, "USD")}</td><td>{formatMoney(row.nominalUsd, "USD")}</td><td>{formatMoney(row.realUsd, "USD")}</td></tr>)}</tbody></table></div></details>
  </Card>;
}
