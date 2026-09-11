import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto("http://127.0.0.1:3000/takip-listesi");
  await page.getByRole("button", { name: "Güncelle", exact: true }).click();
  await page.getByRole("button", { name: "Güncelle", exact: true }).waitFor({ state: "visible" });
  await page.locator(".opportunities-table tbody tr").first().waitFor({ timeout: 45000 });
  console.log("US", await page.locator(".opportunities-stats").innerText());
  await page.locator(".opportunities-header").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/opportunities-live-us.png" });
  await page.getByRole("tab", { name: /BIST 100/ }).click();
  console.log("TR", await page.locator(".opportunities-stats").innerText());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".opportunities-header").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/opportunities-live-tr-mobile.png" });
  console.log("horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
} finally { await browser.close(); }
