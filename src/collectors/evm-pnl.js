// EVM holder analytics via Dune (Ethereum, Base…) — the % of holders in profit,
// profit-multiple tranches, holder count and $-tiers for the EVM memes/tokens
// (PEPE, BRETT, ONDO). Same idea as the Solana collector, but the EVM
// tokens_<chain>.transfers table already carries amount_usd (the USD value at
// the exact transfer moment), so the average acquisition cost is more precise
// than Solana's daily-average pricing — and the queries run far faster.
//
// Two entry points:
//  · collectEvmPnl(asset)        — today's snapshot (holders, % in profit,
//                                   profit tranches, $-tiers). Fast, run daily.
//  · collectEvmPnlHistory(asset) — full backfill: an EXACT daily holder count
//                                   (balance-crossing events), the % en gain
//                                   series (cost-basis histogram × price
//                                   history) and the $-tiers series (balance
//                                   histogram × price). Same "supply in profit"
//                                   caveat as Solana for the % and tiers: the
//                                   histogram is today's cohort projected back
//                                   over price history (converges to exact at
//                                   the present). The holder COUNT, by contrast,
//                                   is exact for every past day.
import fs from "fs";
import path from "path";
import { runQuery, duneAvailable } from "../lib/dune.js";

// chain is injected into the table name (trusted config value, not user input);
// the address is a bound {{addr}} parameter so one public query is reused per
// chain for every token on it.
const snapSql = (chain) => `
WITH cur AS (
  SELECT price FROM prices.usd
  WHERE blockchain='${chain}' AND contract_address=from_hex('{{addr}}')
  ORDER BY minute DESC LIMIT 1
),
tf AS (
  SELECT "from" f, "to" t, amount, amount_usd
  FROM tokens_${chain}.transfers
  WHERE contract_address=from_hex('{{addr}}') AND amount>0
),
bal AS (
  SELECT w, SUM(amt) net FROM (
    SELECT t w, amount amt FROM tf UNION ALL SELECT f w, -amount amt FROM tf
  ) g GROUP BY w
),
cost AS (
  SELECT t w, SUM(amount_usd)/NULLIF(SUM(amount),0) avg_cost FROM tf GROUP BY t
),
h AS (
  SELECT b.net, c.avg_cost,
    CASE WHEN c.avg_cost>0 THEN (SELECT price FROM cur)/c.avg_cost END ratio,
    b.net*(SELECT price FROM cur) usd
  FROM bal b LEFT JOIN cost c ON b.w=c.w
  WHERE b.net>0 AND b.net*(SELECT price FROM cur)>=0.01
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
  count(*) FILTER (WHERE usd<50) lt50,
  count(*) FILTER (WHERE usd>=50 AND usd<500) t50_500,
  count(*) FILTER (WHERE usd>=500 AND usd<5000) t500_5k,
  count(*) FILTER (WHERE usd>=5000 AND usd<50000) t5k_50k,
  count(*) FILTER (WHERE usd>=50000) gt50k,
  round((SELECT price FROM cur),12) price
FROM h`;

