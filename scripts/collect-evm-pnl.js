// Daily EVM holder analytics via Dune (Ethereum/Base) — today's % en gain,
// holders and $-tiers for the EVM tokens we scan (PEPE, BRETT, ONDO). Fast.
// Usage: npm run collect:evm-pnl [SYM1,SYM2]
import { ASSETS } from "../src/config.js";
import { collectEvmPnl } from "../src/collectors/evm-pnl.js";
import { duneAvailable } from "../src/lib/dune.js";

if (!duneAvailable()) { console.error("Missing DUNE_API_KEY — skipping EVM PnL"); process.exit(0); }

const only = process.argv[2] ? new Set(process.argv[2].split(",")) : null;
const targets = ASSETS.filter((a) =>
  ["ethereum", "base"].includes(a.chain) && a.holders?.source === "blockscout" && (!only || only.has(a.symbol)));

for (const asset of targets) {
  try {
    const r = await collectEvmPnl(asset);
    console.log(`${asset.symbol}: ${r.holders.toLocaleString()} holders · ${r.pct}% en gain · ${r.h50.toLocaleString()} ≥$50 · ${r.datapoints} dp · ${(r.ms / 1000).toFixed(0)}s`);
  } catch (err) {
    console.error(`${asset.symbol}: ${err.message}`);
  }
}
