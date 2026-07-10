// Collects current Discord member/online counts for every asset that has a
// discordInvite, into data/raw/discord/<date>.json.
// Usage: npm run collect:discord
import { ASSETS } from "../src/config.js";
import { collectAllDiscord } from "../src/collectors/discord.js";
import { writeRaw, todayUTC } from "../src/lib/rawStore.js";

const date = todayUTC();
const results = await collectAllDiscord(ASSETS);
const file = writeRaw("discord", date, { date, results });

console.log(`Wrote ${file}`);
for (const r of results) {
  console.log(`${r.symbol}: ${r.memberCount} members (${r.onlineCount} online)`);
}
