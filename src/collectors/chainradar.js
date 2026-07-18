// Chain Radar — discovers the top memes of a chain (Monad, Robinhood) without
// any config, from free keyless sources:
//   GeckoTerminal  : top pools by 24h volume (2 pages/chain) → aggregated per
//                    base token (a token often has several pools)
//   DexScreener    : 24h buy/sell transaction counts + FDV per token
//   Blockscout     : holder count per token (Robinhood only — no Monad explorer)
// Guards: infra/bridged denylist, aggregated-liquidity floor, CHOG pinned.
// X mention tracking for radar tokens is MANUAL ONLY: the list lives in
// data/raw/chainradar/promoted.json (key "tracked") and is edited exclusively
// through the Admin page → collect-manual workflow (scripts/radar-track.js).
// No automatic promotion — every paid cashtag is a deliberate user decision.
import fs from "fs";
import path from "path";
import { ASSETS } from "../config.js";

export const RADAR_CHAINS = [
  // Monad's meme scene lives on nad.fun bonding curves: GT reports the REAL
  // reserve (often tiny vs DexScreener's partly-virtual figure), so the floor
  // is lower there on purpose.
  { chain: "monad", gt: "monad", blockscout: null, liqFloor: 10000 },
  { chain: "robinhood", gt: "robinhood", blockscout: "https://robinhoodchain.blockscout.com", liqFloor: 50000 },
  { chain: "base", gt: "base", blockscout: "https://base.blockscout.com", liqFloor: 50000 },
];
const GT = "https://api.geckoterminal.com/api/v2";
const TOP_KEEP = 50;  // full leaderboard; the UI hides off-criteria rows by default
const MAX_PAGES = 10; // volume-sorted pages are stable-heavy; dig deeper (breaks on empty page)
// Infra / stables / wrapped / bridged externals — not chain-native memes.
const DENY = new Set([
  "USDG", "USDC", "USDT", "DAI", "FDUSD", "USDE", "FRAX", "TUSD",
  "MUSD", "AUSD", "EURW", "GHO", "USDT0", "WNUSDT0", "SYRUPUSDC", "SAVUSD", "SUSDE",
  "WETH", "WBTC", "WMON", "WSOL", "WPOL", "WAVAX", "CBBTC", "STETH", "WSTETH",
  "ETH", "BTC", "SOL", "MON", "VIRTUAL", "LINK", "UNI", "AAVE", "PEPE", "DOGE",
  "XAUT0", "EBTC", "CETES", "CAKE", "LVMON", "SHMON", "APRMON", "GMON", "AERO", "CBETH", "MORPHO", "EURC",
  "APR", "WNWMON", "WNSHMON", "WEETH", "WNWEETH", // Monad infra: Apriori staking + wrapped LSTs
]);
// Stables slip through naming lists — catch them by behaviour too: a price
// pinned near $1/€1 with a flat day is a peg, not a meme.
const stableLike = (t) =>
  /USD|EUR|DAI|GHO|FRAX/i.test(t.symbol) ||
  (t.price != null && t.price > 0.95 && t.price < 1.1 && t.d24 != null && Math.abs(t.d24) < 1);
const PIN = {
  monad: "0x350035555e10d9afaf1566aaebfced5ba6c27777",   // CHOG
  base: "0x532f27101965dd16442e59d40670faf5ebb142e4",    // BRETT (config asset)
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function gtJson(url, tries = 4) {
  for (let i = 1; ; i++) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.ok) return res.json();
    if (i >= tries) throw new Error(`GT HTTP ${res.status}`);
    // free tier rate limit (~30/min) — back off and retry
    await sleep(res.status === 429 ? 20000 * i : 3000 * i);
  }
}

