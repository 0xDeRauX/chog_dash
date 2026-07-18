// FREE backfill of daily price/volume history for radar tokens, from
// GeckoTerminal OHLCV (keyless, daily candles since pool creation, ~6 months
// max). Fills the gap that makes Divergence computable: once mentions are
// backfilled too (paid, via Admin), z(mentions) − z(prix) works immediately
// instead of waiting 40 days of daily snapshots.
// Writes data/raw/chainradar-history/<chain>_<addr>.json; the ingest fills
// ONLY missing dates (daily snapshots stay authoritative).
//
// Usage: node scripts/backfill-radar-prices.js [--only=chain:addr,...]
//        (default: every tracked token)
import fs from "fs";
import path from "path";
import { loadTracked } from "../src/collectors/chainradar.js";

const GT = "https://api.geckoterminal.com/api/v2";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const onlyArg = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
const targets = onlyArg
  ? onlyArg.toLowerCase().split(",").filter(Boolean).map((k) => {
      const [chain, address] = k.split(":");
      return { chain, address };
    })
  : loadTracked();
if (!targets.length) {
  console.error("Aucune cible (aucun token suivi; utiliser --only=chain:addr).");
  process.exit(1);
}

const outDir = path.resolve("data/raw/chainradar-history");
fs.mkdirSync(outDir, { recursive: true });

for (const t of targets) {
  try {
    const pools = await (await fetch(`${GT}/networks/${t.chain}/tokens/${t.address}/pools`, { headers: { accept: "application/json" } })).json();
    if (!(pools.data || []).length) { console.error(`${t.chain}:${t.address}: aucun pool GT`); continue; }
    // some pools (nad.fun bonding curves) have no OHLCV — try the next ones
    let list = [], symbol = null;
    for (const pool of pools.data.slice(0, 4)) {
      symbol = symbol || (pool.attributes.name || "").split(" / ")[0].trim().toUpperCase();
      await sleep(600);
      const ohlcv = await (await fetch(`${GT}/networks/${t.chain}/pools/${pool.attributes.address}/ohlcv/day?limit=1000`, { headers: { accept: "application/json" } })).json();
      list = ohlcv.data?.attributes?.ohlcv_list || [];
      if (list.length) break;
    }
    const series = list.map(([ts, , , , close, vol]) => ({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      price: close, vol,
    })).sort((a, b) => a.date.localeCompare(b.date));
    if (!series.length) { console.error(`${symbol}: OHLCV vide`); continue; }
    const file = path.join(outDir, `${t.chain}_${t.address}.json`);
    fs.writeFileSync(file, JSON.stringify({ chain: t.chain, address: t.address, symbol, series }, null, 2));
    console.log(`$${symbol} (${t.chain}): ${series.length} jours (${series[0].date} → ${series.at(-1).date})`);
    await sleep(600);
  } catch (err) {
    console.error(`${t.chain}:${t.address}: ${err.message}`);
  }
}
