import fs from "node:fs";
import { rankStockOpportunities } from "../src/lib/domain/stock-opportunities.ts";
for (const market of ["us", "tr"]) {
  const snapshot = JSON.parse(fs.readFileSync(`.tmp/opportunities-${market}.json`, "utf8"));
  if (!snapshot.rows) { console.log(snapshot); continue; }
  const result = rankStockOpportunities(snapshot);
  const reasons = {};
  for (const e of result.excluded) for (const reason of e.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
  console.log(JSON.stringify({ market, fetched: snapshot.fetchedAt, sample: snapshot.rows[0], assessed: result.assessed, candidates: result.candidates.map(c => ({ symbol: c.stock.symbol, score: c.score })), reasons }, null, 2));
}
