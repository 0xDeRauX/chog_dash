// Collects current Telegram member counts (public t.me page) for every asset
// with a `telegram` handle, into data/raw/telegram/<date>.json.
// Usage: npm run collect:telegram
import { ASSETS } from "../src/config.js";
import { collectAllTelegram } from "../src/collectors/telegram.js";
import { writeRaw, todayUTC } from "../src/lib/rawStore.js";

const date = todayUTC();
const results = await collectAllTelegram(ASSETS);
if (!results.length) {
  console.error("Telegram: aucun compte collecté — t.me injoignable ?");
  process.exit(1);
}
const file = writeRaw("telegram", date, { date, source: "tme", results });

console.log(`Wrote ${file}`);
for (const r of results) {
  console.log(`${r.symbol}: ${r.members} members`);
}
