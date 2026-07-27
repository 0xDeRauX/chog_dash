// Collects holder counts for every asset with a `holders` config, into
// data/raw/holders/<date>.json. thirdweb-indexed tokens (CHOG) update
// incrementally from their cached balance state. Where we see every balance
// ourselves (CHOG ledger, Solana scans) it also buckets holders by $-value
// tiers using the day's collected price (the prices step runs first in CI).
// Usage: npm run collect:holders
import fs from "fs";
import path from "path";
import { ASSETS } from "../src/config.js";
import { collectAllHolders } from "../src/collectors/holders.js";
import { writeRaw, todayUTC } from "../src/lib/rawStore.js";

// Latest collected prices (today's file in CI; most recent one locally).
function loadPrices() {
  const dir = path.resolve("data/raw/prices");
  if (!fs.existsSync(dir)) return {};
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) return {};
  const map = {};
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, files.at(-1)), "utf8"));
    for (const r of j.results || []) if (r.priceUsd != null) map[r.symbol] = r.priceUsd;
  } catch { /* fall through to history */ }
  // Fallback for tokens priced from GeckoTerminal (no CoinGecko daily snapshot,
  // e.g. TON jettons): use the latest price from prices-history so their $-tiers
  // can still be computed.
  const histDir = path.resolve("data/raw/prices-history");
  if (fs.existsSync(histDir)) {
    for (const f of fs.readdirSync(histDir).filter((x) => x.endsWith(".json"))) {
      const sym = f.replace(/\.json$/, "");
      if (map[sym] != null) continue;
      try {
        const s = JSON.parse(fs.readFileSync(path.join(histDir, f), "utf8")).series || [];
        const last = s.filter((p) => p.price != null).at(-1);
        if (last) map[sym] = last.price;
      } catch { /* skip */ }
    }
  }
  return map;
}

const date = todayUTC();
const results = await collectAllHolders(ASSETS, loadPrices());
const file = writeRaw("holders", date, {
  date,
  results: results.map((r) => ({
    symbol: r.symbol,
    holders: r.holders,
    ...(r.flows ? { flows: r.flows } : {}),
    ...(r.tiers ? { tiers: r.tiers } : {}),
  })),
});

console.log(`Wrote ${file}`);
for (const r of results) {
  const t = r.tiers ? ` | ≥$50: ${r.tiers.t50_500 + r.tiers.t500_5k + r.tiers.t5k_50k + r.tiers.gt50k}` : "";
  console.log(`${r.symbol}: ${r.holders} holders${r.calls ? ` (${r.calls} calls)` : ""}${t}`);
}