// Cost-basis + balance histograms of the current holders (one heavy pass).
// Both restricted to the SAME "meaningful holder" cohort as the live snapshot
// (net worth ≥ $0.01 today) so the projected historical % en gain and $-tiers
// line up exactly with the exact snapshot at the present day — no seam/spike
// where the backfill meets today's live point.
const histSql = (chain) => `
WITH cur AS (
  SELECT price FROM prices.usd
  WHERE blockchain='${chain}' AND contract_address=from_hex('{{addr}}')
  ORDER BY minute DESC LIMIT 1
),
tf AS (
  SELECT "from" f, "to" t, amount, amount_usd
  FROM tokens_${chain}.transfers
  WHERE contract_address=from_hex('{{addr}}') AND amount>0
),
bal AS (
  SELECT w, SUM(amt) net FROM (
    SELECT t w, amount amt FROM tf UNION ALL SELECT f w, -amount amt FROM tf
  ) g GROUP BY w
),
cost AS (
  SELECT t w, SUM(amount_usd)/NULLIF(SUM(amount),0) avg_cost FROM tf GROUP BY t
),
hc AS (
  SELECT b.net, c.avg_cost FROM bal b JOIN cost c ON b.w=c.w
  WHERE b.net>0 AND c.avg_cost>0 AND b.net*(SELECT price FROM cur)>=0.01
),
hb AS ( SELECT net FROM bal WHERE net>0 AND net*(SELECT price FROM cur)>=0.01 )
SELECT 'cost' kind, cast(floor(ln(avg_cost)*20) AS integer) bucket,
       exp(avg(ln(avg_cost))) rep, count(*) holders, sum(net) supply
FROM hc GROUP BY 2
UNION ALL
SELECT 'bal' kind, cast(floor(ln(net)*15) AS integer) bucket,
       exp(avg(ln(net))) rep, count(*) holders, sum(net) supply
FROM hb GROUP BY 2`;

// Exact daily holder count via balance-crossing events (price-independent).
const countSql = (chain) => `
WITH tf AS (
  SELECT "from" f, "to" t, amount, block_date d
  FROM tokens_${chain}.transfers
  WHERE contract_address=from_hex('{{addr}}') AND amount>0
),
ev AS (
  SELECT t w, d, amount chg FROM tf UNION ALL SELECT f w, d, -amount chg FROM tf
),
daily AS ( SELECT w, d, SUM(chg) dc FROM ev GROUP BY w, d ),
run AS ( SELECT w, d, SUM(dc) OVER (PARTITION BY w ORDER BY d) bal FROM daily ),
flags AS (
  SELECT d, CASE
    WHEN bal>1e-9 AND COALESCE(LAG(bal) OVER (PARTITION BY w ORDER BY d),0)<=1e-9 THEN 1
    WHEN bal<=1e-9 AND COALESCE(LAG(bal) OVER (PARTITION BY w ORDER BY d),0)>1e-9 THEN -1
    ELSE 0 END delta FROM run
),
byday AS ( SELECT d, SUM(delta) nd FROM flags GROUP BY d )
SELECT cast(d AS varchar) d, SUM(nd) OVER (ORDER BY d) holders FROM byday ORDER BY d`;

const CHAIN_OK = new Set(["ethereum", "base"]); // Dune tokens_<chain>.transfers coverage

function evmAddr(asset) {
  const raw = asset.holders?.contract || asset.address || asset.contract;
  if (!raw) return null;
  return raw.replace(/^0x/i, "").toLowerCase();
}

const TIER_KEYS = ["lt50", "t50_500", "t500_5k", "t5k_50k", "gt50k"];

