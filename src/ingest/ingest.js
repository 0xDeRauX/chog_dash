import fs from "fs";
import path from "path";
import { openDb } from "../lib/db.js";
import { ASSETS } from "../config.js";

function readRawFiles(source) {
  const dir = path.resolve("data/raw", source);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

export function ingestAll() {
  const db = openDb();

  const upsertAsset = db.prepare(`
    INSERT INTO assets (symbol, chain, coingecko_id, x_query)
    VALUES (@symbol, @chain, @coingeckoId, @xQuery)
    ON CONFLICT(symbol) DO UPDATE SET
      chain = excluded.chain,
      coingecko_id = excluded.coingecko_id,
      x_query = excluded.x_query
  `);
  for (const asset of ASSETS) {
    upsertAsset.run({
      symbol: asset.symbol,
      chain: asset.chain,
      coingeckoId: asset.coingeckoId,
      xQuery: asset.xQuery,
    });
  }

  const getAssetId = db.prepare(`SELECT id FROM assets WHERE symbol = ?`);

  const upsertMentions = db.prepare(`
    INSERT INTO mentions_daily (asset_id, date, mention_count, source, collected_at)
    VALUES (@assetId, @date, @mentionCount, @source, @collectedAt)
    ON CONFLICT(asset_id, date, source) DO UPDATE SET
      mention_count = excluded.mention_count,
      collected_at = excluded.collected_at
  `);

  let mentionRows = 0;
  for (const file of readRawFiles("x-mentions")) {
    for (const r of file.results) {
      const asset = getAssetId.get(r.symbol);
      if (!asset) continue;
      upsertMentions.run({
        assetId: asset.id,
        date: file.date,
        mentionCount: r.mentionCount,
        source: "x-api",
        collectedAt: r.startTime,
      });
      mentionRows++;
    }
  }

  const upsertPrice = db.prepare(`
    INSERT INTO price_daily (asset_id, date, price_usd, change_24h, source, collected_at)
    VALUES (@assetId, @date, @priceUsd, @change24h, @source, @collectedAt)
    ON CONFLICT(asset_id, date, source) DO UPDATE SET
      price_usd = excluded.price_usd,
      change_24h = excluded.change_24h,
      collected_at = excluded.collected_at
  `);

  let priceRows = 0;
  for (const file of readRawFiles("prices")) {
    for (const r of file.results) {
      const asset = getAssetId.get(r.symbol);
      if (!asset) continue;
      upsertPrice.run({
        assetId: asset.id,
        date: file.date,
        priceUsd: r.priceUsd,
        change24h: r.change24h,
        source: "coingecko",
        collectedAt: `${file.date}T00:00:00.000Z`,
      });
      priceRows++;
    }
  }

  db.close();
  return { mentionRows, priceRows };
}
