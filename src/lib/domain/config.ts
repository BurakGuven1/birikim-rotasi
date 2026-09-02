import type { AssetClass, AssetClassRecord } from "./types";

export const ASSET_CLASSES: AssetClass[] = [
  "foreignEquity",
  "commodity",
  "bitcoin",
  "turkishEquity",
];

export const ASSET_LABELS: Record<AssetClass, string> = {
  foreignEquity: "S&P 500 / ABD hisseleri",
  commodity: "Emtia / değerli maden",
  bitcoin: "Bitcoin",
  turkishEquity: "Türk hisse / fon",
};

export interface AssetClassConstraint {
  min: number;
  neutral: number;
  max: number;
  sensitivity: number;
}

export const ALLOCATION_CONSTRAINTS: Record<AssetClass, AssetClassConstraint> = {
  foreignEquity: { min: 0.25, neutral: 0.35, max: 0.5, sensitivity: 0.12 },
  commodity: { min: 0.1, neutral: 0.25, max: 0.4, sensitivity: 0.1 },
  bitcoin: { min: 0.05, neutral: 0.2, max: 0.45, sensitivity: 0.22 },
  turkishEquity: { min: 0.1, neutral: 0.2, max: 0.35, sensitivity: 0.1 },
};

export const NEUTRAL_WEIGHTS: AssetClassRecord = {
  foreignEquity: 0.35,
  commodity: 0.25,
  bitcoin: 0.2,
  turkishEquity: 0.2,
};

export const DEFAULT_MONTHLY_BUDGET = 50_000;
export const MONTHLY_TURNOVER_CAP = 0.1;
