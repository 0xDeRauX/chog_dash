// FULL price-history backfill via Dune (free, keyless once the API key is set).
// CoinGecko caps the daily series at 365 days; Dune's prices.usd has the whole
// history since a token's first market, so this extends the price charts back
// to each token's creation. It MERGES into data/raw/prices-history/<SYM>.json:
// dates already present (recent, from CoinGecko, carrying volume) are kept; only
// older dates are prepended (price only). One parameterised query, reused per
// token (aggregated daily → a few thousand datapoints, ~free on Dune).
//
// Usage: node scripts/backfill-prices-dune.js [SYM1,SYM2]   (default: all with a Dune-priceable address)
import fs from "fs";
import path from "path";
import { ASSETS } from "../src/config.js";
import { runQuery, duneAvailable } from "../src/lib/dune.js";

if (!duneAvailable()) { console.error("Missing DUNE_API_KEY"); process.exit(1); }

// Dune prices.usd keys addresses as varbinary. The address is a BOUND parameter
// (not injected) so one cached query per chain-decoder is reused for every
// token — injecting it would bake the first token's address into the shared
// query. Solana decodes base58; EVM decodes hex (0x stripped). One query per
// decoder ("solana" vs "evm").
const CHAIN_MAP = { solana: "solana", ethereum: "ethereum", base: "base" };
function addrParam(asset) {
  const a = asset.holders || {};
  const bc = CHAIN_MAP[asset.chain];
  if (!bc) return null;
  if (asset.chain === "solana" && a.mint) return { bc, decoder: "solana", addr: a.mint };
  const contract = a.contract || asset.flow?.addr;
  if (contract) return { bc, decoder: "evm", addr: contract.toLowerCase().replace(/^0x/, "") };
  return null;
}
const SQL = {
  solana: `SELECT date_trunc('day', minute) AS d, avg(price) AS price FROM prices.usd
           WHERE blockchain = '{{blockchain}}' AND contract_address = from_base58('{{addr}}') GROUP BY 1 ORDER BY 1`,
  evm: `SELECT date_trunc('day', minute) AS d, avg(price) AS price FROM prices.usd
        WHERE blockchain = '{{blockchain}}' AND contract_address = from_hex('{{addr}}') GROUP BY 1 ORDER BY 1`,
};

const only = process.argv[2] ? new Set(process.argv[2].split(",")) : null;
const dir = path.resolve("data/raw/prices-history");
fs.mkdirSync(dir, { recursive: true });

for (const asset of ASSETS) {
  if (only && !only.has(asset.symbol)) continue;
  const ac = addrParam(asset);
  if (!ac) continue;
  try {
    // cache key = decoder (one shared query per decoder); addr + blockchain are
    // bound parameters that vary per token.
    const r = await runQuery(`price_history_${ac.decoder}`, SQL[ac.decoder], { blockchain: ac.bc, addr: ac.addr }, { maxWaitMs: 180000 });
    const dune = r.rows.filter((x) => x.price != null).map((x) => ({ date: x.d.slice(0, 10), price: Number(x.price) }));
    if (!dune.length) { console.log(`${asset.symbol}: aucun prix Dune`); continue; }

    const file = path.join(dir, `${asset.symbol}.json`);
    let existing = [];
    try { existing = JSON.parse(fs.readFileSync(file, "utf8")).series || []; } catch { /* new */ }
    const byDate = new Map(existing.map((p) => [p.date, p]));   // keep CoinGecko (has volume)
    for (const p of dune) if (!byDate.has(p.date)) byDate.set(p.date, p); // add older dates
    const series = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    fs.writeFileSync(file, JSON.stringify({ symbol: asset.symbol, series }, null, 2));
    console.log(`${asset.symbol}: ${dune.length}j Dune (${dune[0].date}→${dune.at(-1).date}) · série totale ${series.length}j · ${r.datapoints} dp`);
  } catch (err) {
    console.error(`${asset.symbol}: ${err.message}`);
  }
}
