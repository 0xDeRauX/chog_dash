// One-off (re-runnable) backfill of daily price history for every asset into
// data/raw/prices-history/<symbol>.json. Safe to re-run — it overwrites each
// file with a fresh 90-day window. Free CoinGecko tier is rate-limited, so we
// space the calls out.
// Usage: npm run backfill:prices
import fs from "fs";
import path from "path";
import { ASSETS } from "../src/config.js";
import { fetchPriceHistory } from "../src/collectors/priceHistory.js";

const args = process.argv.slice(2);
const force = args.includes("--force");
const DAYS = Number(args.find((a) => /^\d+$/.test(a)) ?? 90);
const dir = path.resolve("data/raw/prices-history");
fs.mkdirSync(dir, { recursive: true });

for (const asset of ASSETS) {
  const file = path.join(dir, `${asset.symbol}.json`);
  if (!force && fs.existsSync(file)) {
    console.log(`${asset.symbol}: already present, skip (use --force to refetch)`);
    continue;
  }
  try {
    const hist = await fetchPriceHistory(asset, DAYS);
    fs.writeFileSync(file, JSON.stringify(hist, null, 2));
    console.log(`${asset.symbol}: ${hist.series.length} days`);
  } catch (err) {
    console.error(`${asset.symbol}: ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, 2500)); // stay under free rate limits
}
