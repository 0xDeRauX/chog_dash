// Holder PnL ledger (CHOG): replays every ERC-20 Transfer with the daily
// price to maintain an average-cost basis per wallet, and emits ONE aggregate
// row per day — % of holders in profit, unrealized-PnL tranches, realized $.
// Same incremental model as the holders ledger: full index once, then each
// run only folds the new blocks (state cached between CI runs; if the cache
// is lost the script transparently re-indexes from block 0).
//
// Honest approximations (documented in the UI help): acquisitions are valued
// at the DAY's close price (the event log has no trade price); wallet→wallet
// transfers that touch no pool inherit the sender's cost basis (no PnL
// realized); mints/airdrops cost $0. Pool/router addresses (DexScreener
// pairAddress list) are excluded from holder stats — they are venues, not
// holders.
import fs from "fs";
import path from "path";
import { CONFIG } from "../config.js";
import { hyperRpcAvailable, transferLogs, blockDater } from "../lib/monadLogs.js";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO = "0x0000000000000000000000000000000000000000";
const addrFromTopic = (t) => ("0x" + (t || "").slice(-40)).toLowerCase();

const STATE_DIR = path.resolve("data/pnl-state");
const stateFile = (sym) => path.join(STATE_DIR, `${sym}.json`);

function loadState(sym) {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(sym), "utf8"));
    return {
      lastBlock: s.lastBlock || 0,
      lastDate: s.lastDate || null,
      pools: new Set(s.pools || []),
      // wallets: addr -> [balanceRaw(BigInt str), costTotalUsd(number)]
      wallets: new Map(Object.entries(s.wallets || {}).map(([a, [b, c]]) => [a, [BigInt(b), c]])),
    };
  } catch {
    return { lastBlock: 0, lastDate: null, pools: new Set(), wallets: new Map() };
  }
}
function saveState(sym, st) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(stateFile(sym), JSON.stringify({
    lastBlock: st.lastBlock,
    lastDate: st.lastDate,
    pools: [...st.pools],
    wallets: Object.fromEntries([...st.wallets].map(([a, [b, c]]) => [a, [b.toString(), c]])),
  }));
}

// date -> USD price, from the raw price files (collectors run before ingest,
// so SQLite may not exist yet in CI).
function priceMap(sym) {
  const m = new Map();
  try {
    const hist = JSON.parse(fs.readFileSync(path.resolve(`data/raw/prices-history/${sym}.json`), "utf8"));
    for (const p of hist.series || []) if (p.price != null) m.set(p.date, p.price);
  } catch { /* no history file */ }
  const dir = path.resolve("data/raw/prices");
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        const r = (d.results || []).find((x) => x.symbol === sym);
        if (r?.priceUsd != null) m.set(d.date, r.priceUsd);
      } catch { /* skip broken file */ }
    }
  }
  return m;
}

