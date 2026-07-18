// Discovers the top memes on the radar chains (Monad, Robinhood, Base).
// Keyless and free. Writes data/raw/chainradar/<date>.json.
// X mention tracking is NOT automatic — see scripts/radar-track.js (Admin).
// Usage: npm run collect:radar
import { collectChainRadar, loadTracked } from "../src/collectors/chainradar.js";
import { writeRaw, todayUTC } from "../src/lib/rawStore.js";

const date = todayUTC();
const chains = await collectChainRadar();
const file = writeRaw("chainradar", date, { date, chains });
console.log(`Wrote ${file}`);
for (const [chain, toks] of Object.entries(chains)) {
  const off = toks.filter((t) => t.crit).length;
  console.log(`\n${chain.toUpperCase()} — ${toks.length} tokens (${off} hors-critères):`);
  for (const t of toks.slice(0, 10)) {
    console.log(`  ${(t.pinned ? "📌" : "  ")}${t.symbol.padEnd(12)} liq $${(t.liq / 1e3).toFixed(0)}K | vol $${(t.vol / 1e3).toFixed(0)}K | Δ24h ${t.d24 ?? "—"}% | tx ${t.buys ?? "—"}/${t.sells ?? "—"}${t.holders != null ? " | holders " + t.holders : ""}${t.crit ? " | 🚷" + t.crit : ""}`);
  }
}
const tracked = loadTracked();
console.log(`\nMentions X suivies (manuel, via Admin) : ${tracked.length ? tracked.map((p) => "$" + p.symbol).join(", ") : "aucune"}`);
