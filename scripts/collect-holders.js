// Collects holder counts for every asset with a `holders` config, into
// data/raw/holders/<date>.json. thirdweb-indexed tokens (CHOG) update
// incrementally from their cached balance state.
// Usage: npm run collect:holders
import { ASSETS } from "../src/config.js";
import { collectAllHolders } from "../src/collectors/holders.js";
import { writeRaw, todayUTC } from "../src/lib/rawStore.js";

const date = todayUTC();
const results = await collectAllHolders(ASSETS);
const file = writeRaw("holders", date, {
  date,
  results: results.map((r) => ({
    symbol: r.symbol,
    holders: r.holders,
    ...(r.flows ? { flows: r.flows } : {}),
  })),
});

console.log(`Wrote ${file}`);
for (const r of results) {
  console.log(`${r.symbol}: ${r.holders} holders${r.calls ? ` (${r.calls} calls)` : ""}`);
}
