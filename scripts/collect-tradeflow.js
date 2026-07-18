// Collects buy/sell volume for every asset (Binance taker klines where listed,
// DexScreener tx counts otherwise) into data/raw/tradeflow/<date>.json.
// First run also backfills 365d of Binance history into
// data/raw/tradeflow-history/<sym>.json (skipped once present).
// Usage: npm run collect:tradeflow
import { ASSETS } from "../src/config.js";
import { backfillTradeflow, collectTradeflow } from "../src/collectors/tradeflow.js";
import { writeRaw, todayUTC } from "../src/lib/rawStore.js";

const backfilled = await backfillTradeflow(ASSETS);
if (backfilled.length) console.log("Backfill Binance:", backfilled.join(", "));

const date = todayUTC();
const results = await collectTradeflow(ASSETS);
const file = writeRaw("tradeflow", date, { date, results });

console.log(`Wrote ${file}`);
for (const r of results) {
  if (r.series) {
    const last = r.series.at(-1);
    console.log(`${r.symbol}: ${r.series.length}j (dernier ${last.date}: achat $${(last.buyUsd / 1e6).toFixed(1)}M / vente $${(last.sellUsd / 1e6).toFixed(1)}M)`);
  } else {
    console.log(`${r.symbol}: 24h ${r.buyTx} achats / ${r.sellTx} ventes (tx)`);
  }
}
