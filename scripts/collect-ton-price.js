// FULL on-chain price history for TON jettons via tonapi rate chart →
// data/raw/prices-history/<SYM>.json. Keyless, re-runnable (includes today), so
// it's both backfill and daily refresh. Beats CoinGecko's 365d / GeckoTerminal's
// 180d free caps. Usage: npm run collect:ton-price [SYM1,SYM2]
import fs from "fs";
import path from "path";
import { ASSETS } from "../src/config.js";
import { fetchTonPriceHistory } from "../src/collectors/ton-price.js";

const only = process.argv[2] ? new Set(process.argv[2].split(",")) : null;
const targets = ASSETS.filter((a) => a.chain === "ton" && a.holders?.source === "tonapi" && (!only || only.has(a.symbol)));

const dir = path.resolve("data/raw/prices-history");
fs.mkdirSync(dir, { recursive: true });

for (const a of targets) {
  try {
    const { series, mcap } = await fetchTonPriceHistory(a.holders.address, a.holders.decimals);
    if (!series.length) { console.error(`${a.symbol}: aucun point de prix`); continue; }
    fs.writeFileSync(path.join(dir, `${a.symbol}.json`), JSON.stringify({ symbol: a.symbol, series }, null, 2));
    console.log(`${a.symbol}: ${series.length}j (${series[0].date}→${series.at(-1).date}) · mcap $${mcap ? (mcap / 1e6).toFixed(1) + "M" : "?"}`);
  } catch (err) {
    console.error(`${a.symbol}: ${err.message}`);
  }
}
