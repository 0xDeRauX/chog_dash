// Unified backfill pipeline. Catches up <days> of history for mentions (PAID,
// X counts/all), prices (free, CoinGecko) and TVL (free, DefiLlama), then
// ingests and rebuilds public/data.json — the delivery.
//
// SAFETY: dry-run by default. It prints the plan and the mention cost and makes
// ZERO paid calls until you pass --confirm.
//
// Usage:
//   node scripts/backfill.js <days>            # dry-run: plan + cost only
//   node scripts/backfill.js <days> --confirm  # execute (mentions are billed)
//   node scripts/backfill.js <days> --confirm --force   # refetch existing files
import { execFileSync } from "child_process";
import { ASSETS } from "../src/config.js";
import { pagesFor } from "../src/collectors/mentionsHistory.js";

const args = process.argv.slice(2);
const days = Number(args.find((a) => /^\d+$/.test(a)) ?? 90);
const confirm = args.includes("--confirm");
const force = args.includes("--force");

const mentionRequests = pagesFor(days) * ASSETS.length;
const mentionCost = (mentionRequests * 0.01).toFixed(2);

console.log("=== Backfill pipeline ===");
console.log(`Days:            ${days}`);
console.log(`Assets:          ${ASSETS.length}`);
console.log(`Mentions (PAID): counts/all · ~${mentionRequests} requests · ~$${mentionCost}`);
console.log(`Prices (free):   CoinGecko market_chart, ${days}d`);
console.log(`TVL (free):      DefiLlama full history`);
console.log(`Then:            ingest → build:dashboard (delivery)`);

if (!confirm) {
  console.log("\nDRY-RUN — no calls made. Re-run with --confirm to execute (mentions will be billed).");
  process.exit(0);
}

function run(cmd, cmdArgs) {
  console.log(`\n$ node ${cmd} ${cmdArgs.join(" ")}`);
  execFileSync("node", [cmd, ...cmdArgs], { stdio: "inherit" });
}

const forceFlag = force ? ["--force"] : [];

// 1) PAID mentions
run("scripts/backfill-mentions.js", [String(days), ...forceFlag]);
// 2) free prices
run("scripts/backfill-prices.js", [String(days), ...forceFlag]);
// 3) free TVL (full history; idempotent)
run("scripts/collect-tvl.js", []);
// 4) ingest + build (delivery)
run("scripts/ingest.js", []);
run("scripts/build-dashboard-data.js", []);

console.log("\n=== Backfill complete. public/data.json rebuilt. Review, then commit to deploy. ===");
