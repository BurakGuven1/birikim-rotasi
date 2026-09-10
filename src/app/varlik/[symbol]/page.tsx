import { AssetDetail } from "@/features/market/asset-detail";

export default async function AssetPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  return <AssetDetail key={symbol} symbol={decodeURIComponent(symbol).toUpperCase()} />;
}
