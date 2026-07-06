// PAID one-off backfill of daily mention history via X counts/all.
// Writes data/raw/x-mentions-history/<symbol>.json. Skips symbols already
// present (protects against re-charging) unless --force.
//
// Usage:
//   node scripts/backfill-mentions.js <days> [--force] [--only SYM1,SYM2]
// Cost: ceil(days/31) requests/asset × $0.010. This script MAKES PAID CALLS.
import fs from "fs";
import path from "path";
import { ASSETS } from "../src/config.js";
import { fetchMentionHistory, pagesFor } from "../src/collectors/mentionsHistory.js";

const args = process.argv.slice(2);
const days = Number(args.find((a) => /^\d+$/.test(a)) ?? 90);
const force = args.includes("--force");
const onlyArg = args.find((a) => a.startsWith("--only="))?.split("=")[1];
const only = onlyArg ? new Set(onlyArg.split(",")) : null;

const dir = path.resolve("data/raw/x-mentions-history");
fs.mkdirSync(dir, { recursive: true });

const targets = ASSETS.filter((a) => !only || only.has(a.symbol));
const estRequests = pagesFor(days) * targets.length;
console.log(
  `Backfill mentions: ${days} days · ${targets.length} assets · ~${estRequests} requests · ~$${(estRequests * 0.01).toFixed(2)}`
);

let spent = 0;
for (const asset of targets) {
  const file = path.join(dir, `${asset.symbol}.json`);
  if (!force && fs.existsSync(file)) {
    console.log(`${asset.symbol}: already present, skip (use --force to refetch)`);
    continue;
  }
  try {
    const hist = await fetchMentionHistory(asset, days);
    fs.writeFileSync(file, JSON.stringify(hist, null, 2));
    spent += hist.requests * 0.01;
    console.log(`${asset.symbol}: ${hist.series.length} days (${hist.requests} req)`);
  } catch (err) {
    console.error(`${asset.symbol}: ${err.message}`);
  }
}
console.log(`Done. Approx spend this run: $${spent.toFixed(2)}`);
