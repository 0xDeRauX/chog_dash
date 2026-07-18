// Buy vs sell volume per asset — two quality tiers, both keyless:
//   - Binance-listed (asset.binance): daily klines carry the taker-BUY quote
//     volume; sell = total − buy. Real $ split, WITH history (backfill 365d on
//     the first run, incremental after).
//   - DEX-only tokens: DexScreener's best pair gives 24h buy/sell TRANSACTION
//     COUNTS (+ total $ volume) — a daily snapshot that accumulates from the
//     first collection (no $ split, no backfill).
import fs from "fs";
import path from "path";

const HIST_DIR = path.resolve("data/raw/tradeflow-history");
const todayUTCstr = () => new Date().toISOString().slice(0, 10);

// ---- Binance (spot OR perp futures — same kline shape) -------------------
// Assets without a spot pair often have a USDT perp (HYPE, MON, FARTCOIN, AKT):
// perp taker flow is a fine buy/sell-pressure proxy, with the same history.
async function binanceKlines(symbol, days, perp = false) {
  const base = perp ? "https://fapi.binance.com/fapi/v1/klines" : "https://api.binance.com/api/v3/klines";
  const url = new URL(base);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("limit", String(Math.min(days + 1, 1000)));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance${perp ? " perp" : ""} HTTP ${res.status} for ${symbol}`);
  const klines = await res.json();
  const today = todayUTCstr();
  const out = [];
  for (const c of klines) {
    const date = new Date(c[0]).toISOString().slice(0, 10);
    if (date >= today) continue; // drop the incomplete running candle
    const total = Number(c[7]);   // quote (USD) volume
    const buy = Number(c[10]);    // taker-buy quote volume
    out.push({ date, buyUsd: buy, sellUsd: Math.max(0, total - buy) });
  }
  return out;
}
const binancePair = (asset) => asset.binance
  ? { symbol: asset.binance, perp: false }
  : asset.binancePerp ? { symbol: asset.binancePerp, perp: true } : null;

// ---- GeckoTerminal (keyless): real $ buy/sell split for DEX-only tokens ---
// The trades endpoint returns the last ~300 trades of the top pool. For
// low-activity tokens (CHOG ~240 tx/day) that covers a full day → an exact
// daily USD split. If 300 trades don't span 24h (busy tokens), we return null
// and the tx-count snapshot remains the source.
async function geckoTradesSplit(network, tokenAddress) {
  const gt = "https://api.geckoterminal.com/api/v2";
  const pools = await fetch(`${gt}/networks/${network}/tokens/${tokenAddress}/pools`,
    { headers: { accept: "application/json" } });
  if (!pools.ok) throw new Error(`GeckoTerminal pools HTTP ${pools.status}`);
  const pool = (await pools.json()).data?.[0]?.attributes?.address;
  if (!pool) return null;
  const tr = await fetch(`${gt}/networks/${network}/pools/${pool}/trades`,
    { headers: { accept: "application/json" } });
  if (!tr.ok) throw new Error(`GeckoTerminal trades HTTP ${tr.status}`);
  const trades = (await tr.json()).data || [];
  if (!trades.length || trades.length >= 300) return null; // window truncated
  const cutoff = Date.now() - 864e5;
  let buy = 0, sell = 0;
  for (const t of trades) {
    const a = t.attributes;
    if (new Date(a.block_timestamp).getTime() < cutoff) continue;
    const v = Number(a.volume_in_usd) || 0;
    if (a.kind === "buy") buy += v; else sell += v;
  }
  return { buyUsd: buy, sellUsd: sell };
}

// ---- DexScreener ----------------------------------------------------------
async function dexscreenerSnapshot(address) {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
  if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
  const { pairs = [] } = await res.json();
  const p = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
  if (!p?.txns?.h24) return null;
  return {
    buyTx: p.txns.h24.buys ?? null,
    sellTx: p.txns.h24.sells ?? null,
    volUsd: p.volume?.h24 ?? null,
  };
}

// One-off Binance history (skipped when the file already exists).
export async function backfillTradeflow(assets, days = 365) {
  fs.mkdirSync(HIST_DIR, { recursive: true });
  const done = [];
  for (const asset of assets) {
    const pair = binancePair(asset);
    if (!pair) continue;
    const file = path.join(HIST_DIR, `${asset.symbol}.json`);
    if (fs.existsSync(file)) continue;
    try {
      const series = await binanceKlines(pair.symbol, days, pair.perp);
      fs.writeFileSync(file, JSON.stringify({ symbol: asset.symbol, pair: pair.symbol, perp: pair.perp, series }, null, 2));
      done.push(`${asset.symbol}: ${series.length}j${pair.perp ? " (perp)" : ""}`);
    } catch (err) {
      console.error(`Backfill skipped ${asset.symbol}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  return done;
}

// Daily collection: a few recent completed days for Binance assets (self-heals
// gaps, upserts dedupe), plus today's DEX snapshot for the others.
export async function collectTradeflow(assets) {
  const results = [];
  for (const asset of assets) {
    try {
      const pair = binancePair(asset);
      if (pair) {
        const series = await binanceKlines(pair.symbol, 5, pair.perp);
        if (series.length) results.push({ symbol: asset.symbol, series });
      } else {
        const address = asset.holders?.contract || asset.holders?.mint;
        if (!address) continue; // no free source at all
        const snap = await dexscreenerSnapshot(address);
        // Low-activity DEX tokens get a real $ split too (full-day GT window).
        let usd = null;
        if (asset.gtNetwork) {
          try { usd = await geckoTradesSplit(asset.gtNetwork, address); }
          catch (err) { console.error(`GT split ${asset.symbol}: ${err.message}`); }
        }
        if (snap || usd) results.push({ symbol: asset.symbol, ...(snap || {}), ...(usd || {}) });
      }
    } catch (err) {
      console.error(`Skipped ${asset.symbol}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return results;
}
