# Bot simplification and comparison implementation plan

User explicitly authorized redesign, functional scan/backtest feedback, coin × 15m/1H/4H comparison, up to four concurrent positions and stronger position management. Continue without another design approval. Preserve unrelated dirty workspace. Use subagent-driven-development for independent UI and strategy tasks; root owns runtime and integration. No broad repeated review/test loops per user's token preference.

## Design and evidence

Screenshot has repeated warnings and zero-only cards. DB shows completed scan taking84s, worker silent by design, backtest jobs completing with0 trades. Strategy v1 only enters15m with mandatory daily+weekly EMA agreement; cannot compare three entry timeframes. Keep v1 report for history; create explicit v2 price-action interpretation with standalone entry variants. Do not promise peak prediction or60% profitability.

## Task 1: strategy/engine
- Add createMpaStrategy(interval), causal trend break/retest and range liquidity sweep/reclaim models, closed multi-timeframe context. Daily/weekly are context rather than mandatory universal veto. Structural stop and actual opposing structural targets; never fabricate entries/targets merely to hit RR.
- Test entry variants independently at15m/1H/4H close; execute all with15m bars, costs/funding and stop-first intrabar policy. Full structural TP plus break-even/trailing and confirmed reversal exits effective next bar. Dedup setup. Position records interval, model and exits.
- Maintain default net RR2, .5% per-trade risk; root raises maxPositions4 and totalRisk2 without enlarging each trade.
- Focused meaningful causal/management tests; no profitable claims without actual data.

## Task 2: UI
- Replace long dashboard with compact header (working/paused, last activity, start/pause, scan), Backtest and Trades tabs plus collapsed settings.
- Comparison action default5fixedcoins ×3entry intervals, days90. Table shows coin, interval, trades, win rate, netPnL, PF, drawdown, evidence. Selecting row opens actual trade history/details; zero sample shown as no trades, not performance.
- Single live progress strip, real job errors/retry, no repeated warning cards. Details disclose costs/methodology once. Paper and real-money status unmistakable.

## Task 3: runtime/integration (root)
- Add persisted progress and comparison batch, deduplicate pending commands, prioritize emergency, short worker logs.
- Local authenticated command automatically ensures one detached worker, process env PATH normalized, lock guards duplicate processes. Healthy old worker must be restarted after code replacement; don't kill unrelated processes.
- Comparison sequentially loads one dataset/coin, replays3variants from same period/settings, persists rows incrementally, reports errors. Prefer existing complete90d window within24h for reproducible cache; display actual date. Selection uses development metrics, never claim test-selected winner validated.
- Connect paper per-coin interval selection using development result, same common engine and total risk caps.
- Real benchmark cached fivecoins×threeintervals; inspect real trades and one end-to-end browser flow, focused changed-domain tests + one build. Live orders remain locked pending verified performance and exchange execution readiness.

## Shared contracts
Types.ts adds optional entryInterval to Strategy/Signal/Position/BacktestResult, maxHoldHours and exitOnReversal to Signal/Position, pendingExit='reversal' to Position, Exit reason reversal/timeout.
BotSettings adds entryInterval: Interval|'auto' (defaultauto via schema for older data).
BotComparison={id,createdAt,from,to,rows:BacktestResult[],errors:{instrument,message}[]}; snapshot.comparison optional/null.
BotProgress={kind:'scan'|'backtest'|'comparison',state:'running'|'done'|'failed',message,current,total,updatedAt}; snapshot.progress optional/null.
Command comparison input {action:'comparison',instruments:string[],days:7..90}. Existing commands preserved. New {action:'worker'} ensures process. UI polling1.5s while working,5s idle. Root creates shared types before delegation.

## Verification ledger
- Task1 done; Task2 done; Task3 done.
- Doğrulama 2026-09-09: 272 birim testi, eslint --max-warnings=0, next build ve /bot uçtan uca akışı (5 senaryo) geçti.
- Gerçek kıyaslama çalıştırıldı: 5 coin x 3 giriş dilimi, 90 gun OKX geçmiş verisi -> docs/mpa-v2-benchmark-2026-09-09.md.
  Sonuç dürüst şekilde negatif; on beş varyantın tamamı zararda, PF < 1. Kârlılık iddiası yok, gerçek emirler kilitli.
- Açık bulgu: geliştirme beklentisi hiçbir coinde pozitif olmadığı için entryInterval='auto' 15m varsayılanına düşüyor;
  15m bu pencerede en çok zarar eden varyant. Kanıt yokken otomatik seçimin işlem açmaması tercih edilmeli.
- Bot dışı: yahoo.test.ts günlük granülerliğe hizalandı, use-strategy-route.ts ref uyarısı giderildi, bot e2e spec'i yeni arayüze göre yazıldı.
- Bot dışı, açık: smoke/portfolio-history e2e'de 9 hata var; bunlar swing -> price-action-desk göçünden (başlık adları değişti) kaynaklanıyor, bu plana dahil değil.
- Ruling: existing user-authorized workspace integration overrides skill worktree/commit ceremony; no unrelated changes or broad testing.
