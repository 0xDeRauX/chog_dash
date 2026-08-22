// % en gain (percent of holders in profit) for TON jettons — the metric Dune
// can't give (it doesn't index TON). We rebuild it from first principles:
//   · every jetton transfer (toncenter, LT-cursor paginated) → each holder's
//     average acquisition cost, valuing every inflow at that day's price
//     (data/raw/prices-history/<SYM>.json);
//   · current balances (tonapi.io) tell us who still holds;
//   · a cost-basis histogram of current holders convolved with the full price
//     history yields the daily % en gain series + profit tranches, exactly like
//     the Solana/EVM collectors (same "supply in profit" caveat: the past curve
//     reflects today's cohort, converging to the exact value now).
// Free: toncenter (10 req/s with a key, ~1/s keyless) + tonapi. Emits the CHOG
// pnl schema so the existing UI renders it unchanged.
import fs from "fs";
import path from "path";
import { CONFIG } from "../config.js";

const TC = "https://toncenter.com/api/v3";
const TA = "https://tonapi.io/v2";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tcDelay = () => (CONFIG.TONCENTER_API_KEY ? 130 : 1100);

async function tcJson(url, tries = 6) {
  const headers = CONFIG.TONCENTER_API_KEY ? { "X-API-Key": CONFIG.TONCENTER_API_KEY } : {};
  for (let a = 0; ; a++) {
    const res = await fetch(url, { headers });
    if (res.ok) return res.json();
    if ([429, 500, 503, 504].includes(res.status) && a < tries) { await sleep(2000 * (a + 1)); continue; }
    throw new Error(`toncenter HTTP ${res.status}`);
  }
}
async function taJson(url) {
  for (let a = 0; ; a++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (res.status === 429 && a < 5) { await sleep(4000 * (a + 1)); continue; }
    throw new Error(`tonapi HTTP ${res.status}`);
  }
}

// Daily price lookup with forward-fill from the nearest earlier known day.
function priceLookup(series) {
  const days = series.filter((p) => p.price > 0).map((p) => [p.date, p.price]).sort((a, b) => a[0].localeCompare(b[0]));
  const first = days[0]?.[1] ?? null;
  return (date) => {
    if (!days.length) return null;
    let v = first;
    for (const [d, p] of days) { if (d <= date) v = p; else break; }
    return v;
  };
}

// Every current holder's owner→balance (human units), via tonapi pagination.
async function currentHolders(address, decimals) {
  const bal = new Map();
  for (let offset = 0; offset < 40000; offset += 1000) {
    const page = await taJson(`${TA}/jettons/${address}/holders?limit=1000&offset=${offset}`);
    const addrs = page.addresses || [];
    for (const h of addrs) {
      const v = Number(BigInt(h.balance || "0")) / 10 ** decimals;
      const owner = h.owner?.address?.toLowerCase(); // tonapi=lowercase, toncenter=uppercase → normalise
      if (owner && v > 0) bal.set(owner, v);
    }
    if (addrs.length < 1000) break;
    await sleep(1100);
  }
  return bal;
}

// ---- incremental state (cached by CI between runs, like the CHOG ledger) ----
// Fetching every jetton transfer daily is wasteful (UTYA ~467k, ~15 min). So we
// persist the DERIVED state — per-owner cost basis, running balance, and the
// daily holder-crossing tally — and each run only reads transfers NEWER than the
// last LT seen, folding them in. First run (cache miss) does the full history;
// every day after is seconds.
const STATE_DIR = "data/pnl-state/ton";
const EPS = 1e-9;
const TIER_KEYS = ["lt50", "t50_500", "t500_5k", "t5k_50k", "gt50k"];

