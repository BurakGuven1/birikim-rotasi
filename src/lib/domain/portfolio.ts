import type { AssetClass, Currency, MarketSnapshot, Transaction } from "./types";

interface Lot { quantity: number; unitCostTry: number }

export interface HoldingSummary {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  quantity: number;
  costBasis: number;
  averageCost: number;
  marketValue: number | null;
  unrealizedProfit: number | null;
  returnPercent: number | null;
  quote?: MarketSnapshot;
}

export interface PortfolioSummary {
  investedCapital: number;
  grossPurchases: number;
  salesProceeds: number;
  currentValue: number;
  realizedProfit: number;
  unrealizedProfit: number;
  totalProfit: number;
  returnPercent: number;
  holdings: HoldingSummary[];
  missingQuotes: string[];
}

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function calculatePortfolio(
  transactions: Transaction[],
  quotes: Record<string, MarketSnapshot>,
  fxRates: Partial<Record<Currency, number>>,
): PortfolioSummary {
  const positions = new Map<string, { name: string; assetClass: AssetClass; lots: Lot[] }>();
  let grossPurchases = 0;
  let salesProceeds = 0;
  let realizedProfit = 0;

  [...transactions].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).forEach((transaction) => {
    if (transaction.quantity <= 0 || transaction.unitPrice < 0 || transaction.commission < 0) return;
    const fx = fxRates[transaction.currency];
    if (!fx) return;
    const position = positions.get(transaction.symbol) ?? {
      name: transaction.name,
      assetClass: transaction.assetClass,
      lots: [],
    };
    positions.set(transaction.symbol, position);

    if (transaction.type === "buy") {
      const totalCost = (transaction.quantity * transaction.unitPrice + transaction.commission) * fx;
      position.lots.push({ quantity: transaction.quantity, unitCostTry: totalCost / transaction.quantity });
      grossPurchases += totalCost;
      return;
    }

    const available = position.lots.reduce((sum, lot) => sum + lot.quantity, 0);
    if (transaction.quantity > available + 1e-9) throw new Error(`${transaction.symbol} için satılabilir adetten fazla satış girildi.`);
    let remaining = transaction.quantity;
    let soldCost = 0;
    while (remaining > 1e-9) {
      const lot = position.lots[0];
      const used = Math.min(remaining, lot.quantity);
      soldCost += used * lot.unitCostTry;
      lot.quantity -= used;
      remaining -= used;
      if (lot.quantity <= 1e-9) position.lots.shift();
    }
    const netProceeds = (transaction.quantity * transaction.unitPrice - transaction.commission) * fx;
    salesProceeds += netProceeds;
    realizedProfit += netProceeds - soldCost;
  });

  const missingQuotes: string[] = [];
  const holdings = [...positions.entries()].flatMap(([symbol, position]) => {
    const quantity = position.lots.reduce((sum, lot) => sum + lot.quantity, 0);
    if (quantity <= 1e-9) return [];
    const costBasis = position.lots.reduce((sum, lot) => sum + lot.quantity * lot.unitCostTry, 0);
    const quote = quotes[symbol];
    const quoteFx = quote ? fxRates[quote.currency] : undefined;
    if (!quote || !quoteFx) missingQuotes.push(symbol);
    const marketValue = quote && quoteFx ? quote.price * quantity * quoteFx : null;
    const unrealizedProfit = marketValue === null ? null : marketValue - costBasis;
    return [{
      symbol,
      name: position.name,
      assetClass: position.assetClass,
      quantity,
      costBasis: roundMoney(costBasis),
      averageCost: roundMoney(costBasis / quantity),
      marketValue: marketValue === null ? null : roundMoney(marketValue),
      unrealizedProfit: unrealizedProfit === null ? null : roundMoney(unrealizedProfit),
      returnPercent: unrealizedProfit === null ? null : unrealizedProfit / costBasis,
      quote,
    }];
  });

  const currentValue = holdings.reduce((sum, holding) => sum + (holding.marketValue ?? 0), 0);
  const unrealizedProfit = holdings.reduce((sum, holding) => sum + (holding.unrealizedProfit ?? 0), 0);
  const investedCapital = grossPurchases - salesProceeds;
  const totalProfit = realizedProfit + unrealizedProfit;
  return {
    investedCapital: roundMoney(investedCapital),
    grossPurchases: roundMoney(grossPurchases),
    salesProceeds: roundMoney(salesProceeds),
    currentValue: roundMoney(currentValue),
    realizedProfit: roundMoney(realizedProfit),
    unrealizedProfit: roundMoney(unrealizedProfit),
    totalProfit: roundMoney(totalProfit),
    returnPercent: investedCapital > 0 ? totalProfit / investedCapital : 0,
    holdings,
    missingQuotes,
  };
}
