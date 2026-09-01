const assets = {
  BTC: "BTC-USD",
  GOLD: "GC=F",
  SILVER: "SI=F",
  SP500: "^GSPC",
  NASDAQ: "^IXIC",
  WORLD: "VT",
  BIST100: "XU100.IS",
  USDTRY: "TRY=X",
};

const years = [1, 3, 5, 10];
const now = Date.now();

const results = await Promise.all(Object.entries(assets).map(async ([name, symbol]) => {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10y&interval=1d&events=div%2Csplits`;
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 Birikim-Rotasi/1.0" } });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const payload = await response.json();
  const chart = payload.chart.result[0];
  const rows = chart.timestamp.map((timestamp, index) => [
    timestamp * 1000,
    chart.indicators.adjclose?.[0]?.adjclose?.[index] ?? chart.indicators.quote[0].close[index],
  ]).filter((row) => row[1] != null);
  const last = rows.at(-1);
  const dailyReturns = rows.slice(1).map((row, index) => row[1] / rows[index][1] - 1);
  const mean = dailyReturns.reduce((sum, value) => sum + value, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, dailyReturns.length - 1);
  let peak = rows[0][1];
  let maximumDrawdown = 0;
  rows.forEach((row) => { peak = Math.max(peak, row[1]); maximumDrawdown = Math.min(maximumDrawdown, row[1] / peak - 1); });
  const returns = Object.fromEntries(years.map((year) => {
    const target = now - year * 365.25 * 86_400_000;
    const start = rows.reduce((best, row) => Math.abs(row[0] - target) < Math.abs(best[0] - target) ? row : best, rows[0]);
    return [year, (last[1] / start[1] - 1) * 100];
  }));
  return { name, dataDate: new Date(last[0]).toISOString().slice(0, 10), price: last[1], returns, annualizedVolatility: Math.sqrt(variance) * Math.sqrt(name === "BTC" ? 365 : 252) * 100, maximumDrawdown: maximumDrawdown * 100 };
}));

const fx = results.find((item) => item.name === "USDTRY");
const comparison = results.filter((item) => item.name !== "USDTRY").map((item) => ({
  ...item,
  comparison: Object.fromEntries(years.map((year) => {
    const localReturn = item.returns[year] / 100;
    const fxReturn = fx.returns[year] / 100;
    return [year, item.name === "BIST100"
      ? { usd: ((1 + localReturn) / (1 + fxReturn) - 1) * 100, try: item.returns[year] }
      : { usd: item.returns[year], try: ((1 + localReturn) * (1 + fxReturn) - 1) * 100 }];
  })),
}));

console.log(JSON.stringify({ fx, comparison }, null, 2));