function loadState(sym) {
  try {
    const s = JSON.parse(fs.readFileSync(path.resolve(`${STATE_DIR}/${sym}.json`), "utf8"));
    return {
      cost: new Map(Object.entries(s.cost || {}).map(([k, v]) => [k, { usd: v[0], amt: v[1] }])),
      bal: new Map(Object.entries(s.bal || {})),
      cross: new Map(Object.entries(s.cross || {})),
      lastLt: Number(s.lastLt || 0), transfers: Number(s.transfers || 0),
    };
  } catch { return { cost: new Map(), bal: new Map(), cross: new Map(), lastLt: 0, transfers: 0 }; }
}
function saveState(sym, st) {
  fs.mkdirSync(path.resolve(STATE_DIR), { recursive: true });
  fs.writeFileSync(path.resolve(`${STATE_DIR}/${sym}.json`), JSON.stringify({
    lastLt: st.lastLt, transfers: st.transfers,
    cost: Object.fromEntries([...st.cost].map(([k, v]) => [k, [v.usd, v.amt]])),
    bal: Object.fromEntries(st.bal),
    cross: Object.fromEntries(st.cross),
  }));
}
// Fold one balance change into the state: track the running balance and, on a
// zero-crossing, the +1/−1 holder-count event for that day.
function applyBal(st, owner, d, date) {
  const prev = st.bal.get(owner) || 0;
  const next = prev + d;
  if (next > EPS && prev <= EPS) st.cross.set(date, (st.cross.get(date) || 0) + 1);
  else if (next <= EPS && prev > EPS) st.cross.set(date, (st.cross.get(date) || 0) - 1);
  if (Math.abs(next) < EPS) st.bal.delete(owner); else st.bal.set(owner, next);
}

// Fold ONE transfer (chronological order assumed) into cost basis + balances.
function foldOne(tr, decimals, priceAt, st) {
  const amt = Number(BigInt(tr.amount || "0")) / 10 ** decimals;
  if (!(amt > 0)) return;
  const to = tr.destination?.toLowerCase();
  const from = tr.source?.toLowerCase();
  const date = new Date(Number(tr.transaction_now) * 1000).toISOString().slice(0, 10);
  if (to) {
    const price = priceAt(date);
    if (price != null) { const c = st.cost.get(to) || { usd: 0, amt: 0 }; c.usd += amt * price; c.amt += amt; st.cost.set(to, c); }
    applyBal(st, to, amt, date);
  }
  if (from) applyBal(st, from, -amt, date);
}

// Full bootstrap (no cursor yet). toncenter 500s on sort=asc&start_lt=0 for
// high-volume jettons (an unindexed scan from genesis — verified: UTYA returns
// 500 even at limit=1), while sort=desc from the tip is indexed and instant.
// So page DESCENDING from the tip collecting light tuples, then fold them in
// ascending time order (balance-crossing detection needs chronology).
async function bootstrapDescending(master, decimals, priceAt, st) {
  const buf = [];
  let endLt = null, PAGE = 256, pages = 0;
  for (;;) {
    const cursor = endLt != null ? `&end_lt=${endLt - 1}` : "";
    const url = `${TC}/jetton/transfers?jetton_master=${master}&limit=${PAGE}&sort=desc${cursor}`;
    let j;
    try { j = await tcJson(url, 4); }
    catch {
      if (PAGE > 16) { PAGE = Math.max(16, PAGE >> 1); await sleep(2500); continue; }
      console.warn(`  bootstrap toncenter bloqué @ end_lt=${endLt} (${buf.length} collectés, partiel)`); break;
    }
    const ts = j.jetton_transfers || [];
    if (!ts.length) break;
    for (const tr of ts) buf.push({ transaction_lt: tr.transaction_lt, transaction_now: tr.transaction_now, amount: tr.amount, source: tr.source, destination: tr.destination });
    endLt = Math.min(...ts.map((x) => Number(x.transaction_lt)));
    pages++;
    if (ts.length < PAGE) break;
    await sleep(tcDelay());
  }
  if (!buf.length) return 0;
  buf.sort((a, b) => Number(a.transaction_lt) - Number(b.transaction_lt)); // chronological
  let maxLt = 0;
  for (const tr of buf) { const lt = Number(tr.transaction_lt); if (lt > maxLt) maxLt = lt; foldOne(tr, decimals, priceAt, st); }
  st.lastLt = maxLt;
  st.transfers += buf.length;
  console.log(`  bootstrap descendant: ${buf.length} transferts en ${pages} pages`);
  return buf.length;
}

