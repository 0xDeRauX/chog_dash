// Collects the last few complete UTC calendar days of mentions for every asset
// (one request each, same $0.005 cost as a single day) and writes one file per
// date under data/raw/x-mentions/<date>.json. Re-collecting the recent window
// self-heals any missed run — the ingest upserts, so gaps fill and late values
// settle. Optional arg overrides the lookback days.
// Usage: npm run collect:mentions [days]
import { ASSETS, CONFIG } from "../src/config.js";
import { collectAllRecent, DAILY_LOOKBACK_DAYS } from "../src/collectors/xMentions.js";
import { loadPromoted } from "../src/collectors/chainradar.js";
import { writeRaw } from "../src/lib/rawStore.js";

if (!CONFIG.X_BEARER_TOKEN) {
  console.error("Missing X_BEARER_TOKEN");
  process.exit(1);
}

const days = Number(process.argv[2]) || DAILY_LOOKBACK_DAYS;
const results = await collectAllRecent(ASSETS, days); // [{symbol, series:[{date,count}]}]

// Pivot to one file per date (all assets), which the ingest upserts idempotently.
const byDate = new Map();
for (const r of results) {
  for (const p of r.series) {
    if (!byDate.has(p.date)) byDate.set(p.date, []);
    byDate.get(p.date).push({ symbol: r.symbol, mentionCount: p.count });
  }
}

const collectedAt = new Date().toISOString();
for (const [date, arr] of [...byDate].sort()) {
  const resultsForDate = arr.map((a) => ({
    symbol: a.symbol,
    date,
    mentionCount: a.mentionCount,
    collectedAt,
  }));
  writeRaw("x-mentions", date, { date, results: resultsForDate });
}

console.log(`Collected ${days} day(s) × ${results.length} assets → ${byDate.size} date file(s):`);
for (const [date, arr] of [...byDate].sort()) {
  const chog = arr.find((a) => a.symbol === "CHOG");
  console.log(`  ${date}: ${arr.length} assets${chog ? ` (CHOG ${chog.mentionCount})` : ""}`);
}

// ---- radar tokens with MANUAL mention tracking ---------------------------
// Only tokens explicitly enabled from the Admin page (scripts/radar-track.js)
// get their cashtag counted — sanitized quoted "$SYM" query. Stored separately
// (keyed by chain+address, these aren't config assets).
const promoted = loadPromoted();
if (promoted.length) {
  const pseudo = promoted.map((p) => ({
    symbol: `${p.chain}:${p.address}`,
    xQuery: `"$${p.symbol}" -is:retweet`,
  }));
  const radarResults = await collectAllRecent(pseudo, days);
  const rByDate = new Map();
  for (let i = 0; i < radarResults.length; i++) {
    const meta = promoted.find((p) => `${p.chain}:${p.address}` === radarResults[i].symbol);
    if (!meta) continue;
    for (const pt of radarResults[i].series) {
      if (!rByDate.has(pt.date)) rByDate.set(pt.date, []);
      rByDate.get(pt.date).push({ chain: meta.chain, address: meta.address, symbol: meta.symbol, count: pt.count });
    }
  }
  for (const [date, arr] of [...rByDate].sort()) {
    writeRaw("radar-mentions", date, { date, results: arr });
  }
  console.log(`Radar: mentions collectées pour ${promoted.length} tokens promus (${[...rByDate.keys()].length} jours).`);
}
