import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

async function stubMarketApi(page: import("@playwright/test").Page) {
  await page.route("**/api/market/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/investment")) {
      const now = Date.now();
      const history = Array.from({ length: 260 }, (_, index) => ({ date: new Date(now - (260 - index) * 86400000).toISOString(), close: 100 + index * .2 }));
      const market = Object.fromEntries(["foreignEquity", "commodity", "turkishEquity", "bitcoin"].map(key => [key, { quote: { price: 152, currency: key === "turkishEquity" ? "TRY" : "USD", asOf: new Date(now).toISOString(), source: "E2E doğrulama verisi", status: "fresh" }, history, source: "E2E doğrulama verisi" }]));
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ market, fx: { price: 48.26, currency: "TRY", asOf: new Date(now).toISOString(), source: "E2E", status: "fresh" }, fxHistory: history.map(point => ({ ...point, close: 48.26 })), fetchedAt: new Date(now).toISOString(), errors: [] }) }); return;
    }
    if (url.pathname.endsWith("/quotes")) {
      const symbols = (url.searchParams.get("symbols") ?? "").split(",");
      const payload = Object.fromEntries(symbols.map((symbol, index) => [symbol, { ok: true, data: { price: symbol === "USDTRY" ? 48.26 : 100 + index * 12, currency: symbol === "USDTRY" || symbol === "BIST100" ? "TRY" : "USD", asOf: "2026-09-01T12:00:00Z", source: "E2E doğrulama verisi", status: "fresh", changePercent: index - 2 } }]));
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) }); return;
    }
    if (url.pathname.endsWith("/macro-history")) {
      const isCpi = url.searchParams.get("series") === "CPIAUCSL";
      const points = Array.from({ length: 180 }, (_, index) => ({ date: new Date(Date.UTC(2011, index, 1)).toISOString(), close: isCpi ? 225 + index * .6 : 10_000 + index * 70 }));
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ points, source: "FRED E2E" }) }); return;
    }
    if (url.pathname.endsWith("/history")) {
      const points = Array.from({ length: 260 }, (_, index) => ({ date: new Date(Date.UTC(2021, 0, 1 + index * 7)).toISOString(), open: 95 + index * .2, high: 102 + index * .2, low: 92 + index * .2, close: 98 + index * .2, volume: 1000 + index }));
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ points, source: "E2E doğrulama verisi" }) }); return;
    }
    if (url.pathname.endsWith("/macro")) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify([
        { id: "M2SL", label: "ABD M2 para arzı", value: 23218, change: 0.054, unit: "Milyar $", asOf: "2026-07-01T00:00:00Z", status: "delayed", source: "FRED API" },
        { id: "CPIAUCSL", label: "ABD tüketici fiyat endeksi", value: 332.813, change: 0.033, unit: "Endeks", asOf: "2026-07-01T00:00:00Z", status: "delayed", source: "FRED API" },
        { id: "DFII10", label: "ABD 10 yıllık reel faiz", value: 2.44, change: 0.62, unit: "%", asOf: "2026-08-31T00:00:00Z", status: "fresh", source: "FRED API" },
      ]) }); return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([{ name: "Test", active: true, keyRequired: false, coverage: "E2E" }]) });
  });
}

