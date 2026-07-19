// Daily holder-PnL replay for assets with a full transfer ledger (CHOG).
// Incremental: only new blocks are folded; the first run indexes everything.
// Usage: npm run collect:pnl
import { ASSETS } from "../src/config.js";
import { collectPnl } from "../src/collectors/pnl.js";

for (const asset of ASSETS.filter((a) => a.holders?.source === "thirdweb")) {
  try {
    const r = await collectPnl(asset);
    console.log(`${asset.symbol}: ${r.events} nouveaux transferts (${r.calls} appels) → ${r.days} jours agrégés, ${r.pools} pools exclus`);
    if (r.last) console.log(`  dernier jour ${r.last.date}: ${r.last.holders} holders, ${r.last.pctInProfit}% en gain, réalisé $${r.last.realizedUsd}`);
  } catch (err) {
    console.error(`${asset.symbol}: ${err.message}`);
  }
}
