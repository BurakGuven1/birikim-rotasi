# Core-Tactical Investment Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing monthly allocation dashboard into a risk-budgeted personal investment route with a protected core, a measurable swing sleeve, an opportunity reserve, and annual top-up support.

**Architecture:** Keep the existing market-provider and portfolio-accounting layers intact. Add pure strategy and tactical domain modules, persist strategy settings and a tactical journal in IndexedDB, then compose a new action-first route dashboard and swing desk from those interfaces. Reuse the existing history API and make missing/stale data produce `wait`, never a fabricated setup.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript 5.9, Dexie 4, Recharts, Lucide React, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-04-core-tactical-investment-engine-design.md`

## Global Constraints

- Default cash flow is USD 1,000 monthly plus USD 3,750 once yearly.
- Default layer targets are 70% core, 20% tactical, and 10% reserve; tactical may fall to zero but never exceed 25%.
- Per-trade portfolio risk is 0.50%; minimum risk/reward is 2.0; minimum setup confidence is 60%.
- A 12% tactical drawdown halves the sleeve and an 18% drawdown blocks new tactical positions.
- Version the IndexedDB schema without deleting version-1 portfolio transactions or settings.
- Long-only setups only; no leverage, shorting, options, broker connection, or automatic order execution.
- API keys stay server-side; missing data returns a safe wait state.
- UI copy separates the 10–11% real-USD target from achieved performance and never promises returns.

---

### Task 1: Strategy Profile and Contribution Routing

**Files:**
- Create: `src/lib/domain/strategy.ts`
- Create: `src/lib/domain/strategy.test.ts`
- Modify: `src/lib/domain/config.ts`

**Interfaces:**
- Produces: `StrategyProfile`, `ContributionPlan`, `DEFAULT_STRATEGY_PROFILE`, `buildContributionPlan(profile, month, options)`, `tacticalShareForDrawdown(baseShare, drawdown)`.
- Consumes: no UI or persistence state.

- [ ] **Step 1: Write failing contribution and risk-brake tests**

```ts
it("routes an exact monthly contribution into 70/20/10 layers", () => {
  expect(buildContributionPlan(DEFAULT_STRATEGY_PROFILE, 5, { hasEligibleSetup: true })).toMatchObject({
    total: 1_000, core: 700, tactical: 200, reserve: 100,
  });
});

it("moves tactical cash to reserve when there is no setup", () => {
  expect(buildContributionPlan(DEFAULT_STRATEGY_PROFILE, 5, { hasEligibleSetup: false })).toMatchObject({
    core: 700, tactical: 0, reserve: 300,
  });
});

it("deploys half of the annual top-up immediately and stages half over three months", () => {
  const first = buildContributionPlan(DEFAULT_STRATEGY_PROFILE, 1, { hasEligibleSetup: false });
  expect(first.total).toBe(3_500);
  expect(first.annualImmediateCore).toBe(1_875);
  expect(first.annualStaged).toBe(625);
});

it("blocks tactical allocation at an 18% drawdown", () => {
  expect(tacticalShareForDrawdown(0.2, -0.18)).toBe(0);
});
```

- [ ] **Step 2: Run `npm test -- src/lib/domain/strategy.test.ts` and confirm missing-module failure**

- [ ] **Step 3: Implement immutable defaults and exact-cent routing**

```ts
export interface StrategyProfile {
  monthlyContributionUsd: number;
  annualContributionUsd: number;
  annualContributionMonth: number;
  coreShare: number;
  tacticalShare: number;
  reserveShare: number;
  perTradeRisk: number;
  minRiskReward: number;
  minConfidence: number;
  targetRealReturnMin: number;
  targetRealReturnMax: number;
}

