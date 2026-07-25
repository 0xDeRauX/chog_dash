// Full historical backfill of EVM holder analytics via Dune: exact daily holder
// count, % en gain series and $-tiers series for PEPE/BRETT/ONDO. One-off /
// occasional; the daily collector keeps appending live snapshots on top.
// Usage: npm run backfill:evm-pnl-hist [SYM1,SYM2]
import { ASSETS } from "../src/config.js";
import { collectEvmPnlHistory } from "../src/collectors/evm-pnl.js";
import { duneAvailable } from "../src/lib/dune.js";

if (!duneAvailable()) { console.error("Missing DUNE_API_KEY — skipping"); process.exit(0); }

const only = process.argv[2] ? new Set(process.argv[2].split(",")) : null;
const targets = ASSETS.filter((a) =>
  ["ethereum", "base"].includes(a.chain) && a.holders?.source === "blockscout" && (!only || only.has(a.symbol)));

for (const asset of targets) {
  try {
    const r = await collectEvmPnlHistory(asset);
    console.log(`${asset.symbol}: ${r.days}j série · ${r.costBuckets}+${r.balBuckets} tranches · pic ${r.holdersPeak.toLocaleString()} holders · ${r.datapoints} dp · ${(r.ms / 1000).toFixed(0)}s`);
  } catch (err) {
    console.error(`${asset.symbol}: ${err.message}`);
  }
}
