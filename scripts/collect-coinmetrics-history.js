// Full free history (price, volume, market cap, holders, % en gain proxy) for
// every asset configured with a Coin Metrics community asset id.
// Usage: npm run collect:cm-history [SYM1,SYM2]
import { ASSETS } from "../src/config.js";
import { collectCoinmetricsHistory } from "../src/collectors/coinmetrics-history.js";

const only = process.argv[2] ? new Set(process.argv[2].split(",")) : null;
const targets = ASSETS.filter((a) => a.holders?.source === "coinmetrics" && a.holders?.cmAsset && (!only || only.has(a.symbol)));

if (!targets.length) console.log("Aucun actif Coin Metrics en config.");
for (const asset of targets) {
  try {
    const r = await collectCoinmetricsHistory(asset);
    console.log(`${asset.symbol}: prix ${r.priceDays}j (dès ${r.priceFrom}) · volume + market cap inclus`);
  } catch (err) {
    console.error(`${asset.symbol}: ${err.message}`);
  }
}
