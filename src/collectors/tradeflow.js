// Buy vs sell pressure per asset — 100% ON-CHAIN, no exchange (CEX) data.
// Source: GeckoTerminal, aggregating the 24h buy/sell TRANSACTION COUNTS across
// ALL of a token's DEX pools (keyless). This is a daily snapshot that
// accumulates from the first collection — the on-chain trade split has no free
// historical feed, so there is no backfill (unlike prices).
//
// Only assets with an on-chain DEX presence get a flow (config `flow:{net,addr}`):
// the memes, plus ETH (WETH pools) and SOL (wSOL pools) whose DeFi trading is
// meaningful. Assets dominated by CEX with negligible on-chain volume (BTC, XRP,
// TAO…) intentionally have NO buy/sell — an on-chain figure there would reflect
// <1% of real trading, so an honest "—" beats a misleading number.
import fs from "fs";
import path from "path";

const todayUTCstr = () => new Date().toISOString().slice(0, 10);
const GT = "https://api.geckoterminal.com/api/v2";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gtJson(url, tries = 4) {
  for (let i = 1; ; i++) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.ok) return res.json();
    if (i >= tries) throw new Error(`GT HTTP ${res.status}`);
    await sleep(res.status === 429 ? 20000 * i : 3000 * i);
  }
}

// Aggregate 24h buy/sell tx counts + volume across every DEX pool of the token.
// Returns { buyTx, sellTx, volUsd, pools } or null if the token has no pools.
async function gtFlow(net, addr) {
  const j = await gtJson(`${GT}/networks/${net}/tokens/${addr}/pools?page=1`);
  const pools = j.data || [];
  if (!pools.length) return null;
  let buyTx = 0, sellTx = 0, volUsd = 0;
  for (const p of pools) {
    const a = p.attributes || {};
    const tx = (a.transactions || {}).h24 || {};
    buyTx += tx.buys || 0;
    sellTx += tx.sells || 0;
    volUsd += Number((a.volume_usd || {}).h24) || 0;
  }
  if (buyTx + sellTx === 0) return null;
  return { buyTx, sellTx, volUsd, pools: pools.length };
}

// One trades page (~last 300) of the deepest pool gives an EXACT $ buy/sell
// split for low-activity tokens (covers a full day). Bonus over tx counts; only
// used when 300 trades still span ≥24h. Best-effort.
async function gtTradesSplitUsd(net, addr) {
  try {
    const jp = await gtJson(`${GT}/networks/${net}/tokens/${addr}/pools?page=1`);
    const pool = jp.data?.[0]?.attributes?.address;
    if (!pool) return null;
    await sleep(2100);
    const jt = await gtJson(`${GT}/networks/${net}/pools/${pool}/trades`);
    const trades = jt.data || [];
    if (!trades.length || trades.length >= 300) return null; // window truncated
    const cutoff = Date.now() - 864e5;
    let buyUsd = 0, sellUsd = 0;
    for (const t of trades) {
      const a = t.attributes || {};
      if (new Date(a.block_timestamp).getTime() < cutoff) continue;
      const v = Number(a.volume_in_usd) || 0;
      if (a.kind === "buy") buyUsd += v; else sellUsd += v;
    }
    return buyUsd + sellUsd > 0 ? { buyUsd, sellUsd } : null;
  } catch { return null; }
}

// Daily collection: one on-chain snapshot per flow-configured asset. Upserts
// dedupe, so re-running the same day just refreshes it.
export async function collectTradeflow(assets) {
  const results = [];
  for (const asset of assets) {
    if (!asset.flow) continue; // no on-chain DEX presence → no buy/sell (honest)
    try {
      const snap = await gtFlow(asset.flow.net, asset.flow.addr);
      if (!snap) { console.error(`No pools for ${asset.symbol}`); continue; }
      await sleep(2100);
      // Low-activity tokens also get an exact $ split (better than tx counts).
      const usd = await gtTradesSplitUsd(asset.flow.net, asset.flow.addr);
      results.push({ symbol: asset.symbol, buyTx: snap.buyTx, sellTx: snap.sellTx, volUsd: snap.volUsd, ...(usd || {}) });
      console.log(`${asset.symbol}: ${snap.pools} pools | ${snap.buyTx}/${snap.sellTx} tx (${(100 * snap.buyTx / (snap.buyTx + snap.sellTx)).toFixed(0)}% achat)${usd ? " | $ split exact" : ""}`);
    } catch (err) {
      console.error(`Skipped ${asset.symbol}: ${err.message}`);
    }
    await sleep(2100); // GT free tier ~30/min
  }
  return results;
}

// No historical backfill for on-chain buy/sell (GeckoTerminal exposes only the
// last ~300 trades, not a daily split history). Kept as a no-op so the daily
// script's call site stays unchanged.
export async function backfillTradeflow() {
  return [];
}
