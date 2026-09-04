import { CheckCircle2, Clock3, Crosshair, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui";
import type { TacticalSetup } from "@/lib/domain/tactical";
import { formatMoney, formatUnsignedPercent } from "@/lib/format";

export function SetupCard({ setup, alreadyPlanned, onPlan }: { setup: TacticalSetup; alreadyPlanned: boolean; onPlan: (setup: TacticalSetup) => void }) {
  const active = setup.action === "long";
  return <Card className={`setup-card ${active ? "eligible" : "waiting"}`}>
    <div className="card-title"><div><span className="market-symbol">{setup.symbol}</span><h3>{setup.name}</h3></div><span className={`status-badge ${active ? "fresh" : "delayed"}`}>{active ? <CheckCircle2 size={13} /> : <Clock3 size={13} />}{active ? "Long koşulu" : "Bekle"}</span></div>
    {active ? <>
      <div className="setup-levels">
        <div><span>Giriş aralığı</span><strong>{setup.entryZone[0].toLocaleString("tr-TR")}–{setup.entryZone[1].toLocaleString("tr-TR")}</strong></div>
        <div className="risk-level"><span>Geçersizleşme</span><strong>{setup.invalidation.toLocaleString("tr-TR")}</strong></div>
        <div><span>Hedef 1</span><strong>{setup.targetZones[0].toLocaleString("tr-TR")}</strong></div>
        <div><span>Hedef 2</span><strong>{setup.targetZones[1].toLocaleString("tr-TR")}</strong></div>
      </div>
      <div className="setup-risk-row"><span><Crosshair size={15} /> Boyut <strong>{formatMoney(setup.positionSizeUsd, "USD")}</strong></span><span><ShieldAlert size={15} /> Risk <strong>{formatMoney(setup.portfolioRiskUsd, "USD")}</strong></span><span>G/R <strong>{setup.riskReward.toFixed(1)}</strong></span><span>Güven <strong>{formatUnsignedPercent(setup.confidence, 0)}</strong></span></div>
    </> : <div className="wait-state compact"><Clock3 size={22} /><p>Koşulların tamamı aynı anda sağlanmadı. Yeni işlem açılmıyor.</p></div>}
    <ul className="reason-list">{setup.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
    {active ? <button className="button primary" type="button" disabled={alreadyPlanned} onClick={() => onPlan(setup)}>{alreadyPlanned ? "Günlükte mevcut" : "Planı günlüğe ekle"}</button> : null}
  </Card>;
}
