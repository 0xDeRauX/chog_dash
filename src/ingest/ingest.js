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

  // Backfilled history: one file per symbol, full daily series (calendar-day).
  for (const hist of readRawFiles("x-mentions-history")) {
    const asset = getAssetId.get(hist.symbol);
    if (!asset) continue;
    for (const point of hist.series) {
      upsertMentions.run({
        assetId: asset.id,
        date: point.date,
        mentionCount: point.count,
        source: "x-api",
        collectedAt: `${point.date}T00:00:00.000Z`,
      });
      mentionRows++;
    }
  }

  // Daily snapshots (calendar-day, one file per collected day).
  for (const file of readRawFiles("x-mentions")) {
    for (const r of file.results) {
      const asset = getAssetId.get(r.symbol);
      if (!asset) continue;
      upsertMentions.run({
        assetId: asset.id,
        date: r.date ?? file.date,
        mentionCount: r.mentionCount,
        source: "x-api",
        collectedAt: r.collectedAt ?? `${r.date ?? file.date}T00:00:00.000Z`,
      });
      mentionRows++;
    }
  }

  const upsertPrice = db.prepare(`
    INSERT INTO price_daily (asset_id, date, price_usd, change_24h, market_cap, source, collected_at)
    VALUES (@assetId, @date, @priceUsd, @change24h, @marketCap, @source, @collectedAt)
    ON CONFLICT(asset_id, date, source) DO UPDATE SET
      price_usd = excluded.price_usd,
      change_24h = excluded.change_24h,
      market_cap = excluded.market_cap,
      collected_at = excluded.collected_at
  `);

  let priceRows = 0;

  // Backfilled history: one file per symbol, each a full daily series.
  // Same source ('coingecko') as the daily snapshots so they share one row
  // per (asset, date) — history fills old dates, the daily collector adds today.
  for (const hist of readRawFiles("prices-history")) {
    const asset = getAssetId.get(hist.symbol);
    if (!asset) continue;
    for (const point of hist.series) {
      upsertPrice.run({
        assetId: asset.id,
        date: point.date,
        priceUsd: point.price,
        change24h: null,
        marketCap: null,
        source: "coingecko",
        collectedAt: `${point.date}T00:00:00.000Z`,
      });
      priceRows++;
    }
  }

  // Daily snapshots: authoritative for their date (carry the 24h change),
  // so they run last and win any overlap with the backfilled point.
  for (const file of readRawFiles("prices")) {
    for (const r of file.results) {
      const asset = getAssetId.get(r.symbol);
      if (!asset) continue;
      upsertPrice.run({
        assetId: asset.id,
        date: file.date,
        priceUsd: r.priceUsd,
        change24h: r.change24h,
        marketCap: r.marketCap ?? null,
        source: "coingecko",
        collectedAt: `${file.date}T00:00:00.000Z`,
      });
      priceRows++;
    }
  }

  const upsertTvl = db.prepare(`
    INSERT INTO tvl_daily (chain, date, tvl_usd)
    VALUES (@chain, @date, @tvl)
    ON CONFLICT(chain, date) DO UPDATE SET tvl_usd = excluded.tvl_usd
  `);

  let tvlRows = 0;
  for (const file of readRawFiles("tvl")) {
    for (const point of file.series) {
      upsertTvl.run({ chain: file.chain, date: point.date, tvl: point.tvl });
      tvlRows++;
    }
  }

  db.close();
  return { mentionRows, priceRows, tvlRows };
}
