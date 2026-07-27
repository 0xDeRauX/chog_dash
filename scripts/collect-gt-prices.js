// Daily price/volume history for config tokens flagged `gtPrice` (no CoinGecko
// listing) via GeckoTerminal OHLCV → data/raw/prices-history/<SYM>.json. Keyless,
// re-runnable (includes today), so it's both backfill and daily refresh.
// Usage: npm run collect:gt-prices [SYM1,SYM2]
import fs from "fs";
import path from "path";
import { ASSETS } from "../src/config.js";
import { fetchGtPriceHistory } from "../src/collectors/gt-price.js";

const only = process.argv[2] ? new Set(process.argv[2].split(",")) : null;
const targets = ASSETS.filter((a) => a.gtPrice && a.flow?.net && a.flow?.addr && (!only || only.has(a.symbol)));

const dir = path.resolve("data/raw/prices-history");
fs.mkdirSync(dir, { recursive: true });

for (const a of targets) {
  try {
    const { series, fdv } = await fetchGtPriceHistory(a.flow.net, a.flow.addr);
    if (!series.length) { console.error(`${a.symbol}: OHLCV vide`); continue; }
    fs.writeFileSync(path.join(dir, `${a.symbol}.json`), JSON.stringify({ symbol: a.symbol, series }, null, 2));
    console.log(`${a.symbol}: ${series.length}j (${series[0].date}→${series.at(-1).date}) · mcap $${fdv ? (fdv / 1e6).toFixed(1) + "M" : "?"}`);
  } catch (err) {
    console.error(`${a.symbol}: ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, 2100));
}
