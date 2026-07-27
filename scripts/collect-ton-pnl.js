// % en gain for TON jettons via toncenter transfers + tonapi balances (see
// src/collectors/ton-pnl.js). Backfill + forward in one pass (re-reads all
// transfers). Usage: npm run collect:ton-pnl [SYM1,SYM2]
import { ASSETS } from "../src/config.js";
import { collectTonPnl } from "../src/collectors/ton-pnl.js";

const only = process.argv[2] ? new Set(process.argv[2].split(",")) : null;
const targets = ASSETS.filter((a) => a.chain === "ton" && a.holders?.source === "tonapi" && (!only || only.has(a.symbol)));

for (const asset of targets) {
  try {
    const r = await collectTonPnl(asset);
    console.log(`${asset.symbol}: ${r.nowPct}% en gain · ${r.holders} holders (cohorte) · ${r.days}j · ${r.transfers} transferts (${r.pages}p) · ${(r.ms / 1000).toFixed(0)}s`);
  } catch (err) {
    console.error(`${asset.symbol}: ${err.message}`);
  }
}
