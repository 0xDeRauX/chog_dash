// Collects daily TVL history for every unique chain our assets live on, into
// data/raw/tvl/<chain-key>.json. The DefiLlama history includes today, so this
// is both the backfill and the daily refresh (safe to re-run).
// Usage: npm run collect:tvl
import fs from "fs";
import path from "path";
import { CHAINS } from "../src/config.js";
import { fetchChainTvl } from "../src/collectors/tvl.js";

const dir = path.resolve("data/raw/tvl");
fs.mkdirSync(dir, { recursive: true });

for (const [chainKey, defillamaName] of Object.entries(CHAINS)) {
  if (!defillamaName) {
    console.log(`${chainKey}: no DeFi TVL, skip`);
    continue;
  }
  try {
    const series = await fetchChainTvl(defillamaName);
    fs.writeFileSync(
      path.join(dir, `${chainKey}.json`),
      JSON.stringify({ chain: chainKey, defillamaName, series }, null, 2)
    );
    console.log(`${chainKey} (${defillamaName}): ${series.length} days`);
  } catch (err) {
    console.error(`${chainKey}: ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, 400)); // be gentle with the free API
}
