// Backfill the FULL historical "% en gain" series for the Solana memes via a
// Dune cost-basis histogram convolved with the price history (see
// src/collectors/solana-pnl-history.js). One-off / occasional: the daily
// collector keeps appending live snapshots on top. Usage:
//   npm run backfill:solana-pnl-hist [SYM1,SYM2]
import { ASSETS } from "../src/config.js";
import { collectSolanaPnlHistory } from "../src/collectors/solana-pnl-history.js";
import { duneAvailable } from "../src/lib/dune.js";

if (!duneAvailable()) { console.error("Missing DUNE_API_KEY — skipping"); process.exit(0); }

const only = process.argv[2] ? new Set(process.argv[2].split(",")) : null;
const targets = ASSETS.filter((a) => a.chain === "solana" && a.holders?.source === "solana" && (!only || only.has(a.symbol)));

for (const asset of targets) {
  try {
    const r = await collectSolanaPnlHistory(asset);
    console.log(`${asset.symbol}: ${r.days}j série · ${r.buckets} tranches de coût · ${r.holders.toLocaleString()} holders · ${r.datapoints} dp · ${(r.ms / 1000).toFixed(0)}s`);
  } catch (err) {
    console.error(`${asset.symbol}: ${err.message}`);
  }
}
