import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

async function stubMarketApi(page: import("@playwright/test").Page) {
  await page.route("**/api/market/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/quotes")) {
      const symbols = (url.searchParams.get("symbols") ?? "").split(",");
      const payload = Object.fromEntries(symbols.map((symbol, index) => [symbol, { ok: true, data: { price: symbol === "USDTRY" ? 48.26 : 100 + index * 12, currency: symbol === "USDTRY" || symbol === "BIST100" ? "TRY" : "USD", asOf: "2026-09-01T12:00:00Z", source: "E2E doğrulama verisi", status: "fresh", changePercent: index - 2 } }]));
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) }); return;
    }
    if (url.pathname.endsWith("/history")) {
      const points = Array.from({ length: 260 }, (_, index) => ({ date: new Date(Date.UTC(2021, 0, 1 + index * 7)).toISOString(), open: 95 + index * .2, high: 102 + index * .2, low: 92 + index * .2, close: 98 + index * .2, volume: 1000 + index }));
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ points, source: "E2E doğrulama verisi" }) }); return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([{ name: "Test", active: true, keyRequired: false, coverage: "E2E" }]) });
  });
}

const pages = [
  { path: "/", heading: "Bu ayın birikim rotası", shot: "home-desktop" },
  { path: "/piyasa", heading: "Piyasa göstergeleri", shot: "market-desktop" },
  { path: "/portfoyum", heading: "Portföyüm", shot: "portfolio-desktop" },
  { path: "/backtest", heading: "Düzenli alım backtesti", shot: "backtest-desktop" },
  { path: "/ayarlar", heading: "Ayarlar ve veri kaynakları", shot: "settings-desktop" },
  { path: "/varlik/BTC", heading: "Bitcoin", shot: "asset-desktop" },
];

test.beforeAll(async () => { await mkdir("artifacts/ui", { recursive: true }); });

for (const item of pages) {
  test(`${item.heading} ekranı açılır ve konsol hatası üretmez`, async ({ page }) => {
    await stubMarketApi(page);
    const errors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(item.path, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: item.heading, exact: true })).toBeVisible();
    await page.locator("html[data-theme]").waitFor({ state: "attached" });
    await page.screenshot({ path: `artifacts/ui/${item.shot}.png`, fullPage: false });
    expect(errors).toEqual([]);
  });
}

test("375 piksel mobil görünüm yatay taşma üretmez", async ({ page }) => {
  await stubMarketApi(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Bu ayın birikim rotası", exact: true })).toBeVisible();
  await page.locator("html[data-theme]").waitFor({ state: "attached" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/ui/home-mobile.png", fullPage: false });
});

test("koyu tema etkinleşir ve okunabilir kalır", async ({ page }) => {
  await stubMarketApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("html[data-theme]").waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Koyu moda geç", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: "artifacts/ui/home-dark.png", fullPage: false });
});
