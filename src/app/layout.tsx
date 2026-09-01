import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "Birikim Rotası",
  description: "Yerel çalışan açıklanabilir yatırım ve portföy takip paneli",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="tr" suppressHydrationWarning><body><a className="skip-link" href="#main-content">Ana içeriğe geç</a><ThemeProvider><AppShell>{children}</AppShell></ThemeProvider></body></html>;
}
