// Queries SQLite and writes public/data.json, the only thing the static
// dashboard reads. Run after `npm run ingest`.
// Usage: npm run build:dashboard
import fs from "fs";
import path from "path";
import { openDb } from "../src/lib/db.js";
import { ASSETS } from "../src/config.js";

const db = openDb();

const assetStmt = db.prepare(`SELECT id, symbol, chain FROM assets WHERE symbol = ?`);
const mentionsStmt = db.prepare(
  `SELECT date, mention_count AS count FROM mentions_daily WHERE asset_id = ? ORDER BY date`
);
const pricesStmt = db.prepare(
  `SELECT date, price_usd AS price, change_24h AS change24h FROM price_daily WHERE asset_id = ? ORDER BY date`
);

// Canonical order (CHOG first, then comparables) — not alphabetical — so the
// frontend can assign fixed categorical colors by position.
const assets = ASSETS.map((a) => assetStmt.get(a.symbol)).filter(Boolean);

const data = {
  generatedAt: new Date().toISOString(),
  assets: assets.map((a) => ({
    symbol: a.symbol,
    chain: a.chain,
    mentions: mentionsStmt.all(a.id),
    prices: pricesStmt.all(a.id),
  })),
};

db.close();

fs.mkdirSync(path.resolve("public"), { recursive: true });
fs.writeFileSync(path.resolve("public/data.json"), JSON.stringify(data, null, 2));
console.log(`Wrote public/data.json with ${assets.length} assets.`);