export function tacticalShareForDrawdown(baseShare: number, drawdown: number) {
  if (drawdown <= -0.18) return 0;
  if (drawdown <= -0.12) return baseShare / 2;
  return Math.min(0.25, Math.max(0, baseShare));
}
```

`buildContributionPlan` must validate positive inputs, add `annualContributionUsd / 2` to core in the selected month, add `annualContributionUsd / 6` to staged capital in the selected month and following two calendar months, move unused tactical capital to reserve, and make the returned buckets sum exactly to `total`.

- [ ] **Step 4: Run the focused test and confirm PASS**

- [ ] **Step 5: Commit with `feat: add core tactical contribution strategy`**

### Task 2: Long-Only Swing Setup and Position Sizing

**Files:**
- Create: `src/lib/domain/tactical.ts`
- Create: `src/lib/domain/tactical.test.ts`
- Modify: `src/lib/domain/types.ts`

**Interfaces:**
- Produces: `TacticalSetup`, `TacticalTrade`, `deriveTacticalSetup(input)`, `calculatePositionSize(input)`, `reviewTacticalBudget(input)`.
- Consumes: `PricePoint` and `StrategyProfile`.

- [ ] **Step 1: Write failing setup tests**

```ts
it("returns wait when fewer than 200 observations exist", () => {
  expect(deriveTacticalSetup({ symbol: "SP500", name: "S&P 500", prices: points(80), portfolioValueUsd: 20_000, profile }).action).toBe("wait");
});

it("creates a sized long setup only when trend, momentum, confidence and reward agree", () => {
  const setup = deriveTacticalSetup({ symbol: "SP500", name: "S&P 500", prices: trendingPoints(260), portfolioValueUsd: 20_000, profile });
  expect(setup.action).toBe("long");
  expect(setup.riskReward).toBeGreaterThanOrEqual(2);
  expect(setup.positionSizeUsd).toBeLessThanOrEqual(5_000);
  expect(setup.invalidation).toBeLessThan(setup.entryZone[0]);
});