async function discover(cfg) {
  // 2 pages of pools sorted by 24h volume, aggregated per base token.
  const byToken = new Map();
  for (let page = 1; page <= MAX_PAGES; page++) {
    let j;
    try {
      j = await gtJson(`${GT}/networks/${cfg.gt}/pools?sort=h24_volume_usd_desc&page=${page}`);
    } catch (e) {
      console.error(`  [radar] ${cfg.chain} page ${page}: ${e.message} — stopping pagination`);
      break;
    }
    if (!(j.data || []).length) break;
    for (const p of j.data || []) {
      const at = p.attributes;
      const address = (p.relationships?.base_token?.data?.id || "").replace(cfg.gt + "_", "").toLowerCase();
      if (!address) continue;
      const symbol = (at.name || "").split(" / ")[0].trim().toUpperCase();
      const liq = Number(at.reserve_in_usd) || 0;
      const vol = Number(at.volume_usd?.h24) || 0;
      const cur = byToken.get(address) || {
        address, symbol, liq: 0, vol: 0, pools: 0,
        price: null, d24: null, bestLiq: 0, age: null,
      };
      cur.liq += liq;
      cur.vol += vol;
      cur.pools++;
      const created = at.pool_created_at?.slice(0, 10) || null;
      if (created && (!cur.age || created < cur.age)) cur.age = created;
      if (liq > cur.bestLiq) {
        cur.bestLiq = liq;
        cur.price = Number(at.base_token_price_usd) || null;
        cur.d24 = at.price_change_percentage?.h24 != null ? Number(at.price_change_percentage.h24) : null;
        cur.symbol = symbol || cur.symbol;
      }
      byToken.set(address, cur);
    }
    await sleep(600);
  }
  // Infra/stables/RWAs are noise, not memes: excluded outright. Below-floor
  // liquidity only FLAGS the token (crit) — the UI shows the full leaderboard
  // with off-criteria rows hidden by default.
  // (Tokenized RWAs like Kraken's K-forex land here too — their 1-20 holders
  // trip the <50-holders flag, so they stay hidden without a fragile
  // volume/flat-price heuristic that once caught CASHCAT on a calm day.)
  let toks = [...byToken.values()].filter((t) => !DENY.has(t.symbol) && !stableLike(t));
  const kept = toks
    .sort((a, b) => b.vol - a.vol)
    .slice(0, TOP_KEEP);
  for (const t of kept) if (t.liq < (cfg.liqFloor ?? 50000)) t.crit = "liq";
  // pin CHOG on its chain even below the floor / outside the top pages
  const pin = PIN[cfg.chain];
  if (pin) {
    const f = kept.find((t) => t.address === pin);
    if (f) f.pinned = true;
    else {
      let src = byToken.get(pin);
      if (!src) {
        try {
          const j = await gtJson(`${GT}/networks/${cfg.gt}/tokens/${pin}/pools`);
          const p = (j.data || [])[0]?.attributes;
          if (p) {
            src = {
              address: pin,
              symbol: (p.name || "").split(" / ")[0].trim().toUpperCase(),
              liq: Number(p.reserve_in_usd) || 0,
              vol: Number(p.volume_usd?.h24) || 0,
              pools: 1,
              price: Number(p.base_token_price_usd) || null,
              d24: p.price_change_percentage?.h24 != null ? Number(p.price_change_percentage.h24) : null,
              age: p.pool_created_at?.slice(0, 10) || null,
            };
          }
        } catch { /* pin is best-effort */ }
      }
      if (src) kept.push({ ...src, pinned: true });
    }
  }
  return kept;
}

async function enrichDex(tok) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tok.address}`);
    if (!res.ok) return;
    const { pairs = [] } = await res.json();
    let buys = 0, sells = 0, fdv = null;
    for (const p of pairs) {
      buys += p.txns?.h24?.buys || 0;
      sells += p.txns?.h24?.sells || 0;
      if (fdv == null && p.fdv) fdv = p.fdv;
      // social links (telegram/discord/twitter) ride on the pair info
      for (const soc of p.info?.socials || []) {
        const ty = (soc.type || soc.platform || "").toLowerCase();
        const url = soc.url || soc.handle;
        if (!url) continue;
        if (ty.includes("telegram") && !tok.tgUrl) tok.tgUrl = url;
        if (ty.includes("discord") && !tok.dcUrl) tok.dcUrl = url;
        if (ty.includes("twitter") && !tok.twUrl) tok.twUrl = url;
      }
    }
    tok.buys = buys;
    tok.sells = sells;
    tok.fdv = fdv;
  } catch { /* enrich is best-effort */ }
}

// Community sizes from the captured links — same free tricks as the screener:
// Discord invite API for member counts; Telegram public page scraped for the
// "xx members" meta. Both best-effort.
async function enrichSocialCounts(tok) {
  if (tok.dcUrl) {
    const code = /discord(?:\.gg|(?:app)?\.com\/invite)\/([A-Za-z0-9-]+)/i.exec(tok.dcUrl)?.[1];
    if (code) {
      try {
        const res = await fetch(`https://discord.com/api/v10/invites/${encodeURIComponent(code)}?with_counts=true`,
          { headers: { "User-Agent": "chog-dash/1.0" } });
        if (res.ok) {
          const j = await res.json();
          if (j.approximate_member_count != null) tok.dcMembers = j.approximate_member_count;
        }
      } catch { /* best-effort */ }
    }
  }
  if (tok.tgUrl) {
    const name = /t\.me\/(?:s\/)?([A-Za-z0-9_]+)/i.exec(tok.tgUrl)?.[1];
    if (name) {
      try {
        const res = await fetch(`https://t.me/${name}`, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (res.ok) {
          const html = await res.text();
          const m = /([\d\s ,.]+)\s*(?:members|subscribers)/i.exec(html);
          if (m) {
            const n = Number(m[1].replace(/[^\d]/g, ""));
            if (n > 0) tok.tgMembers = n;
          }
        }
      } catch { /* best-effort */ }
    }
  }
}

