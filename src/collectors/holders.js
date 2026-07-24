// Holder counts per token.
//   - "blockscout": one call to a chain's public Blockscout -> holder count.
//   - "thirdweb":   no free holder API on this chain (e.g. Monad), so we index
//                   ERC-20 Transfer events via thirdweb Insight, reconstruct
//                   balances, and count addresses with balance > 0. Incremental:
//                   the balance ledger + last block are persisted in a state
//                   file (data/holders-state/<sym>.json, gitignored, cached in
//                   CI), so only new transfers are fetched each run.
//   - "solana":     no free holder API for Solana either, so we count on-chain
//                   ourselves via a public RPC getProgramAccounts (all SPL token
//                   accounts of the mint), streamed, counting balance > 0.
//                   Keyless and stateless (full re-count each run).
import fs from "fs";
import path from "path";
import { CONFIG } from "../config.js";
import { hyperRpcAvailable, transferLogs } from "../lib/monadLogs.js";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO = "0x0000000000000000000000000000000000000000";
const addrFromTopic = (t) => "0x" + t.slice(26).toLowerCase();
const STATE_DIR = path.resolve("data/holders-state");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- USD tiers ($-value buckets of holders) ------------------------------
// Only computable where we see every balance ourselves (thirdweb ledger,
// Solana scan). Thresholds in USD; converted to raw token units via the day's
// price. tiers = { lt50, t50_500, t500_5k, t5k_50k, gt50k }.
const TIER_USD = [50, 500, 5000, 50000];
const TIER_KEYS = ["lt50", "t50_500", "t500_5k", "t5k_50k", "gt50k"];
function tierThresholdsRaw(priceUsd, decimals) {
  if (!priceUsd || priceUsd <= 0) return null;
  // usd → tokens → raw units, at µ-token precision to stay exact in BigInt.
  return TIER_USD.map((usd) =>
    (BigInt(Math.round((usd / priceUsd) * 1e6)) * 10n ** BigInt(decimals)) / 1000000n);
}
function newTierCounts() { return [0, 0, 0, 0, 0]; }
function tierBucket(raw, thr) {
  if (raw < thr[0]) return 0;
  if (raw < thr[1]) return 1;
  if (raw < thr[2]) return 2;
  if (raw < thr[3]) return 3;
  return 4;
}
const tiersObj = (counts) => Object.fromEntries(TIER_KEYS.map((k, i) => [k, counts[i]]));

// ---- Solana (keyless on-chain count) -----------------------------------
const SPL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SPL_TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
// A custom SOL_RPC (env) is tried first; then the public mainnet-beta endpoint —
// the only *keyless* RPC that actually serves these heavy getProgramAccounts
// (drpc/ankr/publicnode/onfinality all reject or 410 them). mainnet-beta rate-
// limits (HTTP 413/429) after a few big calls, so we retry with long backoff and
// pace successive tokens. Set SOL_RPC to a free dedicated RPC (e.g. Helius) to
// make this rock-solid.
const SOL_RPCS = [
  ...(CONFIG.SOL_RPC ? [CONFIG.SOL_RPC] : []),
  "https://api.mainnet-beta.solana.com",
];
const SOL_ATTEMPTS = 6;

// Stream the RPC response and count accounts with a non-zero u64 amount. The
// response can exceed 512MB (e.g. BONK), past V8's max string length, so we
// never hold it whole: scan chunks for each account's sliced data and drop the
// processed prefix. dataSlice(offset 64, length 8) => only the amount field.
async function streamNonZero(res, thrRaw = null) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const MARK = '"data":["';
  let buf = "", holders = 0;
  const counts = newTierCounts();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let last = 0, idx;
    while ((idx = buf.indexOf(MARK, last)) !== -1) {
      const start = idx + MARK.length, end = buf.indexOf('"', start);
      if (end === -1) break; // account split across chunks: wait for more
      const b64 = buf.slice(start, end);
      if (b64) {
        const b = Buffer.from(b64, "base64");
        if (b.length >= 8) {
          const v = b.readBigUInt64LE(0);
          if (v > 0n) {
            holders++;
            if (thrRaw) counts[tierBucket(v, thrRaw)]++;
          }
        }
      }
      last = end + 1;
    }
    buf = buf.slice(last);
  }
  return { holders, tiers: thrRaw ? tiersObj(counts) : null };
}

