import { expect, test } from "@playwright/test";

test("historical portfolio and personal chart work on desktop and mobile", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const through = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.parse(through) - 700 * 86_400_000);
  const tradeDate = new Date(Date.parse(through) - 10 * 86_400_000).toISOString().slice(0, 10);
  let historiesRequested = 0;
  await page.route("**/api/market/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/quotes")) {
      const body = Object.fromEntries((url.searchParams.get("symbols") ?? "").split(",").map(symbol => [symbol, { ok: true, data: { price: symbol === "USDTRY" ? 40 : 120, currency: symbol === "USDTRY" ? "TRY" : "USD", asOf: `${through}T00:00:00Z`, source: "Test", status: "fresh" } }]));
      return route.fulfill({ json: body });
    }
    if (url.pathname.endsWith("/history")) {
      historiesRequested++;
      const fx = url.searchParams.get("symbol") === "USDTRY";
      const points = Array.from({ length: 701 }, (_, index) => ({ date: new Date(start.getTime() + index * 86_400_000).toISOString(), open: fx ? 40 : 100, high: fx ? 40 : 125, low: fx ? 40 : 95, close: fx ? 40 : 120, volume: 1000 }));
      return route.fulfill({ json: { points, source: "Test" } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/portfoyum");
  await page.getByLabel("Sembol", { exact: true }).fill("BTC");
  await page.getByLabel("Varlık adı").fill("Bitcoin");
  await page.getByLabel("Adet", { exact: true }).fill("2");
  await page.getByLabel("Birim fiyat").fill("100");
  await page.getByLabel("Para birimi").selectOption("USD");
  await page.getByLabel("Komisyon", { exact: true }).fill("2");
  await page.getByLabel("İşlem tarihi").fill(tradeDate);
  await page.getByRole("button", { name: "İşlem ekle", exact: true }).click();
  await expect(page.getByRole("button", { name: "Portföy geçmişini hesapla" })).toBeVisible();
  expect(historiesRequested).toBe(0);
  await page.getByRole("button", { name: "Portföy geçmişini hesapla" }).click();
  await expect(page.getByRole("button", { name: "Geçmişi yenile" })).toBeVisible();
  await expect(page.locator("p").filter({ hasText: /Net yatırılan .*8\.080/ })).toBeVisible();
  await expect(page.getByText(/Varlık değeri .*9\.600/)).toBeVisible();
  await page.screenshot({ path: "artifacts/ui/portfolio-history-desktop.png", fullPage: true });
  await page.goto("/varlik/BTC");
  await expect(page.locator(".chart-caption")).toContainText("701 gözlem");
  await expect(page.getByText(/FIFO maliyeti:.*101/)).toBeVisible();
  const canvas = await page.locator(".price-chart-canvas canvas").first().elementHandle();
  await page.getByRole("button", { name: "1 yıl", exact: true }).click();
  await page.getByRole("button", { name: "Çizgiye geç" }).click();
  expect(await canvas!.evaluate(node => node.isConnected)).toBe(true);
  await page.getByRole("button", { name: "Tam ekran", exact: true }).click();
  await expect(page.locator(".price-chart-expanded")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".price-chart-expanded")).toHaveCount(0);
  await page.screenshot({ path: "artifacts/ui/personal-chart-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Tam ekran", exact: true }).click();
  await expect(page.getByRole("button", { name: "Grafiği küçült" })).toBeVisible();
  const expanded = await page.locator(".price-chart-expanded").boundingBox();
  expect(expanded?.y).toBe(0);
  expect(expanded?.height).toBe(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/ui/personal-chart-mobile.png", fullPage: false });
  expect(errors).toEqual([]);
});
