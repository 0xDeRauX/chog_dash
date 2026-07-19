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
    INSERT INTO price_daily (asset_id, date, price_usd, change_24h, market_cap, volume_usd, source, collected_at)
    VALUES (@assetId, @date, @priceUsd, @change24h, @marketCap, @volume, @source, @collectedAt)
    ON CONFLICT(asset_id, date, source) DO UPDATE SET
      price_usd = excluded.price_usd,
      change_24h = excluded.change_24h,
      market_cap = excluded.market_cap,
      volume_usd = excluded.volume_usd,
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
        volume: point.volume ?? null,
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
        volume: r.volume24h ?? null,
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

  const upsertDiscord = db.prepare(`
    INSERT INTO discord_daily (asset_id, date, member_count, online_count)
    VALUES (@assetId, @date, @memberCount, @onlineCount)
    ON CONFLICT(asset_id, date) DO UPDATE SET
      member_count = excluded.member_count,
      online_count = excluded.online_count
  `);

  let discordRows = 0;
  for (const file of readRawFiles("discord")) {
    for (const r of file.results) {
      const asset = getAssetId.get(r.symbol);
      if (!asset) continue;
      upsertDiscord.run({
        assetId: asset.id,
        date: file.date,
        memberCount: r.memberCount ?? null,
        onlineCount: r.onlineCount ?? null,
      });
      discordRows++;
    }
  }

  const upsertTelegram = db.prepare(`
    INSERT INTO telegram_daily (asset_id, date, members)
    VALUES (@assetId, @date, @members)
    ON CONFLICT(asset_id, date) DO UPDATE SET members = excluded.members
  `);
  let telegramRows = 0;
  for (const file of readRawFiles("telegram")) {
    for (const r of file.results) {
      const asset = getAssetId.get(r.symbol);
      if (!asset || r.members == null) continue;
      upsertTelegram.run({ assetId: asset.id, date: file.date, members: r.members });
      telegramRows++;
    }
  }

  const upsertHolders = db.prepare(`
    INSERT INTO holders_daily (asset_id, date, holders)
    VALUES (@assetId, @date, @holders)
    ON CONFLICT(asset_id, date) DO UPDATE SET holders = excluded.holders
  `);
  const upsertFlows = db.prepare(`
    INSERT INTO holder_flows_daily (asset_id, date, accumulating, distributing, new_holders, churned)
    VALUES (@assetId, @date, @accumulating, @distributing, @newHolders, @churned)
    ON CONFLICT(asset_id, date) DO UPDATE SET
      accumulating = excluded.accumulating,
      distributing = excluded.distributing,
      new_holders = excluded.new_holders,
      churned = excluded.churned
  `);
  const upsertTiers = db.prepare(`
    INSERT INTO holder_tiers_daily (asset_id, date, lt50, t50_500, t500_5k, t5k_50k, gt50k)
    VALUES (@assetId, @date, @lt50, @t50_500, @t500_5k, @t5k_50k, @gt50k)
    ON CONFLICT(asset_id, date) DO UPDATE SET
      lt50 = excluded.lt50, t50_500 = excluded.t50_500, t500_5k = excluded.t500_5k,
      t5k_50k = excluded.t5k_50k, gt50k = excluded.gt50k
  `);
  let holderRows = 0, flowRows = 0, tierRows = 0;
  for (const file of readRawFiles("holders")) {
    for (const r of file.results) {
      const asset = getAssetId.get(r.symbol);
      if (!asset || r.holders == null) continue;
      upsertHolders.run({ assetId: asset.id, date: file.date, holders: r.holders });
      holderRows++;
      if (r.tiers) {
        upsertTiers.run({ assetId: asset.id, date: file.date, ...r.tiers });
        tierRows++;
      }
      if (r.flows) {
        upsertFlows.run({
          assetId: asset.id, date: file.date,
          accumulating: r.flows.accumulating ?? null,
          distributing: r.flows.distributing ?? null,
          newHolders: r.flows.newHolders ?? null,
          churned: r.flows.churned ?? null,
        });
        flowRows++;
      }
    }
  }

  // Buy/sell volume: Binance history files (per-symbol series), Binance daily
  // series and DexScreener daily snapshots share one upsert.
  const upsertFlow = db.prepare(`
    INSERT INTO tradeflow_daily (asset_id, date, buy_usd, sell_usd, buy_tx, sell_tx)
    VALUES (@assetId, @date, @buyUsd, @sellUsd, @buyTx, @sellTx)
    ON CONFLICT(asset_id, date) DO UPDATE SET
      buy_usd = COALESCE(excluded.buy_usd, buy_usd),
      sell_usd = COALESCE(excluded.sell_usd, sell_usd),
      buy_tx = COALESCE(excluded.buy_tx, buy_tx),
      sell_tx = COALESCE(excluded.sell_tx, sell_tx)
  `);
  let tradeflowRows = 0;
  const flowPoint = (assetId, date, p) => {
    upsertFlow.run({
      assetId, date,
      buyUsd: p.buyUsd ?? null, sellUsd: p.sellUsd ?? null,
      buyTx: p.buyTx ?? null, sellTx: p.sellTx ?? null,
    });
    tradeflowRows++;
  };
  for (const hist of readRawFiles("tradeflow-history")) {
    const asset = getAssetId.get(hist.symbol);
    if (!asset) continue;
    for (const p of hist.series || []) flowPoint(asset.id, p.date, p);
  }
  for (const file of readRawFiles("tradeflow")) {
    for (const r of file.results || []) {
      const asset = getAssetId.get(r.symbol);
      if (!asset) continue;
      if (r.series) for (const p of r.series) flowPoint(asset.id, p.date, p);
      else flowPoint(asset.id, file.date, r);
    }
  }

  // Chain Radar snapshots + promoted-token mentions (keyed by chain+address —
  // discovered tokens live outside the assets table).
  const upsertPnl = db.prepare(`
    INSERT INTO pnl_daily (asset_id, date, holders, airdrop, buyers, in_profit, pct_in_profit, x10, x2_10, x1_2, l0_50, l50, realized_usd, realized_big_usd)
    VALUES (@assetId, @date, @holders, @airdrop, @buyers, @inProfit, @pctInProfit, @x10, @x2_10, @x1_2, @l0_50, @l50, @realizedUsd, @realizedBigUsd)
    ON CONFLICT(asset_id, date) DO UPDATE SET
      holders = excluded.holders, airdrop = excluded.airdrop, buyers = excluded.buyers,
      in_profit = excluded.in_profit, pct_in_profit = excluded.pct_in_profit,
      x10 = excluded.x10, x2_10 = excluded.x2_10, x1_2 = excluded.x1_2,
      l0_50 = excluded.l0_50, l50 = excluded.l50,
      realized_usd = excluded.realized_usd, realized_big_usd = excluded.realized_big_usd
  `);
  let pnlRows = 0;
  for (const file of readRawFiles("pnl")) {
    const asset = getAssetId.get(file.symbol);
    if (!asset) continue;
    for (const r of file.series || []) {
      upsertPnl.run({
        assetId: asset.id, date: r.date, holders: r.holders ?? null, airdrop: r.airdrop ?? null,
        buyers: r.buyers ?? null, inProfit: r.inProfit ?? null,
        pctInProfit: r.pctInProfit ?? null, x10: r.x10 ?? null, x2_10: r.x2_10 ?? null,
        x1_2: r.x1_2 ?? null, l0_50: r.l0_50 ?? null, l50: r.l50 ?? null,
        realizedUsd: r.realizedUsd ?? null, realizedBigUsd: r.realizedBigUsd ?? null,
      });
      pnlRows++;
    }
  }

  const upsertRadar = db.prepare(`
    INSERT INTO chain_radar_daily (chain, address, date, symbol, price, liq, vol, d24, pools, buys, sells, holders, fdv, age, pinned, tg_members, dc_members, socials, crit)
    VALUES (@chain, @address, @date, @symbol, @price, @liq, @vol, @d24, @pools, @buys, @sells, @holders, @fdv, @age, @pinned, @tgMembers, @dcMembers, @socials, @crit)
    ON CONFLICT(chain, address, date) DO UPDATE SET
      symbol = excluded.symbol, price = excluded.price, liq = excluded.liq, vol = excluded.vol,
      d24 = excluded.d24, pools = excluded.pools, buys = excluded.buys, sells = excluded.sells,
      holders = excluded.holders, fdv = excluded.fdv, age = excluded.age, pinned = excluded.pinned,
      tg_members = excluded.tg_members, dc_members = excluded.dc_members, socials = excluded.socials, crit = excluded.crit
  `);
  let radarRows = 0;
  for (const file of readRawFiles("chainradar")) {
    if (!file.chains) continue; // skip the promoted.json state file
    for (const [chain, toks] of Object.entries(file.chains)) {
      for (const t of toks) {
        upsertRadar.run({
          chain, address: t.address, date: file.date, symbol: t.symbol ?? null,
          price: t.price ?? null, liq: t.liq ?? null, vol: t.vol ?? null, d24: t.d24 ?? null,
          pools: t.pools ?? null, buys: t.buys ?? null, sells: t.sells ?? null,
          holders: t.holders ?? null, fdv: t.fdv ?? null, age: t.age ?? null,
          pinned: t.pinned ? 1 : 0,
          tgMembers: t.tgMembers ?? null, dcMembers: t.dcMembers ?? null, crit: t.crit ?? null,
          socials: (t.tgUrl || t.dcUrl || t.twUrl) ? JSON.stringify({ tg: t.tgUrl, dc: t.dcUrl, tw: t.twUrl }) : null,
        });
        radarRows++;
      }
    }
  }
  // Backfilled price/volume history for radar tokens (GT OHLCV). Fills ONLY
  // what the daily snapshots don't have: existing values win via COALESCE.
  const upsertRadarHist = db.prepare(`
    INSERT INTO chain_radar_daily (chain, address, date, symbol, price, vol)
    VALUES (@chain, @address, @date, @symbol, @price, @vol)
    ON CONFLICT(chain, address, date) DO UPDATE SET
      symbol = COALESCE(chain_radar_daily.symbol, excluded.symbol),
      price = COALESCE(chain_radar_daily.price, excluded.price),
      vol = COALESCE(chain_radar_daily.vol, excluded.vol)
  `);
  for (const hist of readRawFiles("chainradar-history")) {
    for (const point of hist.series) {
      upsertRadarHist.run({
        chain: hist.chain, address: hist.address, date: point.date,
        symbol: hist.symbol ?? null, price: point.price ?? null, vol: point.vol ?? null,
      });
      radarRows++;
    }
  }

  const upsertRadarMentions = db.prepare(`
    INSERT INTO radar_mentions_daily (chain, address, date, count)
    VALUES (@chain, @address, @date, @count)
    ON CONFLICT(chain, address, date) DO UPDATE SET count = excluded.count
  `);
  for (const file of readRawFiles("radar-mentions")) {
    for (const r of file.results || []) {
      if (r.count == null) continue;
      upsertRadarMentions.run({ chain: r.chain, address: r.address, date: file.date, count: r.count });
      radarRows++;
    }
  }

  db.close();
  return { mentionRows, priceRows, tvlRows, discordRows, telegramRows, holderRows, flowRows, tierRows, tradeflowRows, radarRows, pnlRows };
}