// DEX pools/routers for the token (excluded from holder stats, and the side
// that makes a transfer a BUY or a SELL). Best-effort refresh each run.
async function fetchPools(contract) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${contract}`);
    if (!res.ok) return [];
    const { pairs = [] } = await res.json();
    return pairs.map((p) => (p.pairAddress || "").toLowerCase()).filter(Boolean);
  } catch { return []; }
}

const evDate = (e) => {
  const t = e.block_timestamp;
  if (t == null) return null;
  const ms = typeof t === "number" ? t * 1000 : Date.parse(t);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
};

export async function collectPnl(asset) {
  const cfg = asset.holders;
  if (cfg?.source !== "thirdweb") throw new Error(`${asset.symbol}: PnL needs the thirdweb ledger`);
  if (!CONFIG.THIRDWEB_SECRET_KEY) throw new Error("Missing THIRDWEB_SECRET_KEY");
  const dec = 10 ** (cfg.decimals ?? 18);
  const prices = priceMap(asset.symbol);
  if (!prices.size) throw new Error(`${asset.symbol}: no price data for cost basis`);
  const firstPriceDate = [...prices.keys()].sort()[0];
  const st = loadState(asset.symbol);
  for (const p of await fetchPools(cfg.contract)) st.pools.add(p);

  // Existing aggregate rows (committed raw) — replay appends, never rewrites.
  const rawFile = path.resolve(`data/raw/pnl/${asset.symbol}.json`);
  let series = [];
  try { series = JSON.parse(fs.readFileSync(rawFile, "utf8")).series || []; } catch { /* first run */ }
  const doneDates = new Set(series.map((r) => r.date));

  const priceAt = (d) => prices.get(d) ?? (d < firstPriceDate ? prices.get(firstPriceDate) : null);
  const today = new Date().toISOString().slice(0, 10);
  let realizedToday = 0, realizedBigToday = 0, curDate = st.lastDate;

  const flushDay = (d) => {
    // aggregate the wallet ledger as of end of day d
    if (!d || d >= today || doneDates.has(d)) { realizedToday = 0; realizedBigToday = 0; return; }
    const px = priceAt(d);
    if (px == null) { realizedToday = 0; realizedBigToday = 0; return; }
    let holders = 0, inProfit = 0, x10 = 0, x2 = 0, x1 = 0, l50 = 0, l50p = 0;
    for (const [addr, [bal, cost]] of st.wallets) {
      if (bal <= 0n || st.pools.has(addr)) continue;
      const tokens = Number(bal) / dec;
      if (tokens * px < 0.01) continue; // dust
      holders++;
      const avg = cost > 0 && tokens > 0 ? cost / tokens : 0;
      const ratio = avg > 0 ? px / avg : Infinity; // cost 0 (airdrop/mint) = pure gain
      if (ratio > 1) inProfit++;
      if (ratio >= 10) x10++;
      else if (ratio >= 2) x2++;
      else if (ratio > 1) x1++;
      else if (ratio >= 0.5) l50++;
      else l50p++;
    }
    series.push({
      date: d, holders, inProfit,
      pctInProfit: holders ? Number(((inProfit / holders) * 100).toFixed(2)) : null,
      x10, x2_10: x2, x1_2: x1, l0_50: l50, l50: l50p,
      realizedUsd: Math.round(realizedToday),
      realizedBigUsd: Math.round(realizedBigToday),
    });
    doneDates.add(d);
    realizedToday = 0; realizedBigToday = 0;
  };

  // ---- fetch new transfer events (buffered: the venue pre-pass needs the
  // whole batch before any state is mutated) --------------------------------
  // Primary source: Envio HyperRPC (live). Legacy fallback: thirdweb Insight
  // (frozen at block ~75.28M on Monad — kept only for keyless resilience).
  const batch = [];
  let cursor = st.lastBlock > 0 ? st.lastBlock + 1 : (cfg.startBlock || 1);
  let seenBlock = -1, seen = new Set(), calls = 0, events = 0;
  if (hyperRpcAvailable()) {
    let minBn = null, maxBn = null;
    const rawLogs = [];
    for await (const { logs } of transferLogs(cfg.contract, TRANSFER_TOPIC, cursor)) {
      calls++;
      for (const l of logs) {
        rawLogs.push(l);
        if (minBn == null || l.block_number < minBn) minBn = l.block_number;
        if (maxBn == null || l.block_number > maxBn) maxBn = l.block_number;
      }
    }
    if (rawLogs.length) {
      const dateOf = await blockDater(minBn, maxBn);
      for (const l of rawLogs) {
        batch.push([l.block_number, dateOf(l.block_number), addrFromTopic(l.topics[1]), addrFromTopic(l.topics[2]),
          BigInt(l.data && l.data !== "0x" ? l.data : "0x0")]);
        st.lastBlock = Math.max(st.lastBlock, l.block_number);
        events++;
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
    // Insight throws the occasional transient 500 on big scans — retry before
    // giving up (an aborted first index restarts from scratch otherwise).
    let res;
    for (let t = 1; ; t++) {
      res = await fetch(url, { headers: { "x-secret-key": CONFIG.THIRDWEB_SECRET_KEY } });
      calls++;
      if (res.ok) break;
      if (t >= 4) throw new Error(`thirdweb HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
      await new Promise((r) => setTimeout(r, 2000 * t));
    }
    const { data = [] } = await res.json();
    if (!data.length) break;

    let processed = 0;
    for (const e of data) {
      const bn = e.block_number;
      if (bn > seenBlock) { seenBlock = bn; seen = new Set(); }
      const key = e.transaction_hash + ":" + e.log_index;
      if (seen.has(key)) continue;
      seen.add(key);
      batch.push([bn, evDate(e), addrFromTopic(e.topics[1]), addrFromTopic(e.topics[2]),
        BigInt(e.data && e.data !== "0x" ? e.data : "0x0")]);
      st.lastBlock = Math.max(st.lastBlock, bn);
      processed++;
      events++;
    }
    if (data.length < LIMIT) break;
    cursor = seenBlock === cursor && processed === 0 ? cursor + 1 : seenBlock;
  }
  }

  // ---- venue auto-detection ------------------------------------------------
  // DexScreener only lists the POOLS; swaps also route through aggregators
  // (Monorail, nad.fun router…) that would otherwise look like P2P transfers
  // and swallow every realization. Signature of a venue: heavy traffic in the
  // batch and a near-zero final balance (pass-through). Detected addresses are
  // persisted in the state's pool set.
  {
    const inC = new Map(), outC = new Map(), net = new Map(), turn = new Map();
    for (const [, , from, to, v] of batch) {
      outC.set(from, (outC.get(from) || 0) + 1);
      inC.set(to, (inC.get(to) || 0) + 1);
      net.set(from, (net.get(from) || 0n) - v);
      net.set(to, (net.get(to) || 0n) + v);
      const nv = Number(v);
      turn.set(from, (turn.get(from) || 0) + nv);
      turn.set(to, (turn.get(to) || 0) + nv);
    }
    let detected = 0;
    for (const a of new Set([...inC.keys(), ...outC.keys()])) {
      if (a === ZERO || st.pools.has(a)) continue;
      const nin = inC.get(a) || 0, nout = outC.get(a) || 0;
      // venue = heavy BIDIRECTIONAL pass-through: an airdrop/claim distributor
      // (1 mint in, thousands out) must NOT match — its claimers inherit cost 0
      if (nin < 25 || nout < 25 || nin + nout < 100) continue;
      if (Math.min(nin, nout) / Math.max(nin, nout) < 0.05) continue;
      const finalBal = (st.wallets.get(a)?.[0] || 0n) + (net.get(a) || 0n);
      if (finalBal < 0n) continue; // pool-side accounting artifact, skip
      const turnover = turn.get(a) || 0;
      if (turnover > 0 && Number(finalBal) <= turnover / 10000) { st.pools.add(a); detected++; }
    }
    if (detected) console.log(`  venues auto-détectées: ${detected} (routeurs/agrégateurs pass-through bidirectionnels)`);
  }

  // ---- replay the batch, day by day ---------------------------------------
  for (const [bn, d, from, to, v] of batch) {
    void bn;
    if (d && d !== curDate) {
      flushDay(curDate);
      // quiet days in between share curDate's end-of-day state (no events)
      if (curDate) {
        const step = new Date(curDate + "T00:00:00Z");
        for (;;) {
          step.setUTCDate(step.getUTCDate() + 1);
          const q = step.toISOString().slice(0, 10);
          if (q >= d) break;
          flushDay(q);
        }
      }
      curDate = d;
    }
    if (v > 0n) {
      const tokens = Number(v) / dec;
      const px = d ? priceAt(d) : null;
      const fromPool = from === ZERO || st.pools.has(from);
      const toPool = to === ZERO || st.pools.has(to);
      const w = (a) => {
        if (!st.wallets.has(a)) st.wallets.set(a, [0n, 0]);
        return st.wallets.get(a);
      };
      if (!fromPool) {
        const fw = w(from);
        const balTok = Number(fw[0]) / dec;
        const avg = balTok > 0 && fw[1] > 0 ? fw[1] / balTok : 0;
        const outCost = Math.min(fw[1], avg * tokens);
        fw[0] -= v;
        fw[1] = Math.max(0, fw[1] - outCost);
        if (toPool && px != null) {
          // sell into a venue → realize (day price − avg cost) × tokens
          const gain = px * tokens - outCost;
          realizedToday += gain;
          if (px * tokens >= 5000) realizedBigToday += gain;
        } else if (!toPool) {
          // P2P transfer: the receiver inherits the moved cost basis
          const tw = w(to);
          tw[0] += v;
          tw[1] += outCost;
        }
      }
      if (fromPool && !toPool) {
        // buy from a venue (or mint: cost 0) → acquired at the day's price
        const tw = w(to);
        tw[0] += v;
        if (from !== ZERO && px != null) tw[1] += px * tokens;
      }
    }
  }
  // Close the last fully-elapsed day and STOP THERE: days beyond the last
  // indexed event are unknowable, not quiet — fabricating them hid a 2-month
  // thirdweb Insight outage on Monad. The series honestly ends at the last
  // on-chain activity the indexer has seen.
  if (curDate && curDate < today) { flushDay(curDate); st.lastDate = null; }
  else st.lastDate = curDate;
  series.sort((a, b) => a.date.localeCompare(b.date));

  saveState(asset.symbol, st);
  fs.mkdirSync(path.dirname(rawFile), { recursive: true });
  fs.writeFileSync(rawFile, JSON.stringify({
    symbol: asset.symbol,
    indexedToBlock: st.lastBlock,
    indexedToDate: series.at(-1)?.date ?? null,
    series,
  }, null, 1));
  return { events, calls, days: series.length, pools: st.pools.size, last: series.at(-1) };
}
