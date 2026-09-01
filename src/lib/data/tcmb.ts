import type { MarketDataProvider } from "./provider";

export const tcmbProvider: MarketDataProvider = {
  id: "TCMB",
  supports: (symbol) => symbol.toUpperCase() === "USDTRY",
  async getQuote() {
    const response = await fetch("https://www.tcmb.gov.tr/kurlar/today.xml", { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`TCMB ${response.status}`);
    const xml = await response.text();
    const block = xml.match(/<Currency[^>]*CurrencyCode="USD"[\s\S]*?<\/Currency>/)?.[0];
    const price = Number(block?.match(/<ForexSelling>([^<]+)<\/ForexSelling>/)?.[1]);
    const date = xml.match(/Tarih_Date[^>]*Date="([^"]+)"/)?.[1];
    if (!price || !date) throw new Error("TCMB kur verisi çözümlenemedi.");
    const [month, day, year] = date.split("/");
    return { price, currency: "TRY", asOf: `${year}-${month}-${day}T15:30:00+03:00`, source: "TCMB günlük kur", status: "delayed" };
  },
  async getHistory() { return []; },
};
