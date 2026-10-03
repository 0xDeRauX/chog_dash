// Holder PnL ledger: replays every ERC-20 Transfer with the daily price to
// maintain an average-cost basis per wallet, and emits ONE aggregate row per
// day — % of holders in profit, unrealized-PnL tranches, realized $, plus the
// exact on-chain holder count and USD tranches. Runs for CHOG (Monad) and for
// the EVM memes PEPE/ONDO (Ethereum) and BRETT (Base), all through Envio
// HyperRPC (free token, 5 req/min). This replaced Dune for PEPE/BRETT/ONDO in
// Oct 2026 (Dune accounts suspended) and recomputes their whole history with
// ONE holder definition.
//
// Incremental + resumable: the state (wallet ledger, day series, cursor) is
// cached between CI runs. Each run folds new blocks in chunks and saves after
// every chunk; a time budget lets a multi-hour first index (BRETT ~2h) spread
// over several daily runs. Raw files are only (re)written once the ledger has
// caught up with the chain head, so a half-built history never replaces the
// published one. No state → transparent full re-index from startBlock.
//
// Honest approximations (documented in the UI help): acquisitions are valued
// at the DAY's close price (the event log has no trade price); wallet→wallet
// transfers that touch no venue inherit the sender's cost basis (no PnL
// realized) — CEX deposits/withdrawals included; mints/airdrops cost $0.
// Venues (DexScreener pools, auto-detected routers, known singletons such as
// the Uniswap v4 PoolManager) are excluded from holder stats.
import fs from "fs";
import path from "path";
import { hyperRpcAvailable, transferLogs, blockDater, headBlock } from "../lib/monadLogs.js";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO = "0x0000000000000000000000000000000000000000";
const addrFromTopic = (t) => ("0x" + (t || "").slice(-40)).toLowerCase();

// Singleton venues that custody every pool's tokens: a buy from them must be a
// BUY at the day's price, not a P2P transfer inheriting the vault's cost.
const KNOWN_VENUES = {
  eth: [
    "0x000000000004444c5dc75cb358380d2e3de08a90", // Uniswap v4 PoolManager
    "0xba12222222228d8ba445958a75a0704d566bf2c8", // Balancer V2 Vault
  ],
  base: [
    "0x498581ff718922c3f8e6a244956af099b2652b2b", // Uniswap v4 PoolManager
    "0xba12222222228d8ba445958a75a0704d566bf2c8", // Balancer V2 Vault
  ],
};
// Blocks left out at the head (reorg safety), and logs folded per chunk.
const HEAD_LAG = { eth: 12, base: 60, monad: 0 };
const CHUNK_LOGS = 300_000;

// Ledger config: explicit `ledger` (EVM memes) or CHOG's historical holders cfg.
export function ledgerCfg(asset) {
  if (asset.ledger) return asset.ledger;
  const h = asset.holders;
  if (h?.source === "thirdweb") return { chain: "monad", contract: h.contract, startBlock: h.startBlock, decimals: h.decimals };
  return null;
}

const STATE_DIR = path.resolve("data/pnl-state");
const stateFile = (sym) => path.join(STATE_DIR, `${sym}.json`);

