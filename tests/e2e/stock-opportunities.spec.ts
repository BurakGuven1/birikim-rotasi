import { expect, test } from "@playwright/test";
import type { StockMarket, StockSnapshot } from "../../src/lib/domain/stock-watchlist";

function snapshot(market: StockMarket, changed = false): StockSnapshot {
  const stamp = new Date(Date.now() - (changed ? 60_000 : 120_000)).toISOString();
  return { market, fetchedAt: stamp, source: "Test fixture", rows: Array.from({ length: 10 }, (_, i) => ({
    symbol: market === "US" ? `S${i}` : `T${i}.IS`, ticker: market === "US" ? `S${i}` : `T${i}`, name: `Fixture company ${i}`, market, sector: "Technology services", scannerSymbol: `${market === "US" ? "NASDAQ:S" : "BIST:T"}${i}`, currency: market === "US" ? "USD" : "TRY", price: 100, change: 0, pe: 10 + i, pb: 1 + i, evEbitda: 5 + i, marketCap: 1e9, sma200Weekly: 50, smaDistance: 100, priceAsOf: stamp, delayMinutes: 15,
    fundamentals: { industry: "Software", roe: 30 - i, roa: 10, roic: 25 - i, debt: 100, ebitda: 100, priceFcf: 10 + i, operatingCashflow: changed && i === 0 ? -50 : 150 - i, netIncome: 100, epsGrowth: 10, revenueGrowth: 5, perf1m: 0, perf6m: 30 - i, perf12m: 50 - i, reportedAt: new Date(Date.now() - 30 * 86400000).toISOString(), fScore: 8 },
  })) };
}

test("opportunity ranking survives filters, market switching, reload and reports deterioration", async ({ page }) => {
  let changed = false;
  let latest: Partial<Record<StockMarket, StockSnapshot>> = {};
  let repeat = false;
  await page.route("**/api/market/watchlist", route => {
    const market: StockMarket = route.request().postDataJSON().market;
    if (!repeat) latest = { ...latest, [market]: { ...snapshot(market, changed), cached: changed } };
    return route.fulfill({ json: latest[market] });
  });
  await page.goto("/takip-listesi");
  await page.getByRole("button", { name: "Güncelle", exact: true }).click();
  const panel = page.getByRole("region", { name: "Kaliteyi uygun fiyatla bul." });
  await expect(panel.locator("tbody tr")).toHaveCount(5);
  await expect(panel.locator("tbody tr").first()).toContainText("S0");
  await expect(panel).toContainText("Ön değerlendirme · geçmiş test yok");
  await page.getByRole("button", { name: "SMA altında", exact: true }).click();
  await expect(panel.locator("tbody tr")).toHaveCount(5);
  await page.getByRole("tab", { name: /BIST 100/ }).click();
  await expect(panel.locator("tbody tr").first()).toContainText("T0");
  await page.reload();
  await expect(panel.locator("tbody tr").first()).toContainText("S0");
  changed = true;
  await page.getByRole("button", { name: "Güncelle", exact: true }).click();
  await expect(panel.locator("tbody tr").first()).not.toContainText("S0");
  await expect(panel.locator(".opportunities-exits")).toContainText("S0");
  await expect(panel.locator(".opportunities-exits")).toContainText("nakit");
  repeat = true;
  await page.getByRole("button", { name: "Güncelle", exact: true }).click();
  await expect(page.getByRole("button", { name: "Güncelle", exact: true })).toBeEnabled();
  await expect(panel.locator(".opportunities-exits")).toContainText("S0");
  await page.reload();
  await expect(panel.locator(".opportunities-exits")).toContainText("S0");
});

test("mobile ranking stays within viewport and exposes underlying metrics", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/market/watchlist", route => route.fulfill({ json: snapshot(route.request().postDataJSON().market) }));
  await page.goto("/takip-listesi");
  await page.getByRole("button", { name: "Güncelle", exact: true }).click();
  const panel = page.getByRole("region", { name: "Kaliteyi uygun fiyatla bul." });
  await expect(panel.locator("tbody tr")).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await panel.locator(".opportunity-details summary").first().click();
  await expect(panel.locator(".opportunity-details[open]")).toContainText("ROIC · ROE");
  await panel.locator(".opportunity-details summary").first().click();
  await panel.locator(".watchlist-table-scroll").evaluate(el => { el.scrollLeft = 0; });
  await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: "artifacts/opportunities-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "artifacts/opportunities-desktop.png", fullPage: true });
});

test("old cached prices never appear as a current opportunity", async ({ page }) => {
  const old = snapshot("US"); old.fetchedAt = "2020-01-01T00:00:00Z";
  await page.addInitScript(value => localStorage.setItem("birikim-stock-watchlist-v1", JSON.stringify({ US: value })), old);
  await page.goto("/takip-listesi");
  const panel = page.getByRole("region", { name: "Kaliteyi uygun fiyatla bul." });
  await expect(panel).toContainText("Şu an koşulları geçen aday yok.");
  await expect(panel.locator("tbody tr")).toHaveCount(0);
  await panel.getByText(/Listeye alınmayan .* hisse ve nedenleri/).click();
  await expect(panel).toContainText("Piyasa kaydı eski; yeniden güncelle.");
});