function readPnlSeries(sym) {
  try { return JSON.parse(fs.readFileSync(path.resolve(`data/raw/pnl/${sym}.json`), "utf8")).series || []; }
  catch { return []; }
}
function writePnl(sym, series) {
  const file = path.resolve(`data/raw/pnl/${sym}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(file, JSON.stringify({ symbol: sym, indexedToDate: today, source: "dune", series }, null, 1));
}
function readHoldersHist(sym) {
  try { return JSON.parse(fs.readFileSync(path.resolve(`data/raw/holders-history/${sym}.json`), "utf8")).series || []; }
  catch { return []; }
}
function writeHoldersHist(sym, series) {
  const file = path.resolve(`data/raw/holders-history/${sym}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(file, JSON.stringify({ symbol: sym, indexedToDate: today, source: "dune", series }, null, 1));
}

export async function collectEvmPnl(asset) {
  if (!duneAvailable()) throw new Error("Missing DUNE_API_KEY");
  if (!CHAIN_OK.has(asset.chain)) throw new Error(`${asset.symbol}: chain ${asset.chain} not on Dune`);
  const addr = evmAddr(asset);
  if (!addr) throw new Error(`${asset.symbol}: no EVM contract address`);

  const { rows, datapoints, ms } = await runQuery(`evm_pnl_${asset.chain}`, snapSql(asset.chain), { addr }, { maxWaitMs: 480000 });
  const r = rows[0];
  if (!r || r.holders == null) throw new Error(`${asset.symbol}: empty result`);
  const today = new Date().toISOString().slice(0, 10);

  // pnl row (% en gain + profit tranches)
  const pnl = readPnlSeries(asset.symbol).filter((s) => s.date !== today);
  pnl.push({
    date: today,
    holders: Number(r.holders), airdrop: 0, buyers: Number(r.holders),
    inProfit: Number(r.in_profit),
    pctInProfit: r.pct_in_profit == null ? null : Number(r.pct_in_profit),
    x10: Number(r.x10), x2_10: Number(r.x2_10), x1_2: Number(r.x1_2),
    l0_50: Number(r.l0_50), l50: Number(r.l50),
    realizedUsd: 0, realizedBigUsd: 0, source: "dune",
  });
  pnl.sort((a, b) => a.date.localeCompare(b.date));
  writePnl(asset.symbol, pnl);

  // holders-history point (count + $-tiers)
  const tiers = Object.fromEntries(TIER_KEYS.map((k) => [k, Number(r[k]) || 0]));
  const hh = readHoldersHist(asset.symbol).filter((s) => s.date !== today);
  hh.push({ date: today, holders: Number(r.holders), tiers, source: "dune" });
  hh.sort((a, b) => a.date.localeCompare(b.date));
  writeHoldersHist(asset.symbol, hh);

  return { holders: Number(r.holders), pct: Number(r.pct_in_profit), h50: TIER_KEYS.slice(1).reduce((s, k) => s + (Number(r[k]) || 0), 0), datapoints, ms };
}

export async function collectEvmPnlHistory(asset) {
  if (!duneAvailable()) throw new Error("Missing DUNE_API_KEY");
  if (!CHAIN_OK.has(asset.chain)) throw new Error(`${asset.symbol}: chain ${asset.chain} not on Dune`);
  const addr = evmAddr(asset);
  if (!addr) throw new Error(`${asset.symbol}: no EVM contract address`);

  let priceSeries;
  try { priceSeries = JSON.parse(fs.readFileSync(path.resolve(`data/raw/prices-history/${asset.symbol}.json`), "utf8")).series || []; }
  catch { throw new Error(`${asset.symbol}: no price history (run backfill:prices-dune first)`); }
  if (!priceSeries.length) throw new Error(`${asset.symbol}: empty price history`);

  // 1) histograms (cost + balance)  2) exact daily holder count
  const hg = await runQuery(`evm_hist_${asset.chain}`, histSql(asset.chain), { addr }, { maxWaitMs: 540000 });
  const cnt = await runQuery(`evm_count_${asset.chain}`, countSql(asset.chain), { addr }, { maxWaitMs: 540000 });

  const costB = hg.rows.filter((r) => r.kind === "cost" && r.rep != null)
    .map((r) => ({ rep: Number(r.rep), holders: Number(r.holders), supply: Number(r.supply) }));
  const balB = hg.rows.filter((r) => r.kind === "bal" && r.rep != null)
    .map((r) => ({ rep: Number(r.rep), holders: Number(r.holders) }));
  if (!costB.length || !balB.length) throw new Error(`${asset.symbol}: empty histogram`);
  const totCost = costB.reduce((s, b) => s + b.holders, 0);
  const totBal = balB.reduce((s, b) => s + b.holders, 0);

  // Exact holder count per activity day → forward-filled lookup.
  const countRows = cnt.rows.map((r) => ({ date: String(r.d).slice(0, 10), holders: Number(r.holders) }))
    .filter((r) => r.date).sort((a, b) => a.date.localeCompare(b.date));
  // The crossing count includes dust wallets (any non-zero balance), so it sits
  // a bit above the "meaningful holder" count the live snapshot reports (net ≥
  // $0.01). Calibrate the whole historical curve so its most recent point equals
  // the live snapshot — the growth SHAPE is what matters, and this keeps the
  // series continuous with the number shown everywhere else (pnl.holders/tiers).
  const crossingFinal = countRows.length ? countRows[countRows.length - 1].holders : totBal;
  const liveSnap = readPnlSeries(asset.symbol).filter((r) => r.source !== "dune-hist").pop();
  const calib = (liveSnap?.holders && crossingFinal) ? liveSnap.holders / crossingFinal : 1;
  const holdersAsOf = (date) => {
    let v = countRows.length ? countRows[0].holders : totBal;
    for (const c of countRows) { if (c.date <= date) v = c.holders; else break; }
    return Math.round(v * calib);
  };

  const pnlHist = [], holdersHist = [];
  for (const { date, price } of priceSeries) {
    if (!(price > 0)) continue;
    // % en gain + profit tranches from the cost histogram
    let inProfit = 0, x10 = 0, x2_10 = 0, x1_2 = 0, l0_50 = 0, l50 = 0;
    for (const b of costB) {
      const ratio = price / b.rep;
      if (ratio > 1) inProfit += b.holders;
      if (ratio >= 10) x10 += b.holders;
      else if (ratio >= 2) x2_10 += b.holders;
      else if (ratio > 1) x1_2 += b.holders;
      else if (ratio >= 0.5) l0_50 += b.holders;
      else l50 += b.holders;
    }
    pnlHist.push({
      date, holders: totCost, airdrop: 0, buyers: totCost, inProfit,
      pctInProfit: Math.round((1000 * inProfit) / totCost) / 10,
      x10, x2_10, x1_2, l0_50, l50, realizedUsd: 0, realizedBigUsd: 0, source: "dune-hist",
    });
    // $-tiers: balance-histogram fractions × the EXACT holder count of that day
    const frac = { lt50: 0, t50_500: 0, t500_5k: 0, t5k_50k: 0, gt50k: 0 };
    for (const b of balB) {
      const usd = b.rep * price;
      const k = usd < 50 ? "lt50" : usd < 500 ? "t50_500" : usd < 5000 ? "t500_5k" : usd < 50000 ? "t5k_50k" : "gt50k";
      frac[k] += b.holders;
    }
    const hExact = holdersAsOf(date);
    const tiers = Object.fromEntries(TIER_KEYS.map((k) => [k, Math.round((frac[k] / totBal) * hExact)]));
    holdersHist.push({ date, holders: hExact, tiers, source: "dune-hist" });
  }

  // Merge: history as base, live snapshots (source!=="dune-hist") kept on top.
  const mergePnl = new Map();
  for (const r of pnlHist) mergePnl.set(r.date, r);
  for (const r of readPnlSeries(asset.symbol)) if (r.source !== "dune-hist") mergePnl.set(r.date, r);
  writePnl(asset.symbol, [...mergePnl.values()].sort((a, b) => a.date.localeCompare(b.date)));

  // holders-history: backfill fills all dates; live snapshots (source "dune",
  // exact tiers, written by collectEvmPnl) win for their own date.
  const mergeHH = new Map();
  for (const r of holdersHist) mergeHH.set(r.date, r);
  // Only an explicitly live snapshot (source "dune") wins over the backfill —
  // NOT older untagged points, which are stale backfill output to be replaced.
  for (const r of readHoldersHist(asset.symbol)) if (r.source === "dune") mergeHH.set(r.date, r);
  writeHoldersHist(asset.symbol, [...mergeHH.values()].sort((a, b) => a.date.localeCompare(b.date)));

  return {
    days: pnlHist.length, costBuckets: costB.length, balBuckets: balB.length,
    holdersPeak: Math.max(...countRows.map((c) => c.holders), 0),
    datapoints: (hg.datapoints || 0) + (cnt.datapoints || 0), ms: (hg.ms || 0) + (cnt.ms || 0),
  };
}