async function enrichHolders(tok, base) {
  try {
    const res = await fetch(`${base}/api/v2/tokens/${tok.address}`, { headers: { "User-Agent": "chog-dash/1.0" } });
    if (!res.ok) return;
    const j = await res.json();
    const h = j.holders ?? j.holders_count;
    if (h != null) tok.holders = Number(h);
  } catch { /* holders are best-effort */ }
}

export async function collectChainRadar() {
  const out = {};
  for (const cfg of RADAR_CHAINS) {
    const toks = await discover(cfg);
    for (const t of toks) {
      await enrichDex(t);
      if (cfg.blockscout) await enrichHolders(t, cfg.blockscout);
      await enrichSocialCounts(t);
      await sleep(300);
    }
    // A "community" of <50 holders is a rug or a sniper pool, not a meme —
    // flagged (crit) where a Blockscout gave us the count.
    for (const t of toks) {
      if (!t.pinned && t.holders != null && t.holders < 50) t.crit = t.crit ? t.crit + "+holders" : "holders";
    }
    out[cfg.chain] = toks.map((t) => ({
      address: t.address, symbol: t.symbol, price: t.price, liq: Math.round(t.liq),
      vol: Math.round(t.vol), d24: t.d24, pools: t.pools, age: t.age,
      buys: t.buys ?? null, sells: t.sells ?? null, fdv: t.fdv ?? null,
      holders: t.holders ?? null,
      tgMembers: t.tgMembers ?? null, dcMembers: t.dcMembers ?? null,
      tgUrl: t.tgUrl ?? null, dcUrl: t.dcUrl ?? null, twUrl: t.twUrl ?? null,
      crit: t.crit ?? null,
      ...(t.pinned ? { pinned: true } : {}),
    }));
  }
  return out;
}

// ---- manual mention-tracking list ----------------------------------------
// Which radar tokens get their cashtag counted on X every day. Managed ONLY
// via scripts/radar-track.js (Admin → collect-manual workflow) — no automatic
// promotion. Each tracked token costs ~$0.005/day of X counts.
const TRACK_FILE = path.resolve("data/raw/chainradar/promoted.json");
// Collision blacklist: cashtags owned by majors — a "$SOL" radar token would
// count Solana's noise, not its own.
export const CASHTAG_DENY = new Set(["SOL", "ETH", "BTC", "BNB", "XRP", "ADA", "DOGE", "TON", "TRX", "SUI", "MON", "TAO", "OP", "ARB"]);
export const CONFIG_SYMS = new Set(ASSETS.map((a) => a.symbol.toUpperCase()));
// Config assets (CHOG, CASHCAT, BRETT…) already have their mentions collected —
// tracking them would pay twice for the same cashtag; the build joins their
// existing series onto the radar token instead.
export const saneCashtag = (sym) => /^[A-Z0-9]{3,12}$/.test(sym) && !CASHTAG_DENY.has(sym) && !CONFIG_SYMS.has(sym);

export function loadTracked() {
  try {
    const st = JSON.parse(fs.readFileSync(TRACK_FILE, "utf8"));
    return st.tracked || st.promoted || []; // legacy key from the removed funnel
  } catch { return []; }
}
export function saveTracked(list) {
  fs.mkdirSync(path.dirname(TRACK_FILE), { recursive: true });
  fs.writeFileSync(TRACK_FILE, JSON.stringify({ tracked: list }, null, 2));
}
// kept as an alias — collect-mentions.js consumes it
export const loadPromoted = loadTracked;