async function solanaHolders(cfg, priceUsd) {
  const program = cfg.program === "token-2022" ? SPL_TOKEN_2022 : SPL_TOKEN;
  const filters = [{ memcmp: { offset: 0, bytes: cfg.mint } }];
  // Classic token accounts are exactly 165B; Token-2022 vary (extensions), so
  // only the mint memcmp is safe there.
  if (program === SPL_TOKEN) filters.unshift({ dataSize: 165 });
  const body = JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "getProgramAccounts",
    params: [program, { encoding: "base64", dataSlice: { offset: 64, length: 8 }, filters }],
  });
  // The scan reads every balance anyway — bucketing by $ value is free.
  const thrRaw = cfg.decimals != null ? tierThresholdsRaw(priceUsd, cfg.decimals) : null;
  let lastErr;
  for (let attempt = 0; attempt < SOL_ATTEMPTS; attempt++) {
    const rpc = SOL_RPCS[attempt % SOL_RPCS.length];
    try {
      const res = await fetch(rpc, {
        method: "POST", headers: { "Content-Type": "application/json" }, body,
      });
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status} @ ${rpc}`); await sleep(8000 * (attempt + 1)); continue; }
      const { holders, tiers } = await streamNonZero(res, thrRaw);
      // These tokens always have holders; a 0 means the RPC returned an error
      // body or truncated (some providers cap large getProgramAccounts) — retry
      // rather than record a bogus 0.
      if (holders === 0) { lastErr = new Error(`empty result @ ${rpc}`); await sleep(8000 * (attempt + 1)); continue; }
      return { holders, tiers };
    } catch (e) {
      lastErr = e; await sleep(8000 * (attempt + 1));
    }
  }
  throw lastErr || new Error("solana RPC failed");
}

// ---- Native-coin holder counts (address counts per chain) --------------
// "Holders" of a native coin = addresses/accounts with a non-zero balance, as
// published by each ecosystem. All keyless & free.

// Coinmetrics community API: AdrBalCnt = count of addresses holding the asset.
// Covers BTC/ETH/XRP (and more) on the free tier.
async function coinmetricsHolders(cfg) {
  const url = new URL("https://community-api.coinmetrics.io/v4/timeseries/asset-metrics");
  url.searchParams.set("assets", cfg.cmAsset);
  url.searchParams.set("metrics", "AdrBalCnt");
  url.searchParams.set("frequency", "1d");
  url.searchParams.set("start_time", new Date(Date.now() - 12 * 864e5).toISOString().slice(0, 10));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Coinmetrics HTTP ${res.status} for ${cfg.cmAsset}`);
  const { data = [] } = await res.json();
  const last = data.filter((d) => d.AdrBalCnt != null).at(-1);
  return last ? Number(last.AdrBalCnt) : null;
}