function loadState(sym) {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(sym), "utf8"));
    return {
      lastBlock: s.lastBlock || 0,
      lastDate: s.lastDate || null,
      realized: s.realized || [0, 0],
      caughtUp: s.caughtUp ?? true,
      series: s.series || null,
      pools: new Set(s.pools || []),
      distributors: new Set(s.distributors || []),
      // wallets: addr -> [balanceRaw(BigInt str), costTotalUsd(number)]
      wallets: new Map(Object.entries(s.wallets || {}).map(([a, [b, c]]) => [a, [BigInt(b), c]])),
    };
  } catch {
    return { lastBlock: 0, lastDate: null, realized: [0, 0], caughtUp: false, series: null, pools: new Set(), distributors: new Set(), wallets: new Map() };
  }
}
function saveState(sym, st) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const wallets = {};
  for (const [a, [b, c]] of st.wallets) if (b > 0n) wallets[a] = [b.toString(), c]; // emptied wallets carry no cost
  fs.writeFileSync(stateFile(sym), JSON.stringify({
    lastBlock: st.lastBlock,
    lastDate: st.lastDate,
    realized: st.realized,
    caughtUp: st.caughtUp,
    series: st.series,
    pools: [...st.pools],
    distributors: [...st.distributors],
    wallets,
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

const addDays = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// opts.deadline (ms epoch): stop folding new chunks past it (state is saved,
// the next run resumes). Returns { caughtUp, ... }.
export async function collectPnl(asset, { deadline = null } = {}) {
  const cfg = ledgerCfg(asset);
  if (!cfg) throw new Error(`${asset.symbol}: no transfer ledger configured`);
  if (!hyperRpcAvailable()) throw new Error("Missing HYPERSYNC_API_KEY");
  const chain = cfg.chain || "monad";
  const dec = 10 ** (cfg.decimals ?? 18);
  const prices = priceMap(asset.symbol);
  if (!prices.size) throw new Error(`${asset.symbol}: no price data for cost basis`);
  const priceDates = [...prices.keys()].sort();
  const firstPriceDate = priceDates[0];
  const st = loadState(asset.symbol);
  for (const p of await fetchPools(cfg.contract)) st.pools.add(p);
  for (const p of KNOWN_VENUES[chain] || []) st.pools.add(p);

  // Day series: kept in the state (resumable multi-run index). Older CHOG
  // states predate that → fall back to the committed raw rows. A FULL reindex
  // (no cached state) recomputes every day from scratch instead: trusting a
  // stale committed raw is exactly what let a wrong classification survive a
  // cache-bust.
  const rawFile = path.resolve(`data/raw/pnl/${asset.symbol}.json`);
  const fullReindex = st.lastBlock === 0;
  let series = st.series || [];
  if (!st.series && !fullReindex) {
    try { series = JSON.parse(fs.readFileSync(rawFile, "utf8")).series || []; } catch { /* first run */ }
  }
  st.series = series;
  const doneDates = new Set(series.map((r) => r.date));

  // Day price, else the latest known price of the previous 7 days: a missed
  // daily run (no snapshot that day) used to drop the day from the series for
  // good, since its blocks were already folded (CHOG 2026-09-29 / 10-01).
  const priceAt = (d) => {
    if (prices.has(d)) return prices.get(d);
    if (d < firstPriceDate) return prices.get(firstPriceDate);
    for (let i = 1; i <= 7; i++) { const p = prices.get(addDays(d, -i)); if (p != null) return p; }
    return null;
  };
  const today = new Date().toISOString().slice(0, 10);
  let realizedToday = st.realized[0], realizedBigToday = st.realized[1], curDate = st.lastDate;

  const flushDay = (d) => {
    // aggregate the wallet ledger as of end of day d
    if (!d || d >= today || doneDates.has(d)) { realizedToday = 0; realizedBigToday = 0; return; }
    const px = priceAt(d);
    if (px == null) { realizedToday = 0; realizedBigToday = 0; return; }
    // Two cohorts: BUYERS (real cost basis — the informative population) vs
    // the AIRDROP cohort (cost $0, in profit at any price by construction —
    // counting them froze pctInProfit near 79% forever). % and tranches are
    // buyers-only; the airdrop count stays visible as its own line.
    let holders = 0, airdrop = 0, buyers = 0, inProfit = 0, x10 = 0, x2 = 0, x1 = 0, l50 = 0, l50p = 0;
    // USD-value tranches over EVERY positive-balance wallet — dust included, so
    // the five buckets sum to the on-chain holder count (matches the explorer's
    // holders_count, ~33K for CHOG, not the dust-filtered 26.5K). This classifies
    // by dollars held, not by gain; the profit stats below keep their dust filter
    // so a swarm of sub-cent wallets can't move pctInProfit.
    let tLt50 = 0, t50_500 = 0, t500_5k = 0, t5k_50k = 0, tGt50k = 0;
    for (const [addr, [bal, cost]] of st.wallets) {
      if (bal <= 0n || st.pools.has(addr) || st.distributors.has(addr)) continue;
      const tokens = Number(bal) / dec;
      const usd = tokens * px;
      if (usd < 50) tLt50++;
      else if (usd < 500) t50_500++;
      else if (usd < 5000) t500_5k++;
      else if (usd < 50000) t5k_50k++;
      else tGt50k++;
      if (usd < 0.01) continue; // dust: out of the holder & profit classification
      holders++;
      const avg = cost > 0 && tokens > 0 ? cost / tokens : 0;
      if (avg <= 0) { airdrop++; continue; }
      buyers++;
      const ratio = px / avg;
      if (ratio > 1) inProfit++;
      if (ratio >= 10) x10++;
      else if (ratio >= 2) x2++;
      else if (ratio > 1) x1++;
      else if (ratio >= 0.5) l50++;
      else l50p++;
    }
    series.push({
      date: d, holders, airdrop, buyers, inProfit,
      pctInProfit: buyers ? Number(((inProfit / buyers) * 100).toFixed(2)) : null,
      x10, x2_10: x2, x1_2: x1, l0_50: l50, l50: l50p,
      // on-chain holder count (dust included) drives the holders LINE + tranches;
      // `holders` above stays the dust-filtered count for the % en gain view.
      holdersOnchain: tLt50 + t50_500 + t500_5k + t5k_50k + tGt50k,
      tiers: { lt50: tLt50, t50_500, t500_5k, t5k_50k, gt50k: tGt50k },
      realizedUsd: Math.round(realizedToday),
      realizedBigUsd: Math.round(realizedBigToday),
    });
    doneDates.add(d);
    realizedToday = 0; realizedBigToday = 0;
  };

  // Fold one chunk of raw logs (ascending) into the ledger: date the blocks,
  // run the venue/distributor pre-pass on the chunk, then replay day by day.
  const processChunk = async (rawLogs) => {
    if (!rawLogs.length) return;
    // min−1: the dater needs two distinct anchor blocks, even when every log
    // of a small incremental batch sits in one block
    const dateOf = await blockDater(Math.max(1, rawLogs[0].block_number - 1), rawLogs.at(-1).block_number, chain);
    const batch = rawLogs.map((l) => [l.block_number, dateOf(l.block_number), addrFromTopic(l.topics[1]), addrFromTopic(l.topics[2]),
      BigInt(l.data && l.data !== "0x" ? l.data : "0x0")]);
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

      // Airdrop/claim distributor: near-ONE-WAY fan-out (a handful of funding
      // inflows, then hundreds+ of small outbound sends). Opposite signature
      // from a pool (which is balanced both ways) — this catches mass
      // distributions that would otherwise pass a diluted near-zero cost basis
      // to thousands of "buyers", inflating the in-profit count.
      let distDetected = 0;
      for (const a of new Set([...inC.keys(), ...outC.keys()])) {
        if (a === ZERO || st.pools.has(a) || st.distributors.has(a)) continue;
        const nin = inC.get(a) || 0, nout = outC.get(a) || 0;
        if (nout < 200 || nin > 10 || nout < nin * 20) continue;
        st.distributors.add(a);
        distDetected++;
      }
      if (distDetected) console.log(`  distributeurs airdrop détectés: ${distDetected} (fan-out asymétrique — destinataires traités comme coût \$0)`);
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
        const fromDistributor = st.distributors.has(from);
        const w = (a) => {
          if (!st.wallets.has(a)) st.wallets.set(a, [0n, 0]);
          return st.wallets.get(a);
        };
        if (fromDistributor && !toPool) {
          // airdrop/claim: recipient acquires at cost $0, no cost inherited
          const tw = w(to);
          tw[0] += v;
        } else if (!fromPool) {
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
        if (fromPool && !toPool && !fromDistributor) {
          // buy from a venue (or mint: cost 0) → acquired at the day's price
          const tw = w(to);
          tw[0] += v;
          if (from !== ZERO && px != null) tw[1] += px * tokens;
        }
      }
    }
    for (const [a, w] of st.wallets) if (w[0] === 0n) st.wallets.delete(a); // keep memory bounded (PEPE: millions of churned wallets)
  };

  // ---- fetch + fold new blocks, chunk by chunk -----------------------------
  const head = (await headBlock(chain)) - (HEAD_LAG[chain] ?? 0);
  const cursor = st.lastBlock > 0 ? st.lastBlock + 1 : (cfg.startBlock || 1);
  let calls = 0, events = 0, pending = [], caughtUp = cursor > head;
  for await (const { logs, upTo } of transferLogs(cfg.contract, TRANSFER_TOPIC, cursor, chain, head)) {
    calls++;
    for (const l of logs) pending.push(l);
    events += logs.length;
    if (pending.length >= CHUNK_LOGS || upTo >= head) {
      await processChunk(pending);
      pending = [];
      if (upTo < head) console.log(`  ${asset.symbol}: bloc ${upTo}/${head} · jour ${curDate} · ${events} transferts · ${st.wallets.size} wallets`);
    }
    st.lastBlock = upTo; // only advanced once the window's logs are folded
    if (upTo >= head) { caughtUp = true; break; }
    if (!pending.length) { st.realized = [realizedToday, realizedBigToday]; st.lastDate = curDate; saveState(asset.symbol, st); }
    if (deadline && Date.now() > deadline) {
      await processChunk(pending); pending = [];
      break;
    }
  }

  // Close the last fully-elapsed day and STOP THERE: days beyond the last
  // indexed event are unknowable, not quiet — fabricating them hid a 2-month
  // thirdweb Insight outage on Monad. Only when caught up: a budget stop may
  // land mid-day, and that day must keep accumulating next run.
  if (caughtUp && curDate && curDate < today) { flushDay(curDate); curDate = null; }
  st.lastDate = curDate;
  st.realized = [realizedToday, realizedBigToday];
  st.caughtUp = caughtUp;
  series.sort((a, b) => a.date.localeCompare(b.date));
  saveState(asset.symbol, st);

  const last = series.at(-1);
  if (!caughtUp) {
    return { caughtUp, events, calls, days: series.length, pools: st.pools.size, last, progressBlock: st.lastBlock, head };
  }

  fs.mkdirSync(path.dirname(rawFile), { recursive: true });
  fs.writeFileSync(rawFile, JSON.stringify({
    symbol: asset.symbol,
    source: "ledger",
    indexedToBlock: st.lastBlock,
    indexedToDate: last?.date ?? null,
    series,
  }, null, 1));

  // Also feed the holders LINE and the $-tranches from the ledger: the same
  // per-day scan already knows the exact holder count and the USD-value tiers,
  // so emit them through the holders-history path (→ holders_daily +
  // holder_tiers_daily). The asset thereby single-sources its holders from the
  // ledger (ingest skips the daily snapshot for any holders-history symbol),
  // avoiding a definition mismatch between the two counts.
  if (series.length) {
    const histFile = path.resolve(`data/raw/holders-history/${asset.symbol}.json`);
    fs.mkdirSync(path.dirname(histFile), { recursive: true });
    fs.writeFileSync(histFile, JSON.stringify({
      symbol: asset.symbol,
      series: series.map((r) => ({ date: r.date, holders: r.holdersOnchain ?? r.holders, tiers: r.tiers })),
    }, null, 1));
  }
  return { caughtUp, events, calls, days: series.length, pools: st.pools.size, last };
}
