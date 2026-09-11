"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bot, Compass, ChartNoAxesCombined, Home, ListChecks, Moon, Settings2, Sun, WalletCards, Zap } from "lucide-react";
import { useTheme } from "./theme-provider";

const links = [
  { href: "/", label: "Yatırım merkezi", icon: Home },
  { href: "/portfoyum", label: "Portföy", icon: WalletCards },
  { href: "/takip-listesi", label: "Hisse takip", icon: ListChecks },
  { href: "/piyasa", label: "Analiz", icon: ChartNoAxesCombined },
  { href: "/backtest", label: "Backtest", icon: BarChart3 },
  { href: "/bot", label: "Kripto bot", icon: Bot },
  { href: "/eth-bot", label: "ETH Bot", icon: Zap },
  { href: "/ayarlar", label: "Ayarlar", icon: Settings2 },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="Birikim Rotası ana sayfa">
          <span className="brand-mark"><Compass size={24} /></span>
          <span><strong>Birikim</strong><small>Rotası</small></span>
        </Link>
        <p className="nav-section-label">ÇALIŞMA ALANIN</p>
        <nav className="side-nav" aria-label="Ana navigasyon">
          {links.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={active ? "nav-link active" : "nav-link"}><Icon size={19} /><span>{label}</span></Link>;
          })}
        </nav>
        <div className="sidebar-goal"><span>UZUN VADELİ HEDEF</span><strong>Bir ev. Güçlü bir birikim.</strong><p>Her ay küçük bir adım,<br />yıllar içinde daha fazla seçenek.</p><Link href="/arastirma">Yatırım pusulası ↗</Link></div>
        <div className="sidebar-foot">
          <button className="theme-button" onClick={toggle} type="button" aria-label={theme === "light" ? "Koyu moda geç" : "Açık moda geç"}>
            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}<span>{theme === "light" ? "Koyu mod" : "Açık mod"}</span>
          </button>
          <p>Veriler yalnızca bu cihazda</p>
        </div>
      </aside>
      <main className="main-content" id="main-content">{children}</main>
      <nav className="mobile-nav" aria-label="Mobil navigasyon">
        {links.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={active ? "mobile-link active" : "mobile-link"}><Icon size={20} /><span>{href === "/" ? "Merkez" : href === "/swing" ? "Swing" : label}</span></Link>;
        })}
      </nav>
    </div>
  );
}