// Read only transfers with LT > st.lastLt (ascending cursor), folding cost +
// balances + crossings into the state. Adaptive page size to survive toncenter's
// deep-cursor 500s. Returns the number of new transfers processed.
async function scanNewTransfers(master, decimals, priceAt, st) {
  // No cursor yet → full bootstrap (descending; asc-from-genesis 500s on big jettons).
  if (!st.lastLt) return bootstrapDescending(master, decimals, priceAt, st);
  // Incremental: ascending from the cursor near the tip — toncenter serves this fine.
  let PAGE = 256, startLt = st.lastLt + 1, added = 0, maxLt = st.lastLt, sinceShrink = 0;
  for (;;) {
    const usedPage = PAGE;
    const url = `${TC}/jetton/transfers?jetton_master=${master}&limit=${usedPage}&sort=asc&start_lt=${startLt}`;
    let j;
    try { j = await tcJson(url, 3); }
    catch {
      if (PAGE > 16) { PAGE = Math.max(16, Math.floor(PAGE / 2)); sinceShrink = 0; await sleep(2500); continue; }
      console.warn(`  toncenter bloqué @ start_lt=${startLt} — arrêt (${added} nouveaux, partiel)`); break;
    }
    const ts = j.jetton_transfers || [];
    if (!ts.length) break;
    for (const tr of ts) {
      const lt = Number(tr.transaction_lt);
      if (lt <= st.lastLt) continue; // overlap guard
      maxLt = Math.max(maxLt, lt);
      foldOne(tr, decimals, priceAt, st);
    }
    added += ts.length;
    if (ts.length < usedPage) break;
    startLt = Math.max(...ts.map((x) => Number(x.transaction_lt))) + 1;
    if (PAGE < 256 && ++sinceShrink >= 15) { PAGE = Math.min(256, PAGE * 2); sinceShrink = 0; }
    await sleep(tcDelay());
  }
  st.lastLt = maxLt;
  st.transfers += added;
  return added;
}

// Historical holders + $-tiers from the accumulated crossing tally + balances.
// Holder COUNT is exact per day (balance-crossing events, calibrated so the last
// point matches the live tonapi count). $-tiers use the current cohort's balance
// distribution × each day's price (same "supply in profit" projection as the
// EVM/Solana collectors), scaled to the exact holder count of the day.
function holdersHistory(cross, currentBal, priceSeries) {
  const cdates = [...cross.keys()].sort();
  let run = 0; const countByDate = new Map();
  for (const d of cdates) { run += cross.get(d); countByDate.set(d, run); }
  const crossFinal = run || currentBal.size;
  const calib = crossFinal ? currentBal.size / crossFinal : 1; // match live tonapi count
  const countAsOf = (date) => {
    let v = 0; for (const d of cdates) { if (d <= date) v = countByDate.get(d); else break; }
    return Math.round(v * calib);
  };
  const balArr = [...currentBal.values()].filter((b) => b > 0);
  const totCohort = balArr.length || 1;
  return priceSeries.filter((p) => p.price > 0).map(({ date, price }) => {
    const c = { lt50: 0, t50_500: 0, t500_5k: 0, t5k_50k: 0, gt50k: 0 };
    for (const b of balArr) {
      const usd = b * price;
      const k = usd < 50 ? "lt50" : usd < 500 ? "t50_500" : usd < 5000 ? "t500_5k" : usd < 50000 ? "t5k_50k" : "gt50k";
      c[k]++;
    }
    const hExact = countAsOf(date);
    const tiers = Object.fromEntries(TIER_KEYS.map((k) => [k, Math.round((c[k] / totCohort) * hExact)]));
    return { date, holders: hExact, tiers, source: "ton-hist" };
  });
}

