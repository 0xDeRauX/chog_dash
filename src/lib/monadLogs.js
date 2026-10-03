// Monad Transfer-log source via Envio HyperRPC — the replacement for thirdweb
// Insight, which froze at block ~75.28M (2026-05-17) while the chain moved on.
// HyperRPC serves eth_getLogs over ~1M-block spans, so a 13M-block gap closes
// in ~14 calls. Free tier is 5 req/min → hard 13s pacing between calls.
// eth_getLogs carries no timestamps: block dates come from anchor blocks
// (batched eth_getBlockByNumber) interpolated linearly — Monad's block time is
// steady enough (~0.55s) that daily attribution is off by minutes at worst.
import { CONFIG } from "../config.js";

const SPAN = 1_000_000;
const PACE_MS = 13_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
async function paced() {
  const wait = lastCall + PACE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}

// HyperRPC endpoints, one per chain (same free token covers eth/monad/base…).
const rpcUrl = (chain) => `https://${chain}.rpc.hypersync.xyz/${CONFIG.HYPERSYNC_API_KEY}`;

async function rpc(body, chain = "monad", tries = 6) {
  for (let t = 1; ; t++) {
    await paced(); // pacing is GLOBAL (rate limit is per token, across chains)
    let res;
    try {
      res = await fetch(rpcUrl(chain), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) return await res.json();
    } catch (err) {
      // network drop / reset mid-body ("fetch failed") — retry like a 5xx
      if (t >= tries) throw new Error(`HyperRPC ${err.message}`);
      await sleep(4_000 * t);
      continue;
    }
    if (t >= tries) throw new Error(`HyperRPC HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
    await sleep(res.status === 429 ? 20_000 : 4_000 * t);
  }
}

export const hyperRpcAvailable = () => !!CONFIG.HYPERSYNC_API_KEY;

export async function headBlock(chain = "monad") {
  const r = await rpc({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }, chain);
  return parseInt(r.result, 16);
}

// blockNumber -> "YYYY-MM-DD", by linear interpolation between anchor blocks
// fetched in batched requests (HyperRPC supports JSON-RPC batching). Anchor
// spacing per chain keeps the interpolation error well under a day: Monad and
// Base tick steadily; Ethereum loses ~1% of slots at random; Robinhood (an
// Arbitrum Orbit chain) produces blocks on demand, so it needs dense anchors.
const ANCHOR_STEP = { monad: 400_000, base: 400_000, eth: 50_000, robinhood: 100_000 };
const ANCHORS_PER_CALL = 100;
export async function blockDater(minBlock, maxBlock, chain = "monad") {
  const anchors = [];
  const STEP = ANCHOR_STEP[chain] ?? 400_000;
  for (let b = minBlock; b <= maxBlock; b += STEP) anchors.push(b);
  if (anchors.at(-1) !== maxBlock) anchors.push(maxBlock);
  const pts = [];
  for (let i = 0; i < anchors.length; i += ANCHORS_PER_CALL) {
    const batch = anchors.slice(i, i + ANCHORS_PER_CALL)
      .map((b, j) => ({ jsonrpc: "2.0", id: j, method: "eth_getBlockByNumber", params: ["0x" + b.toString(16), false] }));
    const out = await rpc(batch, chain);
    for (const r of Array.isArray(out) ? out : [out]) {
      if (r.result) pts.push([parseInt(r.result.number, 16), parseInt(r.result.timestamp, 16)]);
    }
  }
  pts.sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) throw new Error("blockDater: not enough anchors");
  return (bn) => {
    let i = pts.findIndex(([b]) => b >= bn);
    if (i <= 0) i = Math.max(1, Math.min(pts.length - 1, i === 0 ? 1 : pts.length - 1));
    const [b0, t0] = pts[i - 1], [b1, t1] = pts[i];
    const ts = t0 + ((bn - b0) * (t1 - t0)) / Math.max(1, b1 - b0);
    return new Date(ts * 1000).toISOString().slice(0, 10);
  };
}

// Streams Transfer logs for a contract from `fromBlock` to `toBlock` (default:
// the chain head), as { logs, upTo, head } windows in ascending block order.
// Logs are normalized like thirdweb Insight's (block_number, topics[], data,
// transaction_hash, log_index). HyperRPC caps a response at 50K logs and its
// error names a range that fits ("this block range should work: [a, b]") — the
// window adapts to that hint instead of blind bisection, so a dense token
// (PEPE: ~1 log/block over 9M blocks) costs ~1 call per 50K logs.
export async function* transferLogs(contract, topic0, fromBlock, chain = "monad", toBlock = null) {
  const head = toBlock ?? await headBlock(chain);
  const getLogs = (start, end) => rpc({
    jsonrpc: "2.0", id: 1, method: "eth_getLogs",
    params: [{ address: contract, topics: [topic0], fromBlock: "0x" + start.toString(16), toBlock: "0x" + end.toString(16) }],
  }, chain);
  let start = fromBlock, span = SPAN;
  while (start <= head) {
    const end = Math.min(start + span - 1, head);
    const r = await getLogs(start, end);
    if (r.error) {
      const msg = JSON.stringify(r.error);
      const tooMany = r.error.code === -32005 || /more than \d+ logs/i.test(msg);
      // a server-side timeout on a wide window is also solved by narrowing it
      const timedOut = /timed out|timeout/i.test(msg);
      if ((!tooMany && !timedOut) || end <= start) throw new Error(`eth_getLogs: ${msg.slice(0, 160)}`);
      const hint = msg.match(/should work: \[0x([0-9a-f]+), 0x([0-9a-f]+)\]/i);
      const hintEnd = hint ? parseInt(hint[2], 16) : NaN;
      span = hintEnd >= start && hintEnd < end ? hintEnd - start + 1 : Math.max(1, Math.floor(span / 2));
      continue;
    }
    const logs = (r.result || []).map((l) => ({
      block_number: parseInt(l.blockNumber, 16),
      log_index: parseInt(l.logIndex, 16),
      transaction_hash: l.transactionHash,
      topics: l.topics,
      data: l.data,
    })).sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
    yield { logs, upTo: end, head };
    start = end + 1;
    // sparse window → widen again (bounded by SPAN); dense → keep the fitting size
    if (logs.length < 25_000) span = Math.min(SPAN, Math.ceil(span * 1.5));
  }
}
