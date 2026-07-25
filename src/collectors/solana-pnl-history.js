// Historical "% en gain" (percent of holders in profit) for the Solana memes —
// the full daily series that powers the CHOG-style tops study / "distribue ou
// attend" signal, which the per-run snapshot (solana-pnl.js) can't give.
//
// The true per-day series (each wallet's cost basis reconstructed on every past
// day) is O(days × wallets) — infeasible on Dune's free tier for tokens with
// ~1M wallets. So we use the Glassnode "supply/percent in profit" method: ONE
// aggregated query (same heavy reconstruction already proven ~5 min) returns a
// COST-BASIS HISTOGRAM of the CURRENT holders — how many holders (and how much
// supply) sit in each log-spaced average-acquisition-cost bucket. The result is
// ~150 rows, so it stays ~free. We then convolve that histogram LOCALLY with the
// token's full price history (data/raw/prices-history/<SYM>.json) to derive, for
// every historical day D: pct_in_profit(D) = share of holders whose cost < price(D),
// plus the profit-multiple tranches (ratio = price(D) / cost).
//
// Honest scope (documented in the UI): the histogram is TODAY's holder cohort.
// Projected back over price history it answers "what share of today's holders
// were underwater at each past price" — a cost-basis map that converges to the
// exact value at the present day (where it equals the live snapshot). It is not
// the true historical population (wallets that sold and left aren't there). The
// DIRECTION and the distribution shape are reliable; absolute holder counts
// before the live-snapshot window reflect the current cohort.
import fs from "fs";
import path from "path";
import { runQuery, duneAvailable } from "../lib/dune.js";

// 20 buckets per e-fold ⇒ ~5% cost resolution. bucket = floor(ln(cost)*20),
// representative cost = geometric mean of the bucket (exp(avg(ln(cost)))).
const HIST_SQL = `
WITH px AS (
  SELECT date_trunc('day', minute) d, avg(price) price FROM prices.usd
  WHERE blockchain='solana' AND contract_address=from_base58('{{mint}}') GROUP BY 1
),
tf AS (
  SELECT from_owner, to_owner, amount, block_time
  FROM tokens_solana.transfers WHERE token_mint_address='{{mint}}'
),
bal AS (
  SELECT w, SUM(amt) net FROM (
    SELECT to_owner w, amount amt FROM tf
    UNION ALL SELECT from_owner w, -amount amt FROM tf
  ) g GROUP BY w
),
cost AS (
  SELECT t.to_owner w, SUM(t.amount*p.price)/NULLIF(SUM(t.amount),0) avg_cost
  FROM tf t JOIN px p ON date_trunc('day',t.block_time)=p.d GROUP BY t.to_owner
),
h AS (
  SELECT b.net, c.avg_cost
  FROM bal b JOIN cost c ON b.w=c.w
  WHERE b.net > 0 AND c.avg_cost > 0
)
SELECT
  cast(floor(ln(avg_cost)*20) AS integer) bucket,
  exp(avg(ln(avg_cost))) cost_rep,
  count(*) holders,
  sum(net) supply
FROM h
GROUP BY 1
ORDER BY 1`;

// Convolve a cost-basis histogram with the price history → one PnL row per day.
function seriesFromHistogram(buckets, priceSeries) {
  const totalHolders = buckets.reduce((s, b) => s + b.holders, 0);
  const totalSupply = buckets.reduce((s, b) => s + b.supply, 0);
  if (!totalHolders) return [];
  return priceSeries
    .filter((p) => p.price > 0)
    .map(({ date, price }) => {
      let inProfitH = 0, x10 = 0, x2_10 = 0, x1_2 = 0, l0_50 = 0, l50 = 0, supProfit = 0;
      for (const b of buckets) {
        const ratio = price / b.cost_rep;
        if (ratio > 1) { inProfitH += b.holders; supProfit += b.supply; }
        if (ratio >= 10) x10 += b.holders;
        else if (ratio >= 2) x2_10 += b.holders;
        else if (ratio > 1) x1_2 += b.holders;
        else if (ratio >= 0.5) l0_50 += b.holders;
        else l50 += b.holders;
      }
      return {
        date,
        holders: totalHolders, airdrop: 0, buyers: totalHolders,
        inProfit: inProfitH,
        pctInProfit: Math.round((1000 * inProfitH) / totalHolders) / 10,
        supplyInProfitPct: Math.round((1000 * supProfit) / totalSupply) / 10,
        x10, x2_10, x1_2, l0_50, l50,
        realizedUsd: 0, realizedBigUsd: 0,
        source: "dune-hist",
      };
    });
}

export async function collectSolanaPnlHistory(asset) {
  if (!duneAvailable()) throw new Error("Missing DUNE_API_KEY");
  const mint = asset.holders?.mint;
  if (!mint) throw new Error(`${asset.symbol}: no Solana mint`);

  const priceFile = path.resolve(`data/raw/prices-history/${asset.symbol}.json`);
  let priceSeries;
  try { priceSeries = JSON.parse(fs.readFileSync(priceFile, "utf8")).series || []; }
  catch { throw new Error(`${asset.symbol}: no price history (run backfill:prices-dune first)`); }
  if (!priceSeries.length) throw new Error(`${asset.symbol}: empty price history`);

  const { rows, datapoints, ms } = await runQuery("solana_pnl_hist", HIST_SQL, { mint }, { maxWaitMs: 540000 });
  const buckets = rows
    .filter((r) => r.cost_rep != null && r.holders != null)
    .map((r) => ({ cost_rep: Number(r.cost_rep), holders: Number(r.holders), supply: Number(r.supply) }));
  if (!buckets.length) throw new Error(`${asset.symbol}: empty histogram`);

  const hist = seriesFromHistogram(buckets, priceSeries);

  // Merge: full-history approximation as the base, live snapshots (source
  // "dune", accumulated by the daily collector) overlaid on top so the most
  // recent, exact points always win. Keyed by date → real rows override.
  const rawFile = path.resolve(`data/raw/pnl/${asset.symbol}.json`);
  let existing = [];
  try { existing = JSON.parse(fs.readFileSync(rawFile, "utf8")).series || []; } catch { /* first run */ }
  const byDate = new Map();
  for (const r of hist) byDate.set(r.date, r);
  for (const r of existing) if (r.source !== "dune-hist") byDate.set(r.date, r); // live snapshots win
  const series = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  const today = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(path.dirname(rawFile), { recursive: true });
  fs.writeFileSync(rawFile, JSON.stringify({ symbol: asset.symbol, indexedToDate: today, source: "dune", series }, null, 1));
  return { days: hist.length, buckets: buckets.length, holders: buckets.reduce((s, b) => s + b.holders, 0), datapoints, ms };
}
