export type AssetClass = "foreignEquity" | "commodity" | "bitcoin" | "turkishEquity";
export type Currency = "TRY" | "USD" | "EUR";
export type DataStatus = "fresh" | "delayed" | "stale" | "unavailable";

export interface PricePoint {
  date: string;
  close: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
}

export interface MarketSnapshot {
  price: number;
  currency: Currency;
  asOf: string;
  source: string;
  status: DataStatus;
  changePercent?: number;
}

export interface Transaction {
  id: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  type: "buy" | "sell";
  quantity: number;
  unitPrice: number;
  currency: Currency;
  commission: number;
  date: string;
}

export type AssetClassRecord = Record<AssetClass, number>;

export interface AllocationItem {
  assetClass: AssetClass;
  label: string;
  weight: number;
  neutralWeight: number;
  amount: number;
  signal: number;
  confidence: number;
  explanation: string;
}

export interface AllocationResult {
  monthlyBudget: number;
  items: AllocationItem[];
  confidence: number;
  generatedAt: string;
}
