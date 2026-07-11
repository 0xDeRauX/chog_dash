// Holder counts per token.
//   - "blockscout": one call to a chain's public Blockscout -> holder count.
//   - "thirdweb":   no free holder API on this chain (e.g. Monad), so we index
//                   ERC-20 Transfer events via thirdweb Insight, reconstruct
//                   balances, and count addresses with balance > 0. Incremental:
//                   the balance ledger + last block are persisted in a state
//                   file (data/holders-state/<sym>.json, gitignored, cached in
//                   CI), so only new transfers are fetched each run.
import fs from "fs";
import path from "path";
import { CONFIG } from "../config.js";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO = "0x0000000000000000000000000000000000000000";
const addrFromTopic = (t) => "0x" + t.slice(26).toLowerCase();
const STATE_DIR = path.resolve("data/holders-state");

// ---- Blockscout ---------------------------------------------------------
async function blockscoutHolders(cfg) {
  const res = await fetch(`${cfg.base}/api/v2/tokens/${cfg.contract}`, {
    headers: { "User-Agent": "chog-dash/1.0" },
  });
  if (!res.ok) throw new Error(`Blockscout HTTP ${res.status}`);
  const data = await res.json();
  const h = data.holders ?? data.holders_count;
  return h == null ? null : Number(h);
}

// ---- thirdweb Insight event indexer ------------------------------------
function loadState(symbol) {
  const file = path.join(STATE_DIR, `${symbol}.json`);
  if (!fs.existsSync(file)) return { lastBlock: 0, balances: new Map() };
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const balances = new Map();
  for (const [a, v] of Object.entries(raw.balances || {})) balances.set(a, BigInt(v));
  return { lastBlock: raw.lastBlock || 0, balances };
}
function saveState(symbol, lastBlock, balances) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const obj = { lastBlock, balances: {} };
  for (const [a, v] of balances) if (v !== 0n) obj.balances[a] = v.toString();
  fs.writeFileSync(path.join(STATE_DIR, `${symbol}.json`), JSON.stringify(obj));
}

async function thirdwebHolders(symbol, cfg) {
  if (!CONFIG.THIRDWEB_SECRET_KEY) throw new Error("Missing THIRDWEB_SECRET_KEY");
  const { lastBlock, balances } = loadState(symbol);

  // First run starts at the token's deployment-ish block (cfg.startBlock);
  // later runs resume strictly AFTER the last fully-processed block so already-
  // folded transfers aren't double-counted. gte must be > 0.
  let cursor = lastBlock > 0 ? lastBlock + 1 : (cfg.startBlock || 1);
  let headBlock = lastBlock;
  let seenBlock = -1;
  let seen = new Set();
  let calls = 0;
  const LIMIT = 1000, MAX_CALLS = 5000;

  while (calls < MAX_CALLS) {
    const url = new URL(`https://${cfg.chainId}.insight.thirdweb.com/v1/events/${cfg.contract}`);
    url.searchParams.set("filter_topic_0", TRANSFER_TOPIC);
    url.searchParams.set("filter_block_number_gte", String(cursor));
    url.searchParams.set("sort_order", "asc");
    url.searchParams.set("limit", String(LIMIT));
    url.searchParams.set("page", "0");
    const res = await fetch(url, { headers: { "x-secret-key": CONFIG.THIRDWEB_SECRET_KEY } });
    calls++;
    if (!res.ok) throw new Error(`thirdweb HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const { data = [] } = await res.json();
    if (!data.length) break;

    let processed = 0;
    for (const e of data) {
      const bn = e.block_number;
      if (bn > seenBlock) { seenBlock = bn; seen = new Set(); }
      const key = e.transaction_hash + ":" + e.log_index;
      if (seen.has(key)) continue; // dedup the re-fetched boundary block (same run)
      seen.add(key);
      const from = addrFromTopic(e.topics[1]);
      const to = addrFromTopic(e.topics[2]);
      const v = BigInt(e.data && e.data !== "0x" ? e.data : "0x0");
      if (from !== ZERO) balances.set(from, (balances.get(from) || 0n) - v);
      if (to !== ZERO) balances.set(to, (balances.get(to) || 0n) + v);
      headBlock = bn;
      processed++;
    }
    if (data.length < LIMIT) break;
    cursor = seenBlock === cursor && processed === 0 ? cursor + 1 : seenBlock;
  }

  let holders = 0;
  for (const b of balances.values()) if (b > 0n) holders++;
  saveState(symbol, headBlock, balances);
  return { holders, calls, lastBlock: headBlock };
}

// ---- public -------------------------------------------------------------
export async function collectHoldersForAsset(asset) {
  const cfg = asset.holders;
  if (!cfg) return null;
  if (cfg.source === "blockscout") {
    return { symbol: asset.symbol, holders: await blockscoutHolders(cfg) };
  }
  if (cfg.source === "thirdweb") {
    const { holders, calls } = await thirdwebHolders(asset.symbol, cfg);
    return { symbol: asset.symbol, holders, calls };
  }
  return null;
}

export async function collectAllHolders(assets) {
  const results = [];
  for (const asset of assets) {
    if (!asset.holders) continue;
    try {
      const r = await collectHoldersForAsset(asset);
      if (r) results.push(r);
    } catch (err) {
      console.error(`Skipped ${asset.symbol}: ${err.message}`);
    }
  }
  return results;
}