// Cosmos SDK chains expose the total account count via the auth module's
// pagination total (public LCD/REST endpoints, keyless).
async function cosmosHolders(cfg) {
  const bases = cfg.lcds || [cfg.lcd];
  let lastErr;
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/cosmos/auth/v1beta1/accounts?pagination.limit=1&pagination.count_total=true`);
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      const j = await res.json();
      const t = Number(j.pagination?.total);
      if (t) return t;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("cosmos LCD failed");
}

// Hyperliquid: hypurrscan's /holders/<token> payload embeds the full holder map,
// but holdersCount sits at the very start — stream just enough to read it, then
// stop (the map itself can be tens of MB).
async function hypurrscanHolders(cfg) {
  const res = await fetch(`https://api.hypurrscan.io/holders/${cfg.token}`);
  if (!res.ok) throw new Error(`hypurrscan HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (let i = 0; i < 60; i++) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const m = /"holdersCount":\s*(\d+)/.exec(buf);
    if (m) { reader.cancel(); return Number(m[1]); }
    if (buf.length > 2e6) break;
  }
  throw new Error("hypurrscan: holdersCount not found");
}

// taostats (Bittensor/TAO): total account count = holders. Needs a free key.
async function taostatsHolders() {
  if (!CONFIG.TAOSTATS_API_KEY) throw new Error("Missing TAOSTATS_API_KEY");
  const res = await fetch("https://api.taostats.io/api/account/latest/v1?limit=1", {
    headers: { Authorization: CONFIG.TAOSTATS_API_KEY },
  });
  if (!res.ok) throw new Error(`taostats HTTP ${res.status}`);
  const j = await res.json();
  return Number(j.pagination?.total_items) || null;
}

// Blockvision Sui: coin/detail carries the native SUI holder count — but only
// when given the fully-normalized 64-hex coinType. Needs a free key.
async function blockvisionSuiHolders(cfg) {
  if (!CONFIG.BLOCKVISION_SUI_KEY) throw new Error("Missing blockvision_api_key_sui");
  const url = `https://api.blockvision.org/v2/sui/coin/detail?coinType=${encodeURIComponent(cfg.coinType)}`;
  const res = await fetch(url, { headers: { "x-api-key": CONFIG.BLOCKVISION_SUI_KEY } });
  if (!res.ok) throw new Error(`Blockvision Sui HTTP ${res.status}`);
  const j = await res.json();
  return Number(j.result?.holders) || null;
}

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

async function thirdwebHolders(symbol, cfg, priceUsd) {
  if (!hyperRpcAvailable() && !CONFIG.THIRDWEB_SECRET_KEY) throw new Error("Missing HYPERSYNC_API_KEY / THIRDWEB_SECRET_KEY");
  const { lastBlock, balances } = loadState(symbol);
  // Snapshot balances before applying this run's transfers, so we can diff the
  // day's flows (who accumulated / distributed / entered / left the holder set).
  const before = new Map(balances);

  // First run starts at the token's deployment-ish block (cfg.startBlock);
  // later runs resume strictly AFTER the last fully-processed block so already-
  // folded transfers aren't double-counted. gte must be > 0.
  let cursor = lastBlock > 0 ? lastBlock + 1 : (cfg.startBlock || 1);
  let headBlock = lastBlock;
  let seenBlock = -1;
  let seen = new Set();
  let calls = 0;
  if (hyperRpcAvailable()) {
    // Live source (Envio HyperRPC) — thirdweb Insight froze at ~75.28M on
    // Monad and would silently serve a 2-month-old ledger.
    for await (const { logs } of transferLogs(cfg.contract, TRANSFER_TOPIC, cursor, cfg.hyperchain || "monad")) {
      calls++;
      for (const e of logs) {
        const from = addrFromTopic(e.topics[1]);
        const to = addrFromTopic(e.topics[2]);
        const v = BigInt(e.data && e.data !== "0x" ? e.data : "0x0");
        if (from !== ZERO) balances.set(from, (balances.get(from) || 0n) - v);
        if (to !== ZERO) balances.set(to, (balances.get(to) || 0n) + v);
        headBlock = Math.max(headBlock, e.block_number);
      }
    }
  } else {
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
  }

  let holders = 0;
  for (const b of balances.values()) if (b > 0n) holders++;

  // $-value tiers from the full ledger (needs today's price + decimals).
  let tiers = null;
  const thrRaw = cfg.decimals != null ? tierThresholdsRaw(priceUsd, cfg.decimals) : null;
  if (thrRaw) {
    const counts = newTierCounts();
    for (const b of balances.values()) if (b > 0n) counts[tierBucket(b, thrRaw)]++;
    tiers = tiersObj(counts);
  }

  // Flows: compare each address's balance to its pre-run value.
  let accumulating = 0, distributing = 0, newHolders = 0, churned = 0;
  const addrs = new Set([...before.keys(), ...balances.keys()]);
  for (const a of addrs) {
    const o = before.get(a) || 0n, nw = balances.get(a) || 0n;
    if (nw === o) continue;
    if (o <= 0n && nw > 0n) newHolders++;
    else if (o > 0n && nw <= 0n) churned++;
    else if (nw > o) accumulating++;
    else distributing++;
  }
  const flows = { accumulating, distributing, newHolders, churned };

  saveState(symbol, headBlock, balances);
  return { holders, calls, lastBlock: headBlock, flows, tiers };
}

// ---- public -------------------------------------------------------------
export async function collectHoldersForAsset(asset, priceUsd) {
  const cfg = asset.holders;
  if (!cfg) return null;
  if (cfg.source === "blockscout") {
    return { symbol: asset.symbol, holders: await blockscoutHolders(cfg) };
  }
  if (cfg.source === "thirdweb") {
    const { holders, calls, flows, tiers } = await thirdwebHolders(asset.symbol, cfg, priceUsd);
    return { symbol: asset.symbol, holders, calls, flows, tiers };
  }
  if (cfg.source === "solana") {
    const { holders, tiers } = await solanaHolders(cfg, priceUsd);
    return { symbol: asset.symbol, holders, tiers };
  }
  if (cfg.source === "coinmetrics") {
    return { symbol: asset.symbol, holders: await coinmetricsHolders(cfg) };
  }
  if (cfg.source === "cosmos") {
    return { symbol: asset.symbol, holders: await cosmosHolders(cfg) };
  }
  if (cfg.source === "hypurrscan") {
    return { symbol: asset.symbol, holders: await hypurrscanHolders(cfg) };
  }
  if (cfg.source === "taostats") {
    return { symbol: asset.symbol, holders: await taostatsHolders() };
  }
  if (cfg.source === "blockvision-sui") {
    return { symbol: asset.symbol, holders: await blockvisionSuiHolders(cfg) };
  }
  return null;
}

export async function collectAllHolders(assets, prices = {}) {
  const results = [];
  let prevSolana = false;
  for (const asset of assets) {
    if (!asset.holders) continue;
    // Pace consecutive heavy Solana getProgramAccounts so the public RPC doesn't
    // rate-limit us (a fresh run after BONK's ~500MB pull otherwise 429s).
    if (prevSolana && asset.holders.source === "solana") await sleep(12000);
    try {
      const r = await collectHoldersForAsset(asset, prices[asset.symbol]);
      if (r) results.push(r);
    } catch (err) {
      console.error(`Skipped ${asset.symbol}: ${err.message}`);
    }
    prevSolana = asset.holders.source === "solana";
  }
  return results;
}
