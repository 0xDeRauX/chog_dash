// PAID backfill of mention history for RADAR tokens (chain:address keys) —
// the radar-side twin of backfill-mentions.js. Targets promoted tokens by
// default, or any radar token via --only=chain:address,... with the cashtag
// resolved from the latest chainradar snapshot.
// Writes per-date files under data/raw/radar-mentions/ (the ingest's format),
// merging with any existing file for that date.
//
// Usage: node scripts/backfill-radar-mentions.js <days> [--only=chain:addr,...]
// Cost: ceil(days/31) requests/token × $0.010. This script MAKES PAID CALLS.
import fs from "fs";
import path from "path";
import { loadPromoted } from "../src/collectors/chainradar.js";
import { fetchMentionHistory, pagesFor } from "../src/collectors/mentionsHistory.js";

const args = process.argv.slice(2);
const days = Number(args.find((a) => /^\d+$/.test(a)) ?? 30);
const onlyArg = args.find((a) => a.startsWith("--only="))?.split("=")[1];
const only = onlyArg ? new Set(onlyArg.toLowerCase().split(",")) : null;

// symbol lookup: promoted state first, then the latest radar snapshot
const bySymKey = new Map(loadPromoted().map((p) => [`${p.chain}:${p.address}`, p.symbol]));
const dir = path.resolve("data/raw/chainradar");
const snaps = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => /^\d{4}-/.test(f)).sort()
  : [];
if (snaps.length) {
  const snap = JSON.parse(fs.readFileSync(path.join(dir, snaps.at(-1)), "utf8"));
  for (const [chain, toks] of Object.entries(snap.chains || {})) {
    for (const t of toks) {
      const key = `${chain}:${t.address}`;
      if (!bySymKey.has(key)) bySymKey.set(key, t.symbol);
    }
  }
}

const targets = [...bySymKey].filter(([key]) => (only ? only.has(key) : loadPromoted().some((p) => `${p.chain}:${p.address}` === key)));
if (!targets.length) {
  console.error("Aucune cible. Sans --only, seuls les tokens promus sont backfillés.");
  process.exit(1);
}
console.log(`Backfill radar mentions: ${days}j · ${targets.length} token(s) · ~$${(pagesFor(days) * targets.length * 0.01).toFixed(2)}`);

const outDir = path.resolve("data/raw/radar-mentions");
fs.mkdirSync(outDir, { recursive: true });
let spent = 0;
for (const [key, symbol] of targets) {
  const [chain, address] = key.split(":");
  try {
    const hist = await fetchMentionHistory({ symbol: key, xQuery: `"$${symbol}" -is:retweet` }, days);
    spent += hist.requests * 0.01;
    for (const p of hist.series) {
      const file = path.join(outDir, `${p.date}.json`);
      let cur = { date: p.date, results: [] };
      try { cur = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* new date */ }
      cur.results = (cur.results || []).filter((r) => !(r.chain === chain && r.address === address));
      cur.results.push({ chain, address, count: p.count });
      fs.writeFileSync(file, JSON.stringify(cur, null, 2));
    }
    console.log(`$${symbol} (${key}): ${hist.series.length} jours (${hist.requests} req)`);
  } catch (err) {
    console.error(`$${symbol} (${key}): ${err.message}`);
  }
}
console.log(`Terminé. Dépense approx.: $${spent.toFixed(2)}`);
