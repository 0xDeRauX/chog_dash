// GeckoTerminal daily price/volume history for config tokens — the FULL history
// since the pool's creation, which beats CoinGecko's free 365-day cap. We pick
// the OLDEST pool with liquidity (longest history) and paginate OHLCV backwards
// (before_timestamp) past the 1000-candle page limit. Keyless; doubles as the
// daily refresh (the latest candle is today). Returns { series, fdv } where fdv
// tags the latest point as market cap.
import { gtJson } from "./chainradar.js";

const GT = "https://api.geckoterminal.com/api/v2";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function poolOhlcv(chain, pool) {
  const byDate = new Map(); // date -> {price, volume}  (dedupe across pages)
  let before = null;
  for (let page = 0; page < 8; page++) { // up to ~8000 daily candles (>20y)
    await sleep(2200);
    const q = `?limit=1000&currency=usd${before != null ? `&before_timestamp=${before}` : ""}`;
    const ohlcv = await gtJson(`${GT}/networks/${chain}/pools/${pool}/ohlcv/day${q}`);
    const list = ohlcv.data?.attributes?.ohlcv_list || [];
    if (!list.length) break;
    for (const [ts, , , , close, vol] of list) {
      if (close == null) continue;
      byDate.set(new Date(ts * 1000).toISOString().slice(0, 10), { price: close, volume: vol });
    }
    if (list.length < 1000) break;
    before = Math.min(...list.map((x) => x[0])); // earliest ts → next older page
  }
  return [...byDate.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchGtPriceHistory(chain, tokenAddr) {
  const pools = await gtJson(`${GT}/networks/${chain}/tokens/${tokenAddr}/pools`);
  const cand = (pools.data || []).filter((p) => Number(p.attributes?.reserve_in_usd) > 300);
  if (!cand.length) throw new Error("aucun pool GeckoTerminal avec liquidité");
  // GT returns pools by liquidity. Sample the top few and keep the LONGEST OHLCV
  // (earliest first candle) — the main pool usually has the full history, but an
  // old low-liq pool can be sparse/dead, so pick by actual coverage, not age.
  const byLiq = cand.sort((a, b) => Number(b.attributes.reserve_in_usd) - Number(a.attributes.reserve_in_usd));
  const fdv = byLiq.map((p) => p.attributes?.fdv_usd).find((v) => v != null);

  let series = [];
  for (const pool of byLiq.slice(0, 4)) {
    const s = await poolOhlcv(chain, pool.attributes.address);
    if (s.length > series.length) series = s; // longest coverage wins
  }
  if (series.length && fdv != null) series[series.length - 1].marketCap = Number(fdv);
  return { series, fdv: fdv != null ? Number(fdv) : null };
}
