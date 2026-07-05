// Collects USD price + 24h change for every tracked asset and writes it to
// data/raw/prices/<date>.json.
// Usage: npm run collect:prices
import { ASSETS } from "../src/config.js";
import { collectPrices } from "../src/collectors/prices.js";
import { writeRaw, todayUTC } from "../src/lib/rawStore.js";

const date = todayUTC();
const results = await collectPrices(ASSETS);
const file = writeRaw("prices", date, { date, results });

console.log(`Wrote ${file}`);
for (const r of results) {
  console.log(`${r.symbol}: $${r.priceUsd} (${r.change24h?.toFixed(2)}% 24h)`);
}