it("never sizes more than the tactical sleeve", () => {
  expect(calculatePositionSize({ portfolioValueUsd: 10_000, entry: 100, invalidation: 99, perTradeRisk: 0.005, tacticalCapShare: 0.2 })).toBe(2_000);
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

- [ ] **Step 3: Implement deterministic indicators and setup output**

Use a 50-day and 200-day simple moving average, 126-to-21-day momentum, 14-day ATR, and a pullback distance capped by ATR. A setup is `long` only when price is above SMA200, SMA50 is above SMA200, momentum is positive, confidence is at least the configured threshold, and target-one reward/risk is at least the configured minimum. Otherwise return `wait` with Turkish reasons and no position size.

```ts
export interface TacticalSetup {
  id: string;
  symbol: string;
  name: string;
  action: "long" | "wait";
  generatedAt: string;
  expiresAt: string;
  entryZone: [number, number];
  invalidation: number;
  targetZones: [number, number];
  riskReward: number;
  confidence: number;
  positionSizeUsd: number;
  portfolioRiskUsd: number;
  reasons: string[];
}
```

- [ ] **Step 4: Run focused tests and confirm PASS**

- [ ] **Step 5: Commit with `feat: add risk sized swing setup engine`**

### Task 3: Settings Migration and Tactical Journal

**Files:**
- Modify: `src/lib/storage/db.ts`
- Modify: `src/lib/storage/settings-repository.ts`
- Create: `src/lib/storage/tactical-trade-repository.ts`
- Create: `src/lib/storage/tactical-trade-repository.test.ts`
- Modify: `src/features/settings/settings-panel.tsx`

**Interfaces:**
- Produces: settings fields matching `StrategyProfile`; `tacticalTradeRepository.list/add/update/remove`.
- Consumes: `TacticalTrade` from Task 2.

- [ ] **Step 1: Extend normalization tests before production code**

```ts
expect(normalizeUserSettings({ monthlyBudgetUsd: 1_200 })).toMatchObject({
  monthlyBudgetUsd: 1_200,
  annualContributionUsd: 3_750,
  annualContributionMonth: 1,
  tacticalShare: 0.2,
  perTradeRisk: 0.005,
});
```

- [ ] **Step 2: Run settings tests and confirm failure**

- [ ] **Step 3: Add Dexie version 2 without removing version 1 stores**

```ts
this.version(2).stores({
  transactions: "id, date, symbol, assetClass, type",
  settings: "key",
  tacticalTrades: "id, status, symbol, openedAt, closedAt",
});
```

Normalize invalid stored values to defaults. Add settings inputs for annual amount/month, tactical share, per-trade risk, minimum risk/reward, and minimum confidence. Keep values bounded to the spec limits before saving.

- [ ] **Step 4: Run storage/settings tests and confirm PASS**

- [ ] **Step 5: Commit with `feat: persist strategy profile and swing journal`**

### Task 4: Action-First Route Dashboard

**Files:**
- Create: `src/features/strategy/use-strategy-route.ts`
- Create: `src/features/strategy/route-dashboard.tsx`
- Create: `src/features/strategy/layer-card.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/lib/data/eodhd.ts`
- Modify: `src/features/market/market-grid.tsx`

**Interfaces:**
- Consumes: `buildContributionPlan`, `deriveTacticalSetup`, settings repository, `/api/market/history`, `/api/market/quotes`.
- Produces: the home-page route model with contribution plan, tactical candidates, USD/TRY, source state, and errors.

- [ ] **Step 1: Add an E2E expectation for the new action hierarchy**

```ts
await expect(page.getByRole("heading", { name: "Bu ayın yatırım rotası" })).toBeVisible();
await expect(page.getByText("Çekirdek", { exact: true })).toBeVisible();
await expect(page.getByText("Taktik / swing", { exact: true })).toBeVisible();
await expect(page.getByText("Fırsat rezervi", { exact: true })).toBeVisible();
await expect(page.getByText("Reel USD hedefi", { exact: true })).toBeVisible();
```

- [ ] **Step 2: Run the focused Playwright home test and confirm failure**

- [ ] **Step 3: Add missing EODHD symbols**

Add `SGOV`, `QUAL`, `VT`, `QQQM`, `SP500`, `BIST100`, `GOLD`, and `BTC` mappings while preserving current mappings.

- [ ] **Step 4: Implement the hook and dashboard**

The hook fetches 10-year history for `SP500`, `BTC`, `GOLD`, `BIST100`, and `QQQM`, derives setups, chooses `hasEligibleSetup`, and builds the current-month contribution plan. Failures stay attached to their symbol. The dashboard shows exact USD and TRY amounts, separates core/tactical/reserve, displays target as a target rather than achieved return, and gives every market-dependent number a source or status label.

- [ ] **Step 5: Run unit tests and the focused E2E test**

- [ ] **Step 6: Commit with `feat: build action first investment route`**

### Task 5: Swing Desk and Journal Workflow

**Files:**
- Create: `src/app/swing/page.tsx`
- Create: `src/features/tactical/swing-desk.tsx`
- Create: `src/features/tactical/setup-card.tsx`
- Modify: `src/components/app-shell.tsx`
- Modify: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: tactical setups from Task 2, settings, market history API, tactical journal repository.
- Produces: `/swing` with current setups and persisted planned/open/closed trades.

- [ ] **Step 1: Write a failing E2E test for `/swing`**

```ts
await page.goto("/swing");
await expect(page.getByRole("heading", { name: "Swing masası" })).toBeVisible();
await expect(page.getByText("İşlem başına risk")).toContainText("%0,50");
await page.getByRole("button", { name: "Planı günlüğe ekle" }).first().click();
await expect(page.getByText("Planlandı", { exact: true })).toBeVisible();
```

- [ ] **Step 2: Run the test and confirm 404/failure**

- [ ] **Step 3: Implement setup cards and journal state transitions**

Cards show action, entry range, invalidation, two targets, risk/reward, confidence, size, expiry and reasons. Only `long` cards expose the plan button. Journal rows support `planned → open → closed` and store actual entry/exit prices without mutating the original generated setup.

- [ ] **Step 4: Run unit and E2E tests**

- [ ] **Step 5: Commit with `feat: add swing desk and local journal`**

### Task 6: Annual Contributions and Tactical Overlay Backtest

**Files:**
- Modify: `src/lib/domain/backtest.ts`
- Modify: `src/lib/domain/backtest.test.ts`
- Create: `src/lib/domain/tactical-backtest.ts`
- Create: `src/lib/domain/tactical-backtest.test.ts`
- Modify: `src/features/backtest/backtest-dashboard.tsx`

**Interfaces:**
- Produces: `buildAnnualContributionSchedule(monthly, annual, month)` returning a `contributionForDate` callback; `runCoreTacticalBacktest(input)` returning combined, core-only, and tactical-only metrics.
- Consumes: strategy settings from Task 3, `deriveTacticalSetup` from Task 2, and existing DCA/walk-forward functions.

- [ ] **Step 1: Write the failing cash-flow test**

```ts
it("adds the annual contribution only in the selected calendar month", () => {
  const schedule = buildAnnualContributionSchedule(1_000, 3_750, 4);
  expect(schedule("2026-03-01", 0)).toBe(1_000);
  expect(schedule("2026-04-01", 1)).toBe(4_750);
});
```

- [ ] **Step 2: Run the backtest test and confirm failure**

- [ ] **Step 3: Write a failing point-in-time tactical-overlay test**

```ts
it("never passes future weekly observations to the tactical setup function", () => {
  const seenDates: string[] = [];
  runCoreTacticalBacktest({
    weeklySeries,
    profile,
    setupForHistory: (history) => {
      seenDates.push(history.at(-1)!.date);
      expect(history.every((point) => point.date <= history.at(-1)!.date)).toBe(true);
      return waitSetup;
    },
  });
  expect(seenDates).toEqual(weeklySeries.map((point) => point.date));
});
```

- [ ] **Step 4: Implement schedule and apply it consistently to every comparison row**

All strategies in the same backtest must receive identical dated cash flows. Update copy and invested totals to state monthly plus annual contribution. Do not count deposits as return.

- [ ] **Step 5: Implement the weekly tactical overlay without look-ahead**

At each weekly timestamp, call the setup function with history ending at that timestamp. Core contributions occur on the first observation of each calendar month. A long tactical position opens only for an eligible setup, is capped by the strategy sleeve, closes at invalidation or either target using that week's high/low, deducts configurable spread and commission, and returns unused cash to reserve. If both stop and target are touched in the same weekly candle, use the conservative stop-first result. Return combined equity, core-only equity, tactical realized P/L, maximum drawdown, turnover, win rate, payoff ratio, profit factor, and passive benchmark delta.

- [ ] **Step 6: Add the new model as a distinct Backtest comparison row**

Label it `Çekirdek + kurallı swing`; show achieved nominal and real USD results, maximum drawdown, and passive benchmark delta. Keep the target in explanatory copy, not as a simulated result.

- [ ] **Step 7: Run backtest and tactical-backtest tests and confirm PASS**

- [ ] **Step 8: Commit with `feat: backtest annual top ups and tactical overlay`**

### Task 7: Premium Fintech Visual System and Responsive Navigation

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/ui.tsx`
- Modify: `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: route and swing semantic markup.
- Produces: responsive dark-first visual hierarchy for 375, 768, 1024 and 1440 pixels.

- [ ] **Step 1: Extend smoke tests for no horizontal overflow on `/` and `/swing` at 375px**

- [ ] **Step 2: Run E2E and confirm the new mobile `/swing` assertion fails before the responsive styles are added**

- [ ] **Step 3: Implement design tokens and components**

Use deep navy surfaces, off-white text, teal for confirmed actions, amber for attention, and red only for invalidation/risk. Use `font-variant-numeric: tabular-nums`, visible focus rings, 44px touch targets, reduced-motion overrides, non-color status labels, sticky desktop sidebar, and a five-item mobile nav that includes Rota and Swing. Avoid gradients behind dense numbers and avoid decorative animation.

- [ ] **Step 4: Run Playwright at 375/768/1440 and inspect screenshots**

- [ ] **Step 5: Commit with `feat: refine premium investment workspace`**

### Task 8: Documentation, Full Verification, and GitHub Delivery

**Files:**
- Modify: `README.md`
- Modify: `METHODOLOGY.md`
- Modify: `DATA_SOURCES.md`
- Modify: `.env.example`

**Interfaces:**
- Documents the exact behavior delivered by Tasks 1–7.

- [ ] **Step 1: Document core/tactical/reserve, annual top-up, risk brakes, swing journal, and target-versus-achieved return**

- [ ] **Step 2: Add optional `COINMARKETCAP_API_KEY` only if a runtime adapter is implemented; otherwise state that CoinMarketCap is research-only and do not expose a dead setting**

- [ ] **Step 3: Run `npm test`**

Expected: all Vitest suites pass.

- [ ] **Step 4: Run `npm run lint`**

Expected: zero warnings and zero errors.

- [ ] **Step 5: Run `npm run build`**

Expected: Next.js production build succeeds for every route.

- [ ] **Step 6: Run `npx playwright test` and inspect generated screenshots**

Expected: all E2E tests pass, no console errors, and no horizontal overflow.

- [ ] **Step 7: Review `git diff`, confirm no API keys or `.env.local`, commit final documentation, push the feature branch, and open a GitHub pull request**

Use a PR title `feat: add risk-budgeted investment route and swing desk` and summarize strategy behavior, data fallbacks, tests, and the non-guaranteed return target.
