// Collects current Telegram member counts (via CoinGecko community_data) for
// every asset with a coingeckoId, into data/raw/telegram/<date>.json.
// Usage: npm run collect:telegram
import { ASSETS } from "../src/config.js";
import { collectAllTelegram } from "../src/collectors/telegram.js";
import { writeRaw, todayUTC } from "../src/lib/rawStore.js";

const date = todayUTC();
const results = await collectAllTelegram(ASSETS);
const file = writeRaw("telegram", date, { date, results });

console.log(`Wrote ${file}`);
for (const r of results) {
  console.log(`${r.symbol}: ${r.members} members`);
}
