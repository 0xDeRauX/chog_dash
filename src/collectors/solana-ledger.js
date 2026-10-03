// Forward holder-PnL ledger for the Solana memes (WIF, BONK, PENGU, FARTCOIN,
// ANSEM). Replaced the Dune full-history query (Dune accounts suspended, Oct
// 2026): no free source serves a Solana token's whole transfer history, but
// the daily getProgramAccounts scan (holders.js) already reads every balance,
// so diffing owner balances day over day gives each wallet's net daily
// acquisitions, valued at that day's price → an average cost basis built
// FORWARD from the ledger's first day.
//
// Honest scope (documented in the UI help):
//  - wallets already holding on day 1 have an UNKNOWN cost: they form their own
//    cohort (stored in the `airdrop` column, shown as "coût inconnu") and stay
//    out of the % until they fully exit and re-enter;
//  - one snapshot per day → intraday round-trips are invisible, and a missed
//    run folds two days of net flow at the later day's price;
//  - the % is only published once the known-cost cohort reaches MIN_BUYERS.
// The series therefore measures "buyers since the ledger started", not the
// all-holders % Dune used to return — rows carry source "ledger-forward".
import fs from "fs";
import path from "path";

const STATE_DIR = path.resolve("data/pnl-state/sol");
const MIN_BUYERS = 300;

function loadState(sym) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(STATE_DIR, `${sym}.json`), "utf8"));
    return {
      startDate: s.startDate,
      lastDate: s.lastDate,
      // owner(hex) -> [balanceRaw BigInt, costUsd number | null (unknown)]
      wallets: new Map(Object.entries(s.wallets).map(([o, [b, c]]) => [o, [BigInt(b), c]])),
    };
  } catch { return null; }
}

function saveState(sym, st) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const wallets = {};
  for (const [o, [b, c]] of st.wallets) wallets[o] = [b.toString(), c];
  fs.writeFileSync(path.join(STATE_DIR, `${sym}.json`), JSON.stringify({ startDate: st.startDate, lastDate: st.lastDate, wallets }));
}

// owners: Map(ownerHex -> summed raw balance > 0n) from today's scan.
export function updateSolanaLedger(asset, owners, priceUsd, date) {
  const sym = asset.symbol;
  const dec = 10 ** (asset.holders.decimals ?? 6);
  if (!priceUsd || priceUsd <= 0) throw new Error(`${sym}: no price for the forward ledger`);
  let st = loadState(sym);
  let realized = 0;

  if (!st) {
    // day 1: everyone present has an unknown cost
    st = { startDate: date, lastDate: date, wallets: new Map() };
    for (const [o, b] of owners) st.wallets.set(o, [b, null]);
  } else if (st.lastDate === date) {
    return { skipped: true }; // already folded today (manual re-run)
  } else {
    const next = new Map();
    for (const [o, b] of owners) {
      const prev = st.wallets.get(o);
      if (!prev) { next.set(o, [b, (Number(b) / dec) * priceUsd]); continue; } // entered → bought today
      const [pb, cost] = prev;
      if (b > pb) next.set(o, [b, cost == null ? null : cost + (Number(b - pb) / dec) * priceUsd]);
      else if (b < pb) {
        if (cost != null) {
          const kept = cost * (Number(b) / Number(pb));
          realized += (Number(pb - b) / dec) * priceUsd - (cost - kept);
          next.set(o, [b, kept]);
        } else next.set(o, [b, null]);
      } else next.set(o, prev);
    }
    // wallets gone from the scan sold everything
    for (const [o, [pb, cost]] of st.wallets) {
      if (!owners.has(o) && cost != null) realized += (Number(pb) / dec) * priceUsd - cost;
    }
    st.wallets = next;
    st.lastDate = date;
  }

  // ---- day aggregate (same schema as the EVM/CHOG ledger rows) -------------
  let holders = 0, unknown = 0, buyers = 0, inProfit = 0, x10 = 0, x2 = 0, x1 = 0, l50 = 0, l50p = 0;
  for (const [, [b, cost]] of st.wallets) {
    const tokens = Number(b) / dec;
    if (tokens * priceUsd < 0.01) continue; // dust
    holders++;
    if (cost == null) { unknown++; continue; }
    const avg = tokens > 0 ? cost / tokens : 0;
    if (avg <= 0) { unknown++; continue; }
    buyers++;
    const ratio = priceUsd / avg;
    if (ratio > 1) inProfit++;
    if (ratio >= 10) x10++;
    else if (ratio >= 2) x2++;
    else if (ratio > 1) x1++;
    else if (ratio >= 0.5) l50++;
    else l50p++;
  }
  const row = {
    date, holders, airdrop: unknown, buyers, inProfit,
    pctInProfit: buyers >= MIN_BUYERS ? Number(((inProfit / buyers) * 100).toFixed(2)) : null,
    x10, x2_10: x2, x1_2: x1, l0_50: l50, l50: l50p,
    realizedUsd: Math.round(realized), realizedBigUsd: 0,
    source: "ledger-forward",
  };
  saveState(sym, st);

  // Append to the raw series. Older rows (Dune, all-holders definition, until
  // 2026-07-25) are kept as history; the source tag marks the break.
  const rawFile = path.resolve(`data/raw/pnl/${sym}.json`);
  let series = [];
  try { series = JSON.parse(fs.readFileSync(rawFile, "utf8")).series || []; } catch { /* first run */ }
  series = series.filter((r) => r.date !== date);
  series.push(row);
  series.sort((a, b) => a.date.localeCompare(b.date));
  fs.mkdirSync(path.dirname(rawFile), { recursive: true });
  fs.writeFileSync(rawFile, JSON.stringify({ symbol: sym, source: "ledger-forward", ledgerStart: st.startDate, indexedToDate: date, series }, null, 1));
  return { row, wallets: st.wallets.size, startDate: st.startDate };
}
