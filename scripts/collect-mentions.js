// Collects the 24h X mention count for every tracked asset and writes it
// to data/raw/x-mentions/<date>.json.
// Usage: npm run collect:mentions
import { ASSETS } from "../src/config.js";
import { collectAllMentions } from "../src/collectors/xMentions.js";
import { writeRaw, todayUTC } from "../src/lib/rawStore.js";

const date = todayUTC();
const results = await collectAllMentions(ASSETS);
const file = writeRaw("x-mentions", date, { date, results });

console.log(`Wrote ${file}`);
for (const r of results) {
  console.log(`${r.symbol}: ${r.mentionCount} mentions`);
}