// Cost-basis histogram of current holders → daily % en gain + profit tranches.
function seriesFromCohort(cohort, priceSeries, curPrice) {
  // cohort: [{ cost, bal }]  (current holders with a known avg cost)
  const BUCKETS = 20; // per e-fold (~5% cost resolution)
  const hist = new Map(); // bucket -> { holders, supply, sumLnCost }
  for (const { cost, bal } of cohort) {
    if (!(cost > 0)) continue;
    const b = Math.round(Math.log(cost) * BUCKETS);
    const h = hist.get(b) || { holders: 0, supply: 0, sumLn: 0 };
    h.holders++; h.supply += bal; h.sumLn += Math.log(cost);
    hist.set(b, h);
  }
  const buckets = [...hist.values()].map((h) => ({ rep: Math.exp(h.sumLn / h.holders), holders: h.holders, supply: h.supply }));
  const total = buckets.reduce((s, b) => s + b.holders, 0);
  if (!total) return { series: [], buckets: 0, holders: 0 };

  const rowFor = (date, price) => {
    let inProfit = 0, x10 = 0, x2_10 = 0, x1_2 = 0, l0_50 = 0, l50 = 0;
    for (const b of buckets) {
      const ratio = price / b.rep;
      if (ratio > 1) inProfit += b.holders;
      if (ratio >= 10) x10 += b.holders;
      else if (ratio >= 2) x2_10 += b.holders;
      else if (ratio > 1) x1_2 += b.holders;
      else if (ratio >= 0.5) l0_50 += b.holders;
      else l50 += b.holders;
    }
    return {
      date, holders: total, airdrop: 0, buyers: total, inProfit,
      pctInProfit: Math.round((1000 * inProfit) / total) / 10,
      x10, x2_10, x1_2, l0_50, l50, realizedUsd: 0, realizedBigUsd: 0, source: "ton-hist",
    };
  };
  const series = priceSeries.filter((p) => p.price > 0).map((p) => rowFor(p.date, p.price));
  return { series, buckets: buckets.length, holders: total };
}

export async function collectTonPnl(asset) {
  const address = asset.holders?.address;
  if (!address) throw new Error(`${asset.symbol}: no TON jetton address`);

  let priceSeries;
  try { priceSeries = JSON.parse(fs.readFileSync(path.resolve(`data/raw/prices-history/${asset.symbol}.json`), "utf8")).series || []; }
  catch { throw new Error(`${asset.symbol}: no price history`); }
  if (!priceSeries.length) throw new Error(`${asset.symbol}: empty price history`);
  const priceAt = priceLookup(priceSeries);
  const curPrice = [...priceSeries].reverse().find((p) => p.price > 0)?.price;

  const meta = await taJson(`${TA}/jettons/${address}`);
  const decimals = Number(meta.metadata?.decimals ?? asset.holders?.decimals ?? 9);

  const t0 = Date.now();
  const bal = await currentHolders(address, decimals);
  const st = loadState(asset.symbol);
  const added = await scanNewTransfers(address, decimals, priceAt, st); // only new transfers folded in
  saveState(asset.symbol, st);

  // current holders with a known acquisition cost
  const cohort = [];
  for (const [owner, b] of bal) {
    const c = st.cost.get(owner);
    if (c && c.amt > 0) cohort.push({ cost: c.usd / c.amt, bal: b });
  }

  const { series, buckets, holders } = seriesFromCohort(cohort, priceSeries, curPrice);
  if (!series.length) throw new Error(`${asset.symbol}: no cohort cost (transfers=${st.transfers})`);

  const today = new Date().toISOString().slice(0, 10);
  const writeMerged = (file, rows2, histTag) => {
    let existing = [];
    try { existing = JSON.parse(fs.readFileSync(file, "utf8")).series || []; } catch { /* first run */ }
    const byDate = new Map();
    for (const r of rows2) byDate.set(r.date, r);
    for (const r of existing) if (r.source !== histTag) byDate.set(r.date, r); // live snapshots win
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ symbol: asset.symbol, indexedToDate: today, source: "toncenter", series: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) }, null, 1));
  };

  // % en gain series
  writeMerged(path.resolve(`data/raw/pnl/${asset.symbol}.json`), series, "ton-hist");
  // holders + $-tiers series (both were snapshot-only before) — full history now
  const hh = holdersHistory(st.cross, bal, priceSeries);
  writeMerged(path.resolve(`data/raw/holders-history/${asset.symbol}.json`), hh, "ton-hist");

  return { days: series.length, holders, buckets, added, transfers: st.transfers, nowPct: series.at(-1)?.pctInProfit, hhDays: hh.length, ms: Date.now() - t0 };
}
