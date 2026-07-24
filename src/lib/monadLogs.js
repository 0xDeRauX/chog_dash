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

async function rpc(body, chain = "monad", tries = 4) {
  for (let t = 1; ; t++) {
    await paced(); // pacing is GLOBAL (rate limit is per token, across chains)
    const res = await fetch(rpcUrl(chain), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
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
// fetched in ONE batched request (HyperRPC supports JSON-RPC batching).
export async function blockDater(minBlock, maxBlock, chain = "monad") {
  const anchors = [];
  const STEP = 400_000;
  for (let b = minBlock; b <= maxBlock; b += STEP) anchors.push(b);
  if (anchors.at(-1) !== maxBlock) anchors.push(maxBlock);
  const batch = anchors.map((b, i) => ({ jsonrpc: "2.0", id: i, method: "eth_getBlockByNumber", params: ["0x" + b.toString(16), false] }));
  const out = await rpc(batch, chain);
  const pts = (Array.isArray(out) ? out : [out])
    .filter((r) => r.result)
    .map((r) => [parseInt(r.result.number, 16), parseInt(r.result.timestamp, 16)])
    .sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) throw new Error("blockDater: not enough anchors");
  return (bn) => {
    let i = pts.findIndex(([b]) => b >= bn);
    if (i <= 0) i = Math.max(1, Math.min(pts.length - 1, i === 0 ? 1 : pts.length - 1));
    const [b0, t0] = pts[i - 1], [b1, t1] = pts[i];
    const ts = t0 + ((bn - b0) * (t1 - t0)) / Math.max(1, b1 - b0);
    return new Date(ts * 1000).toISOString().slice(0, 10);
  };
}

// Streams Transfer logs for a contract from `fromBlock` to the chain head.
// Yields normalized events shaped like thirdweb Insight's (block_number,
// topics[], data, transaction_hash, log_index) in ascending block order.
export async function* transferLogs(contract, topic0, fromBlock, chain = "monad") {
  const head = await headBlock(chain);
  const getLogs = async (start, end) => rpc({
    jsonrpc: "2.0", id: 1, method: "eth_getLogs",
    params: [{ address: contract, topics: [topic0], fromBlock: "0x" + start.toString(16), toBlock: "0x" + end.toString(16) }],
  }, chain);
  // dense periods (token launch) exceed the 50K-logs-per-response cap →
  // bisect the window until it fits
  async function* fetchRange(start, end) {
    const r = await getLogs(start, end);
    if (r.error) {
      const msg = JSON.stringify(r.error);
      if ((r.error.code === -32005 || /more than \d+ logs/i.test(msg)) && end > start) {
        const mid = Math.floor((start + end) / 2);
        yield* fetchRange(start, mid);
        yield* fetchRange(mid + 1, end);
        return;
      }
      throw new Error(`eth_getLogs: ${msg.slice(0, 120)}`);
    }
    yield (r.result || []).map((l) => ({
      block_number: parseInt(l.blockNumber, 16),
      log_index: parseInt(l.logIndex, 16),
      transaction_hash: l.transactionHash,
      topics: l.topics,
      data: l.data,
    })).sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
  }
  for (let start = fromBlock; start <= head; start += SPAN + 1) {
    const end = Math.min(start + SPAN, head);
    for await (const logs of fetchRange(start, end)) yield { logs, upTo: end, head };
  }
}
