// Collects the previous complete UTC calendar day's mention count for every
// tracked asset and writes it to data/raw/x-mentions/<yesterday>.json.
// Usage: npm run collect:mentions
import { ASSETS } from "../src/config.js";
import { collectAllMentions } from "../src/collectors/xMentions.js";
import { writeRaw } from "../src/lib/rawStore.js";

const results = await collectAllMentions(ASSETS);
const date = results[0]?.date; // all assets share the same previous-day date
const file = writeRaw("x-mentions", date, { date, results });

console.log(`Wrote ${file} (calendar day ${date})`);
for (const r of results) {
  console.log(`${r.symbol}: ${r.mentionCount} mentions`);
}
