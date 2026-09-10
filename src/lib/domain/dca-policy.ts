import type { AssetClass } from "./types";

export const DCA_WEIGHTS: Record<AssetClass, number> = { bitcoin: .35, foreignEquity: .45, commodity: .20, turkishEquity: 0 };
export const DCA_LABELS: Record<AssetClass, string> = { bitcoin: "BTC", foreignEquity: "VTI", commodity: "Altın (IAU)", turkishEquity: "BIST100" };
export function describeDcaBasket(weights: Record<AssetClass, number>) {
  return (Object.keys(weights) as AssetClass[]).filter(key => weights[key] > 0).map(key => `%${+(weights[key] * 100).toFixed(2)} ${DCA_LABELS[key]}`).join(" · ");
}
