// Daily holder-PnL replay for every asset with a full transfer ledger: CHOG
// (Monad) + PEPE/ONDO (Ethereum) + BRETT (Base). Incremental: only new blocks
// are folded. A first index can take hours (5 req/min), so the run has a time
// budget (LEDGER_BUDGET_MIN, default 45) shared by all ledgers — whatever is
// left resumes on the next run from the cached state.
// Usage: npm run collect:pnl [SYM1,SYM2]
import { ASSETS } from "../src/config.js";
import { collectPnl, ledgerCfg } from "../src/collectors/pnl.js";

const only = process.argv[2] ? new Set(process.argv[2].split(",")) : null;
const budgetMin = Number(process.env.LEDGER_BUDGET_MIN) || 45;
const deadline = Date.now() + budgetMin * 60_000;
let failed = 0;

// Smallest ledgers first so a shared budget finishes them before the long
// first indexes (PEPE ~1h, BRETT ~2h) take the rest.
const ORDER = ["CHOG", "ONDO", "CASHCAT", "PEPE", "BRETT"];
const rank = (a) => (ORDER.includes(a.symbol) ? ORDER.indexOf(a.symbol) : ORDER.length);
const targets = ASSETS.filter((a) => ledgerCfg(a) && (!only || only.has(a.symbol))).sort((a, b) => rank(a) - rank(b));

for (const asset of targets) {
  if (Date.now() > deadline) { console.log(`${asset.symbol}: budget épuisé — reprise au prochain run`); continue; }
  try {
    const t0 = Date.now();
    const r = await collectPnl(asset, { deadline });
    const dt = ((Date.now() - t0) / 60000).toFixed(1);
    if (!r.caughtUp) {
      console.log(`${asset.symbol}: indexation en cours — bloc ${r.progressBlock}/${r.head} (${((r.progressBlock / r.head) * 100).toFixed(1)}%), ${r.events} transferts, ${r.calls} appels, ${dt} min · jour courant ${r.last?.date ?? "—"}`);
      continue;
    }
    console.log(`${asset.symbol}: ${r.events} nouveaux transferts (${r.calls} appels, ${dt} min) → ${r.days} jours agrégés, ${r.pools} pools exclus`);
    if (r.last) console.log(`  dernier jour ${r.last.date}: ${r.last.holdersOnchain ?? r.last.holders} holders, ${r.last.pctInProfit}% en gain, réalisé $${r.last.realizedUsd}`);
  } catch (err) {
    failed++;
    console.error(`${asset.symbol}: ${err.message}`);
  }
}
if (failed) process.exit(1);
