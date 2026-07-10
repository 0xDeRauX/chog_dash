// Queries SQLite and writes public/data.json, the only thing the static
// dashboard reads. Assets are emitted in config order and tagged by group
// (memes / majors) so each page renders its own universe.
// Usage: npm run build:dashboard
import fs from "fs";
import path from "path";
import { openDb } from "../src/lib/db.js";
import { ASSETS, CHAINS } from "../src/config.js";

const db = openDb();

const assetStmt = db.prepare(`SELECT id, symbol, chain FROM assets WHERE symbol = ?`);
const mentionsStmt = db.prepare(
  `SELECT date, mention_count AS count FROM mentions_daily WHERE asset_id = ? ORDER BY date`
);
const pricesStmt = db.prepare(
  `SELECT date, price_usd AS price, change_24h AS change24h FROM price_daily WHERE asset_id = ? ORDER BY date`
);
// Latest known market cap (the daily snapshot carries it; backfilled history rows are null).
const marketCapStmt = db.prepare(
  `SELECT market_cap FROM price_daily WHERE asset_id = ? AND market_cap IS NOT NULL ORDER BY date DESC LIMIT 1`
);
const discordStmt = db.prepare(
  `SELECT date, member_count AS members, online_count AS online FROM discord_daily WHERE asset_id = ? ORDER BY date`
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
