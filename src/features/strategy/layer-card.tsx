import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui";
import { formatMoney, formatUnsignedPercent } from "@/lib/format";

export function LayerCard({
  icon: Icon,
  label,
  share,
  amount,
  tone,
  description,
}: {
  icon: LucideIcon;
  label: string;
  share: number;
  amount: number;
  tone: "core" | "tactical" | "reserve";
  description: string;
}) {
  return <Card className={`route-layer ${tone}`}>
    <div className="route-layer-head"><span className="route-layer-icon"><Icon size={19} /></span><span className="route-layer-share">{formatUnsignedPercent(share, 0)}</span></div>
    <p className="metric-label">{label}</p>
    <p className="route-layer-amount">{formatMoney(amount, "USD")}</p>
    <p className="muted">{description}</p>
  </Card>;
}
