// % en gain + holders + $-tiers for TON jettons via toncenter transfers + tonapi
// balances (see src/collectors/ton-pnl.js). INCREMENTAL: state cached in
// data/pnl-state/ton, each run only reads NEW transfers (first run = full).
// Usage: npm run collect:ton-pnl [SYM1,SYM2]
import { ASSETS } from "../src/config.js";
import { collectTonPnl } from "../src/collectors/ton-pnl.js";

const only = process.argv[2] ? new Set(process.argv[2].split(",")) : null;
const targets = ASSETS.filter((a) => a.chain === "ton" && a.holders?.source === "tonapi" && (!only || only.has(a.symbol)));

for (const asset of targets) {
  try {
    const r = await collectTonPnl(asset);
    console.log(`${asset.symbol}: ${r.nowPct}% en gain · ${r.holders} holders (cohorte) · ${r.days}j · +${r.added} nouveaux (${r.transfers} total) · ${(r.ms / 1000).toFixed(0)}s`);
  } catch (err) {
    console.error(`${asset.symbol}: ${err.message}`);
  }
}
