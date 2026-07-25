// Daily holder-PnL for the Solana memes via Dune (they have no bulk transfer
// feed over RPC). One aggregated query per token → % of holders in profit +
// profit-multiple tranches, written in the CHOG PnL schema so the existing UI
// renders it. Heavy on Dune's compute (full-history scan) but the RESULT is a
// few numbers (~free). Usage: npm run collect:solana-pnl [SYM1,SYM2]
import { ASSETS } from "../src/config.js";
import { collectSolanaPnl } from "../src/collectors/solana-pnl.js";
import { duneAvailable } from "../src/lib/dune.js";

if (!duneAvailable()) { console.error("Missing DUNE_API_KEY — skipping Solana PnL"); process.exit(0); }

const only = process.argv[2] ? new Set(process.argv[2].split(",")) : null;
const targets = ASSETS.filter((a) => a.chain === "solana" && a.holders?.source === "solana" && (!only || only.has(a.symbol)));

for (const asset of targets) {
  try {
    const r = await collectSolanaPnl(asset);
    console.log(`${asset.symbol}: ${r.holders.toLocaleString()} holders · ${r.pct}% en gain · ${r.datapoints} dp · ${(r.ms / 1000).toFixed(0)}s`);
  } catch (err) {
    console.error(`${asset.symbol}: ${err.message}`);
  }
}
