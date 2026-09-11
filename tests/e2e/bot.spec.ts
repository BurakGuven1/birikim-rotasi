import { test, expect } from '@playwright/test';
import { defaultBotSettings } from '../../src/lib/bot/config';

const base = {
    settings: defaultBotSettings, enabled: false, mode: 'paper', strategy: { id: 'SuperTrend 4H', version: 'st-1.0.0' }, liveLocked: true,
    credentials: { live: { configured: false, missing: ['OKX_API_KEY'] }, demo: { configured: false, missing: ['OKX_DEMO_API_KEY'] } },
    worker: { online: false, heartbeat: null }, paper: { cash: 200, equity: 200, day: '', dayStartEquity: 200, dailyHalted: false, positions: [], trades: [], lastCycle: null },
  scan: null, jobs: [], events: [], backtests: [], comparison: null, progress: null, portfolio: null,
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/bot/session', route => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/bot/status', route => route.fulfill({ json: base }));
});

test('absent comparison shows honest empty state and no fabricated metrics', async ({ page }) => {
  await page.goto('/bot');
  await expect(page.getByText('Karşılaştırmayı başlatın; her coin için MPA ve SuperTrend modellerinin')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Karşılaştır' })).toBeEnabled();
  await expect(page.getByText('Kazanma', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Worker çevrimdışı')).toBeVisible();
});

test('quick fill loads the liquid universe and states the run size', async ({ page }) => {
  let command: unknown;
  await page.route('**/api/bot/command', async route => { command = route.request().postDataJSON(); await route.fulfill({ json: { ok: true } }); });
  await page.goto('/bot');
  await page.getByRole('button', { name: 'En likit 20 coini doldur' }).click();
  await expect(page.getByText('20 coin × 2 strateji × 3 dilim = 120 backtest')).toBeVisible();
  await page.getByRole('button', { name: 'Karşılaştır' }).click();
  expect((command as { instruments: string[] }).instruments).toHaveLength(20);
});

test('comparison is refused while no strategy is defined', async ({ page }) => {
  await page.route('**/api/bot/status', route => route.fulfill({ json: { ...base, strategy: null } }));
  await page.goto('/bot');
  await expect(page.getByRole('button', { name: 'Karşılaştır' })).toBeDisabled();
});

test('trades tab shows paper account without live orders', async ({ page }) => {
  await page.goto('/bot');
  await expect(page.getByText('Paper · gerçek emirler kapalı')).toBeVisible();
  await page.getByRole('tab', { name: /İşlemler/ }).click();
  await expect(page.getByRole('heading', { name: 'Paper işlemleri' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Açık pozisyonlar' })).toBeVisible();
});

test('cross-sectional tab explains itself before any run and can be started', async ({ page }) => {
  let command: unknown;
  await page.route('**/api/bot/command', async route => { command = route.request().postDataJSON(); await route.fulfill({ json: { ok: true } }); });
  await page.goto('/bot');
  await page.getByRole('tab', { name: /Kesitsel/ }).click();
  await expect(page.getByRole('heading', { name: 'Kesitsel momentum' })).toBeVisible();
  await expect(page.getByText('Çalıştırın; günlük kapanışlarla')).toBeVisible();
  await page.getByRole('button', { name: 'Çalıştır' }).click();
  expect(command).toEqual({ action: 'portfolio', coins: 45, days: 365 });
});

test('cross-sectional result is shown with its universe sensitivity, not as a single number', async ({ page }) => {
  const metrics = (returnPercent: number) => ({ days: 90, returnPercent, sharpe: 1, maxDrawdownPercent: 8, averageTurnoverPercent: 40 });
  await page.route('**/api/bot/status', route => route.fulfill({ json: { ...base, portfolio: {
    id: 'p1', createdAt: Date.now(), from: Date.now() - 86400000, to: Date.now(), coins: ['BTC-USDT-SWAP'], skipped: [], costRate: .0005,
    walkForward: metrics(44.1), picks: [{ from: 0, lookbackDays: 14, positions: 5 }], grid: [],
    sensitivity: [{ universe: 20, metrics: metrics(-19.3) }, { universe: 45, metrics: metrics(48.9) }],
    current: { time: 0, ret: 0, turnover: 0, longs: ['ARB-USDT-SWAP'], shorts: ['XRP-USDT-SWAP'] },
  } } }));
  await page.goto('/bot');
  await page.getByRole('tab', { name: /Kesitsel/ }).click();
  await expect(page.getByText('Bu sayıya güvenmeyin.')).toBeVisible();
  await expect(page.getByRole('note')).toContainText('20 coin: %-19,3');
  await expect(page.getByRole('note')).toContainText('45 coin: %48,9');
});

test('settings submission preserves unedited settings', async ({ page }) => {
  let command: unknown;
  await page.route('**/api/bot/command', async route => { command = route.request().postDataJSON(); await route.fulfill({ json: { ok: true } }); });
  await page.goto('/bot');
  await page.getByText('Ayarlar ve çalışma ayrıntıları').click();
  await page.getByLabel('Risk tavanı (%)', { exact: true }).fill('2.2');
  await page.getByRole('button', { name: 'Ayarları kaydet' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Ayarlar kaydedildi' })).toBeVisible();
  expect(command).toEqual({ action: 'settings', settings: { ...defaultBotSettings, riskPercent: 2.2 } });
});

test('command failure is visible and retryable', async ({ page }) => {
  await page.route('**/api/bot/command', route => route.fulfill({ status: 503, json: { error: 'Komut kuyruğa alınamadı.' } }));
  await page.goto('/bot');
  await page.getByRole('button', { name: 'Tara' }).click();
  const alert = page.locator('.bot-workspace').getByRole('alert');
  await expect(alert).toContainText('Komut kuyruğa alınamadı.');
  await expect(alert.getByRole('button', { name: 'Yeniden dene' })).toBeVisible();
});

test('mobile page does not overflow horizontally', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/bot');
  await expect(page.getByRole('heading', { name: 'Trading bot' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
