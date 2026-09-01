import { AlertTriangle, CheckCircle2, Clock3, DatabaseZap } from "lucide-react";
import type { DataStatus } from "@/lib/domain/types";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: React.ReactNode }) {
  return <header className="page-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1><p>{description}</p></div>{actions && <div className="header-actions">{actions}</div>}</header>;
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function StatusBadge({ status }: { status: DataStatus }) {
  const config = {
    fresh: { label: "Güncel", icon: CheckCircle2 },
    delayed: { label: "Gecikmeli", icon: Clock3 },
    stale: { label: "Veri eski", icon: AlertTriangle },
    unavailable: { label: "Veri yok", icon: DatabaseZap },
  }[status];
  const Icon = config.icon;
  return <span className={`status-badge ${status}`}><Icon size={13} />{config.label}</span>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="empty-state"><DatabaseZap size={28} /><h3>{title}</h3><p>{description}</p>{action}</div>;
}
