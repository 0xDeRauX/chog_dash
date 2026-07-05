// One-off (re-runnable) backfill of daily price history for every asset into
// data/raw/prices-history/<symbol>.json. Safe to re-run — it overwrites each
// file with a fresh 90-day window. Free CoinGecko tier is rate-limited, so we
// space the calls out.
// Usage: npm run backfill:prices
import fs from "fs";
import path from "path";
import { ASSETS } from "../src/config.js";
import { fetchPriceHistory } from "../src/collectors/priceHistory.js";

const DAYS = Number(process.argv[2] ?? 90);
const dir = path.resolve("data/raw/prices-history");
fs.mkdirSync(dir, { recursive: true });

for (const asset of ASSETS) {
  try {
    const hist = await fetchPriceHistory(asset, DAYS);
    fs.writeFileSync(
      path.join(dir, `${asset.symbol}.json`),
      JSON.stringify(hist, null, 2)
    );
    console.log(`${asset.symbol}: ${hist.series.length} days`);
  } catch (err) {
    console.error(`${asset.symbol}: ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, 2500)); // stay under free rate limits
}
