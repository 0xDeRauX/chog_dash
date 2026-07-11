// Queries SQLite and writes public/data.json, the only thing the static
// dashboard reads. Assets are emitted in config order and tagged by group
// (memes / majors) so each page renders its own universe.
// Usage: npm run build:dashboard
import fs from "fs";
import path from "path";
import { openDb } from "../src/lib/db.js";
import { ASSETS, CHAINS } from "../src/config.js";

const db = openDb();

// On-chain concentration/distribution aggregates for tokens we index ourselves
// (thirdweb ledger in data/holders-state/<sym>.json). Only compact aggregates
// go into data.json — never the raw per-address balances (that stays gitignored).
function computeOnchain(cfg) {
  if (cfg.holders?.source !== "thirdweb") return null;
  const file = path.resolve(`data/holders-state/${cfg.symbol}.json`);
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const balances = Object.values(raw.balances || {}).map(BigInt).filter((b) => b > 0n);
  if (!balances.length) return null;
  balances.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // descending
  const n = balances.length;
  const total = balances.reduce((a, b) => a + b, 0n);
  const dec = BigInt(cfg.holders.decimals ?? 18);
  const asTok = (b) => Number(b / (dec > 6n ? 10n ** (dec - 6n) : 1n)) / (dec > 6n ? 1e6 : 1);
  const share = (k) => Number((balances.slice(0, k).reduce((a, b) => a + b, 0n) * 10000n) / total) / 100;
  // Gini over token amounts (ascending Lorenz).
  const asc = [...balances].reverse().map(asTok);
  const totTok = asc.reduce((a, b) => a + b, 0);
  let cum = 0, lorenz = 0;
  for (const v of asc) { cum += v; lorenz += cum; }
  const gini = totTok > 0 ? (n + 1 - 2 * (lorenz / totTok)) / n : null;
  // Distribution histogram by human-readable balance tier.
  const tiers = [[0, 1], [1, 10], [10, 100], [100, 1e3], [1e3, 1e4], [1e4, 1e5], [1e5, 1e6], [1e6, Infinity]];
  const labels = ["<1", "1–10", "10–100", "100–1K", "1K–10K", "10K–100K", "100K–1M", "1M+"];
  const buckets = tiers.map((t, i) => ({ label: labels[i], count: 0 }));
  for (const b of balances) {
    const t = asTok(b);
    for (let i = 0; i < tiers.length; i++) if (t >= tiers[i][0] && t < tiers[i][1]) { buckets[i].count++; break; }
  }
  return {
    holders: n,
    supply: asTok(total),
    top1: share(1), top10: share(10), top50: share(50), top100: share(Math.min(100, n)),
    gini: gini == null ? null : Number(gini.toFixed(4)),
    whales: balances.filter((b) => Number((b * 10000n) / total) / 100 >= 1).length, // ≥1% of supply
    buckets,
    lastBlock: raw.lastBlock,
  };
}

const assetStmt = db.prepare(`SELECT id, symbol, chain FROM assets WHERE symbol = ?`);
const mentionsStmt = db.prepare(
  `SELECT date, mention_count AS count FROM mentions_daily WHERE asset_id = ? ORDER BY date`
);
const pricesStmt = db.prepare(
  `SELECT date, price_usd AS price, change_24h AS change24h, volume_usd AS volume FROM price_daily WHERE asset_id = ? ORDER BY date`
);
// Latest known market cap (the daily snapshot carries it; backfilled history rows are null).
const marketCapStmt = db.prepare(
  `SELECT market_cap FROM price_daily WHERE asset_id = ? AND market_cap IS NOT NULL ORDER BY date DESC LIMIT 1`
);
const discordStmt = db.prepare(
  `SELECT date, member_count AS members, online_count AS online FROM discord_daily WHERE asset_id = ? ORDER BY date`
);
const holdersStmt = db.prepare(
  `SELECT date, holders FROM holders_daily WHERE asset_id = ? ORDER BY date`
);
const flowsStmt = db.prepare(
  `SELECT date, accumulating, distributing, new_holders AS newHolders, churned FROM holder_flows_daily WHERE asset_id = ? ORDER BY date`
);

const assets = ASSETS.map((cfg) => {
  const row = assetStmt.get(cfg.symbol);
  if (!row) return null;
  const prices = pricesStmt.all(row.id);
  const mentions = mentionsStmt.all(row.id);
  const discord = discordStmt.all(row.id);
  return {
    group: cfg.group,
    symbol: row.symbol,
    chain: row.chain,
    latestChange24h: prices.length ? prices.at(-1).change24h : null,
    marketCap: marketCapStmt.get(row.id)?.market_cap ?? null,
    discord,
    holders: holdersStmt.all(row.id),
    holderFlows: flowsStmt.all(row.id),
    onchain: computeOnchain(cfg),
    mentions,
    prices,
  };
}).filter(Boolean);

// TVL series per chain key (assets look theirs up by `chain`). Emitted once per
// chain rather than duplicated per asset.
// Cap to the recent window (some chains have years of history) so data.json
// stays lean and TVL aligns with the price/mention horizon.
const WINDOW_DAYS = 300;
const tvlStmt = db.prepare(
  `SELECT date, tvl_usd AS tvl FROM tvl_daily WHERE chain = ? ORDER BY date DESC LIMIT ${WINDOW_DAYS}`
);
const tvlByChain = {};
for (const chainKey of Object.keys(CHAINS)) {
  if (!CHAINS[chainKey]) continue;
  const series = tvlStmt.all(chainKey).reverse();
  if (series.length) tvlByChain[chainKey] = series;
}

const data = {
  generatedAt: new Date().toISOString(),
  assets,
  tvlByChain,
};

db.close();

fs.mkdirSync(path.resolve("public"), { recursive: true });
fs.writeFileSync(path.resolve("public/data.json"), JSON.stringify(data));
console.log(`Wrote public/data.json with ${assets.length} assets.`);
