// Solana holder-PnL via Dune — the % of holders in profit + profit-multiple
// tranches for the Solana memes, which have no bulk transfer feed over RPC.
// One aggregated Dune query per token reconstructs each wallet's average
// acquisition cost (every inflow valued at that day's price) and its net
// balance, then buckets by profit multiple against the current price. Dune
// scans the token's full history server-side; the RESULT is a handful of
// numbers, so it's ~free.
//
// Honest scope (documented in the UI): acquisitions include airdrops/P2P valued
// at receipt-day price (not only DEX buys, which time out on Dune's free tier),
// so the % in profit is CONSERVATIVE — airdrop recipients count as "buyers" at
// the receipt-day price. The direction (deeply underwater vs euphoric) is
// reliable; the absolute is a floor. Emits the same schema as the CHOG ledger
// so the existing PnL UI renders it unchanged (a snapshot per run, accumulating
// into a daily series over time).
import fs from "fs";
import path from "path";
import { runQuery, duneAvailable } from "../lib/dune.js";

const SQL = `
WITH cur AS (
  SELECT price FROM prices.usd
  WHERE blockchain='solana' AND contract_address=from_base58('{{mint}}')
  ORDER BY minute DESC LIMIT 1
),
px AS (
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
  SELECT b.w, b.net, c.avg_cost,
         CASE WHEN c.avg_cost>0 THEN (SELECT price FROM cur)/c.avg_cost END ratio
  FROM bal b LEFT JOIN cost c ON b.w=c.w
  WHERE b.net > 0 AND b.net*(SELECT price FROM cur) >= 0.01
)
SELECT
  count(*) holders,
  count(*) FILTER (WHERE ratio>1) in_profit,
  round(100.0*count(*) FILTER (WHERE ratio>1)/NULLIF(count(*),0),2) pct_in_profit,
  count(*) FILTER (WHERE ratio>=10) x10,
  count(*) FILTER (WHERE ratio>=2 AND ratio<10) x2_10,
  count(*) FILTER (WHERE ratio>1 AND ratio<2) x1_2,
  count(*) FILTER (WHERE ratio>=0.5 AND ratio<=1) l0_50,
  count(*) FILTER (WHERE ratio<0.5) l50,
  round((SELECT price FROM cur),8) price
FROM h`;

export async function collectSolanaPnl(asset) {
  if (!duneAvailable()) throw new Error("Missing DUNE_API_KEY");
  const mint = asset.holders?.mint;
  if (!mint) throw new Error(`${asset.symbol}: no Solana mint`);
  const { rows, datapoints, ms } = await runQuery("solana_pnl", SQL, { mint }, { maxWaitMs: 480000 });
  const r = rows[0];
  if (!r || r.holders == null) throw new Error(`${asset.symbol}: empty result`);
  const today = new Date().toISOString().slice(0, 10);

  const rawFile = path.resolve(`data/raw/pnl/${asset.symbol}.json`);
  let series = [];
  try { series = JSON.parse(fs.readFileSync(rawFile, "utf8")).series || []; } catch { /* first run */ }
  const row = {
    date: today,
    holders: Number(r.holders), airdrop: 0, buyers: Number(r.holders),
    inProfit: Number(r.in_profit),
    pctInProfit: r.pct_in_profit == null ? null : Number(r.pct_in_profit),
    x10: Number(r.x10), x2_10: Number(r.x2_10), x1_2: Number(r.x1_2),
    l0_50: Number(r.l0_50), l50: Number(r.l50),
    realizedUsd: 0, realizedBigUsd: 0, // realized needs the daily-sell replay (dex_solana.trades) — v2
  };
  series = series.filter((s) => s.date !== today);
  series.push(row);
  series.sort((a, b) => a.date.localeCompare(b.date));

  fs.mkdirSync(path.dirname(rawFile), { recursive: true });
  fs.writeFileSync(rawFile, JSON.stringify({ symbol: asset.symbol, indexedToDate: today, source: "dune", series }, null, 1));
  return { holders: row.holders, pct: row.pctInProfit, datapoints, ms };
}
