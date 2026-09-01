"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bitcoin, ChartNoAxesCombined, FlaskConical, Home, Moon, Settings2, Sun, WalletCards } from "lucide-react";
import { useTheme } from "./theme-provider";

const links = [
  { href: "/", label: "Aylık Plan", icon: Home },
  { href: "/piyasa", label: "Piyasa", icon: ChartNoAxesCombined },
  { href: "/portfoyum", label: "Portföyüm", icon: WalletCards },
  { href: "/backtest", label: "Backtest", icon: BarChart3 },
  { href: "/arastirma", label: "Metodoloji", icon: FlaskConical },
  { href: "/ayarlar", label: "Ayarlar", icon: Settings2 },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="Birikim Rotası ana sayfa">
          <span className="brand-mark"><Bitcoin size={21} /></span>
          <span><strong>Birikim</strong><small>Rotası</small></span>
        </Link>
        <nav className="side-nav" aria-label="Ana navigasyon">
          {links.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return <Link key={href} href={href} className={active ? "nav-link active" : "nav-link"}><Icon size={19} /><span>{label}</span></Link>;
          })}
        </nav>
        <div className="sidebar-foot">
          <button className="theme-button" onClick={toggle} type="button" aria-label={theme === "light" ? "Koyu moda geç" : "Açık moda geç"}>
            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}<span>{theme === "light" ? "Koyu mod" : "Açık mod"}</span>
          </button>
          <p>Veriler yalnızca bu cihazda</p>
        </div>
      </aside>
      <main className="main-content" id="main-content">{children}</main>
      <nav className="mobile-nav" aria-label="Mobil navigasyon">
        {links.slice(0, 5).map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return <Link key={href} href={href} className={active ? "mobile-link active" : "mobile-link"}><Icon size={20} /><span>{label.replace("Aylık ", "")}</span></Link>;
        })}
      </nav>
    </div>
  );
}