const pages = [
  { path: "/", heading: "Birikimini geleceğine dönüştür.", shot: "home-desktop" },
  { path: "/piyasa", heading: "Piyasa göstergeleri", shot: "market-desktop" },
  { path: "/portfoyum", heading: "Portföyüm", shot: "portfolio-desktop" },
  { path: "/swing", heading: "Swing masası", shot: "swing-desktop" },
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
    if (item.path === "/") {
      await expect(page.getByRole("heading", { name: "Yeni katkının dağılımı", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Ev hedefine giden yol", exact: true })).toBeVisible();
      await expect(page.getByText("Profil eksik · taslak", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Bu dönem ayıracağım tutar")).toHaveValue("1000");
    }
    if (item.path === "/piyasa") await expect(page.getByRole("heading", { name: "FRED makro göstergeleri", exact: true })).toBeVisible();
    if (item.path === "/swing") {
      await expect(page.getByText("İşlem başına risk", { exact: false })).toContainText("%0,50");
      await expect(page.getByText("Taktik tavan", { exact: false })).toContainText("%20");
    }
    if (item.path === "/ayarlar") {
      await expect(page.getByLabel("Yıllık ek katkı (USD)", { exact: true })).toHaveValue("0");
      await expect(page.getByLabel("Yıllık ek katkı ayı", { exact: true })).toHaveValue("1");
      await expect(page.getByLabel("Taktik bütçe (%)", { exact: true })).toHaveValue("20");
      await expect(page.getByLabel("İşlem başına risk (%)", { exact: true })).toHaveValue("0.5");
    }
    if (item.path === "/backtest") {
      await expect(page.getByTestId("exact-invested")).toContainText("$60.000");
      await expect(page.getByRole("columnheader", { name: "Reel USD getiri", exact: true })).toBeVisible();
      await expect(page.getByText("ABD TÜFE koruma eşiği", { exact: true })).toBeVisible();
      await expect(page.getByRole("cell", { name: "Aylık plan · %70/%30 walk-forward", exact: true })).toBeVisible();
      await expect(page.getByRole("cell", { name: "Çekirdek + kurallı swing", exact: true })).toBeVisible();
      await expect(page.getByRole("cell", { name: "%25 eşit sepet", exact: true })).toHaveCount(0);
      await expect(page.getByRole("cell", { name: "Maksimum statik", exact: true })).toHaveCount(0);
      await expect(page.getByRole("cell", { name: "Teorik üst sınır", exact: true })).toHaveCount(0);
    }
    await page.locator("html[data-theme]").waitFor({ state: "attached" });
    await page.screenshot({ path: `artifacts/ui/${item.shot}.png`, fullPage: false });
    expect(errors).toEqual([]);
  });
}

for (const item of [
  { path: "/", heading: "Birikimini geleceğine dönüştür.", shot: "home-mobile" },
  { path: "/swing", heading: "Swing masası", shot: "swing-mobile" },
  { path: "/ayarlar", heading: "Ayarlar ve veri kaynakları", shot: "settings-mobile" },
]) {
  test(`375 piksel ${item.heading} görünümü yatay taşma üretmez`, async ({ page }) => {
    await stubMarketApi(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(item.path, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: item.heading, exact: true })).toBeVisible();
    await page.locator("html[data-theme]").waitFor({ state: "attached" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/ui/${item.shot}.png`, fullPage: false });
  });
}

test("koyu tema etkinleşir ve okunabilir kalır", async ({ page }) => {
  await stubMarketApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("html[data-theme]").waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Koyu moda geç", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: "artifacts/ui/home-dark.png", fullPage: false });
});

test("risk profili ve karar anı sayfa yenilendiğinde korunur", async ({ page }) => {
  await stubMarketApi(page);
  await page.goto("/");
  await expect(page.getByText("Profil eksik · taslak", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Yatırım profilim", exact: true }).click();
  await page.getByLabel("Geçici düşüş toleransı", { exact: true }).selectOption("0.3");
  await page.getByLabel("Yüksek faizli borç", { exact: true }).selectOption("false");
  await page.getByRole("button", { name: "Profili kaydet", exact: true }).click();
  await expect(page.getByText("Plan hesaplandı", { exact: true })).toBeVisible();
  await page.getByLabel("Bu dönem ayıracağım tutar").fill("1200");
  await page.getByRole("button", { name: "Aylık katkıyı kaydet", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Aylık katkı tutarı kaydedildi." })).toBeVisible();
  await page.getByRole("button", { name: "Karar anını kaydet", exact: true }).click();
  await expect(page.getByText("Karar anı kaydedildi.", { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Bu dönem ayıracağım tutar")).toHaveValue("1200");
  await expect(page.getByText("Plan hesaplandı", { exact: true })).toBeVisible();
  await expect(page.locator(".decision-item")).toHaveCount(1);
  await page.screenshot({ path: "artifacts/ui/home-complete.png", fullPage: true });
});

test("eksik veri nakitte bekler ve borç cevabı alışları durdurur", async ({ page }) => {
  await stubMarketApi(page);
  await page.goto("/");
  await expect(page.getByText("Profil eksik · taslak", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Yatırım profilim", exact: true }).click();
  await page.getByLabel("Geçici düşüş toleransı", { exact: true }).selectOption("0.3");
  await page.getByLabel("Yüksek faizli borç", { exact: true }).selectOption("true");
  await page.getByRole("button", { name: "Profili kaydet", exact: true }).click();
  await expect(page.getByText("Yeni alım bekliyor", { exact: true })).toBeVisible();
  await expect(page.locator(".overview-line").filter({ hasText: "Varlıklara ayrılan" })).toContainText("$0,00");
  await page.reload();
  await expect(page.getByText("Yeni alım bekliyor", { exact: true })).toBeVisible();
  await page.route("**/api/market/investment", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ market: {}, fxHistory: [], fetchedAt: new Date().toISOString(), errors: ["Test: kaynak erişilemiyor"] }) }));
  await page.getByRole("button", { name: "Verileri yenile", exact: true }).click();
  await expect(page.getByText("Yeterli piyasa verisi yok; katkı nakitte bekler.", { exact: true })).toBeVisible();
  await expect(page.locator(".overview-line").filter({ hasText: "Nakitte bekleyen" })).toContainText("$1.000,00");
});
