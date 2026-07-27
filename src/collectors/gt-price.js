// GeckoTerminal daily price/volume history for config tokens without a CoinGecko
// listing (TON jetton memecoins). Same keyless OHLCV feed the radar backfill
// uses; doubles as the daily refresh (the day candle includes today). Returns
// { series, fdv } where fdv (from the pool) tags the latest point as market cap.
import { gtJson } from "./chainradar.js";

const GT = "https://api.geckoterminal.com/api/v2";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchGtPriceHistory(chain, tokenAddr) {
  const pools = await gtJson(`${GT}/networks/${chain}/tokens/${tokenAddr}/pools`);
  if (!(pools.data || []).length) throw new Error("aucun pool GeckoTerminal");
  let list = [], fdv = null;
  // Try the top pools until one exposes OHLCV (some bonding-curve pools don't).
  for (const pool of pools.data.slice(0, 4)) {
    fdv = fdv ?? (pool.attributes?.fdv_usd != null ? Number(pool.attributes.fdv_usd) : null);
    await sleep(2100);
    const ohlcv = await gtJson(`${GT}/networks/${chain}/pools/${pool.attributes.address}/ohlcv/day?limit=1000`);
    list = ohlcv.data?.attributes?.ohlcv_list || [];
    if (list.length) break;
  }
  const series = list
    .map(([ts, , , , close, vol]) => ({ date: new Date(ts * 1000).toISOString().slice(0, 10), price: close, volume: vol }))
    .filter((p) => p.price != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (series.length && fdv != null) series[series.length - 1].marketCap = fdv; // current mcap on the latest point
  return { series, fdv };
}
