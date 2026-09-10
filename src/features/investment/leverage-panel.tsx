import Link from "next/link";
import { Card } from "@/components/ui";
import type { InvestmentPolicy } from "@/lib/domain/investment-policy";
import type { MonthlyInvestment } from "@/lib/domain/monthly-investment";
import { formatMoney } from "@/lib/format";
export function LeveragePanel({policy,plan}:{policy:InvestmentPolicy;plan:MonthlyInvestment}) {
  if(!policy.leverageIdeas)return null;
  return <Card><div className="card-title"><div><h2>Price action · long / short</h2><p>BTC/ETH en çok 2x; ABD hisse ve ETF long 1x</p></div></div><p>Toplam swing teminatı en çok {formatMoney(plan.portfolioUsd*.1,"USD")}; işlem başına maliyet dahil planlanan stop riski en çok {formatMoney(plan.portfolioUsd*.005,"USD")}.</p><p className="small-copy muted">Sadece mevcut kayıtlı sermaye kullanılır. Açık işlemler, kullanılabilir Earn bakiyesi ve BTC brüt %40 sınırı işlem masasında birlikte kontrol edilir. Uygun giriş ve iki gerçek karşı seviye yoksa beklenir.</p><Link className="button primary" href="/swing">Swing masası ve işlem kanıtı →</Link></Card>;
}
