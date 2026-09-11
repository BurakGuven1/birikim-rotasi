# MPA strategy completion

User authorized interpreting/correcting CryptoBot.txt and finishing the bot, with paper backtests first. No further design confirmation needed. Keep verification focused.

1. Implement causal confirmed swings, displacement, MSB versus sweep+MSB classification, trend/OTE/retest and structural target rules. Weekly/daily directional veto, mandatory 4H/1H/15m evidence. No claim of reproducing Efloud's discretionary decisions exactly.
2. Correct runner allocation, target-only breakeven, confirmed swing trailing, maximum holding time, setup deduplication; entry based on executable next candle open.
3. Add UTC daily/weekly context and historical funding+mark data, reusable bounded cached public dataset loader.
4. Connect active strategy to worker, real backtest and holdout report; keep live locked if acceptance fails. Fixed 60-day development / 30-day untouched holdout; no parameter search on holdout.
5. Run a real 90-day benchmark on BTC/ETH/SOL/XRP/ADA without changing parameters to force 60%. Report all symbols including empty/losing outcomes. Reference current universe bias and OHLC execution limitations.
6. Expose strategy rules and validation summary in panel. Focused changed-domain checks, one build and real local page verification; do not rerun unrelated whole-project suites.

Corrections: CCXT amount uses contracts, positions have side separate from contract count; supplied prototype overlooks both. Swing confirmation requires observed right candles, with confirmation timestamps. Strong candle thresholds use prior ATR and volume. Stop isn't widened; 'risk-free' is not asserted (fees/slippage/gaps remain). Runner eventually closes on confirmed structure, stop or maximum 7-day holding period. TP1 is a known 15m/1H opposing structural level; no artificial target just to pass RR.
