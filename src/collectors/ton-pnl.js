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

// All jetton transfers → per-owner acquisition {usd, amt} (inflows valued at the
// day's price, for cost basis) AND per-owner signed daily balance changes (in −
// out, for the historical holder count). LT-cursor descending (deep offset
// times out).
async function acquisitionCost(master, decimals, priceAt) {
  const cost = new Map();       // owner -> { usd, amt }
  const balDelta = new Map();   // owner -> Map(date -> signed token delta)
  const bump = (owner, date, d) => {
    let m = balDelta.get(owner); if (!m) { m = new Map(); balDelta.set(owner, m); }
    m.set(date, (m.get(date) || 0) + d);
  };
  // Adaptive page size: toncenter times out (500) on deep cursors at limit=1000;
  // 256 helps but the biggest jettons (UTYA, ~466k transfers) still hit a wall.
  // On a persistent 500 we HALVE the page and retry the SAME cursor — a lighter
  // query gets through — instead of stopping. Only give up once even limit=16
  // fails, so we recover ~everything.
  let PAGE = 256;
  let endLt = null, pages = 0, rows = 0, shrinks = 0, sinceShrink = 0;
  for (;;) {
    const usedPage = PAGE;
    const url = `${TC}/jetton/transfers?jetton_master=${master}&limit=${usedPage}&sort=desc` + (endLt != null ? `&end_lt=${endLt}` : "");
    let j;
    try { j = await tcJson(url, 3); }
    catch (e) {
      if (PAGE > 16) { PAGE = Math.max(16, Math.floor(PAGE / 2)); shrinks++; sinceShrink = 0; await sleep(2500); continue; }
      console.warn(`  toncenter bloqué @ end_lt=${endLt} même à page 16 — arrêt avec ${rows} transferts (partiel)`); break;
    }
    const ts = j.jetton_transfers || [];
    if (!ts.length) break;
    for (const tr of ts) {
      const to = tr.destination?.toLowerCase();
      const from = tr.source?.toLowerCase();
      const amt = Number(BigInt(tr.amount || "0")) / 10 ** decimals;
      if (!(amt > 0)) continue;
      const date = new Date(Number(tr.transaction_now) * 1000).toISOString().slice(0, 10);
      if (to) {
        const price = priceAt(date);
        if (price != null) { const c = cost.get(to) || { usd: 0, amt: 0 }; c.usd += amt * price; c.amt += amt; cost.set(to, c); }
        bump(to, date, amt);
      }
      if (from) bump(from, date, -amt);
    }
    rows += ts.length; pages++;
    const minLt = ts.reduce((m, x) => Math.min(m, Number(x.transaction_lt)), Infinity);
    if (ts.length < usedPage || !isFinite(minLt)) break; // last page (compared to the size actually used)
    endLt = minLt - 1;
    if (PAGE < 256 && ++sinceShrink >= 15) { PAGE = Math.min(256, PAGE * 2); sinceShrink = 0; } // recover speed once past the wall
    await sleep(tcDelay());
  }
  return { cost, balDelta, pages, rows };
}

// Historical holders + $-tiers from the transfer-reconstructed balances.
// Holder COUNT is exact per day (balance-crossing events, calibrated so the last
// point matches the live tonapi count). $-tiers use the current cohort's balance
// distribution × each day's price (same "supply in profit" projection as the
// EVM/Solana collectors), scaled to the exact holder count of the day.
const TIER_KEYS = ["lt50", "t50_500", "t500_5k", "t5k_50k", "gt50k"];
function holdersHistory(balDelta, currentBal, priceSeries) {
  // exact daily holder count via +1/−1 balance crossings
  const crossByDate = new Map();
  for (const [, dm] of balDelta) {
    const days = [...dm.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    let run = 0, prevPos = false;
    for (const [date, delta] of days) {
      run += delta;
      const pos = run > 1e-9;
      if (pos && !prevPos) crossByDate.set(date, (crossByDate.get(date) || 0) + 1);
      else if (!pos && prevPos) crossByDate.set(date, (crossByDate.get(date) || 0) - 1);
      prevPos = pos;
    }
  }
  const cdates = [...crossByDate.keys()].sort();
  let run = 0; const countByDate = new Map();
  for (const d of cdates) { run += crossByDate.get(d); countByDate.set(d, run); }
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
  const { cost, balDelta, pages, rows } = await acquisitionCost(address, decimals, priceAt);

  // current holders with a known acquisition cost
  const cohort = [];
  for (const [owner, b] of bal) {
    const c = cost.get(owner);
    if (c && c.amt > 0) cohort.push({ cost: c.usd / c.amt, bal: b });
  }

  const { series, buckets, holders } = seriesFromCohort(cohort, priceSeries, curPrice);
  if (!series.length) throw new Error(`${asset.symbol}: no cohort cost (transfers=${rows})`);

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
  const hh = holdersHistory(balDelta, bal, priceSeries);
  writeMerged(path.resolve(`data/raw/holders-history/${asset.symbol}.json`), hh, "ton-hist");

  return { days: series.length, holders, buckets, transfers: rows, pages, nowPct: series.at(-1)?.pctInProfit, hhDays: hh.length, ms: Date.now() - t0 };
}
