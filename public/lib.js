/* Shared library for all views (screener, asset, signals).
   Loaded as a classic script before each view script — its top-level
   consts/functions are visible to the scripts that follow on the page. */

// Fixed per-symbol colours (identity follows the entity, never its rank).
const COLORS = {
  CHOG: "#836ef9", PEPE: "#37a537", WIF: "#e0a000", BONK: "#f07530",
  BRETT: "#3987e5", PENGU: "#2ec8e6", FARTCOIN: "#9ccc4a", ANSEM: "#ef5350",
  CASHCAT: "#43c59e",
  MON: "#836ef9", BTC: "#f07530", ETH: "#3987e5", SOL: "#17b8a6",
  XRP: "#b0bec5", SUI: "#2ec8e6", HYPE: "#35e0a5", TAO: "#e0559a",
  AKT: "#ef5350", STRK: "#a98bf0", GRAM: "#0098ea",
  UTYA: "#f5c518", GROYP: "#7cb342", GRAMMING: "#26c6da",
  BUDDY: "#c77b48", TELECLAW: "#ec407a", CHERRY: "#e53935",
};
const colorOf = (sym) => COLORS[sym] || "#836ef9";

const CSS = getComputedStyle(document.documentElement);
const ink = (name) => CSS.getPropertyValue(name).trim();

const GROUP_LABEL = { memes: "Memecoins", majors: "Cryptos majeures" };

// ---- formatting ---------------------------------------------------------
function fmtCompact(n) {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString("en-US");
}
function fmtPrice(p) {
  if (p == null) return "—";
  if (p >= 1000) return "$" + p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (p >= 1) return "$" + p.toFixed(2);
  if (p >= 0.01) return "$" + p.toFixed(4);
  return "$" + p.toPrecision(3);
}
function fmtDelta(pct) {
  if (pct == null) return "—";
  const a = Math.abs(pct);
  const arrow = pct >= 0 ? "▲" : "▼";
  // New/low-baseline series (e.g. a token's first days) produce astronomical
  // %-changes; render those compactly so they don't blow up the layout.
  if (a >= 1000) return `${arrow} ${fmtCompact(a)}%`;
  return `${arrow} ${a.toFixed(1)}%`;
}
function fmtUsdCompact(n) {
  return n == null ? "—" : "$" + fmtCompact(n);
}
// Format a value by a registry format id.
function fmtBy(format, v) {
  if (format === "usd") return fmtUsdCompact(v);
  if (format === "price") return fmtPrice(v);
  if (format === "num") return fmtCompact(v);
  if (format === "pct") return fmtDelta(v);
  if (format === "score") return v == null ? "—" : Math.round(v).toString();
  if (format === "z") return v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1) + "σ";
  if (format === "pctraw") return v == null ? "—" : v.toFixed(1) + "%"; // a 0-100 level, not a delta
  if (format === "signed") return v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2);
  return v == null ? "—" : String(v);
}

// ---- series helpers -----------------------------------------------------
function pctOverDays(series, key, days) {
  if (!series || series.length < 2) return null;
  const last = series[series.length - 1];
  if (last[key] == null) return null;
  const target = new Date(last.date + "T00:00:00Z");
  target.setUTCDate(target.getUTCDate() - days);
  const targetDate = target.toISOString().slice(0, 10);
  let ref = null;
  for (const p of series) if (p.date <= targetDate && p[key] != null) ref = p;
  if (!ref || ref[key] === 0) return null;
  return ((last[key] - ref[key]) / ref[key]) * 100;
}
// Base-100 needs a MEANINGFUL base. Young series often open with launch dust —
// Monad's TVL starts at $1.00 before reaching $529M, so indexing on that $1
// yields 5e10 and flattens every other line on the chart. Ignore leading points
// that are negligible (<0.1%) vs the window's median before picking the base.
function indexBase(values) {
  const pos = values.filter((v) => v != null && v > 0).sort((a, b) => a - b);
  if (!pos.length) return null;
  const med = pos[Math.floor(pos.length / 2)];
  const floor = med * 0.001;
  return values.find((v) => v != null && v > 0 && v >= floor) ?? pos[0];
}
function indexSeries(points, key) {
  const base = indexBase(points.map((p) => p[key]));
  if (!base) return points.map(() => null);
  return points.map((p) => (p[key] == null ? null : (p[key] / base) * 100));
}
function windowed(series, windowDays) {
  if (!series || !series.length || !isFinite(windowDays)) return series || [];
  const last = new Date(series[series.length - 1].date + "T00:00:00Z");
  const cutoff = new Date(last);
  cutoff.setUTCDate(cutoff.getUTCDate() - windowDays);
  const cut = cutoff.toISOString().slice(0, 10);
  return series.filter((p) => p.date >= cut);
}
function indexedWindowed(asset, seriesName, vkey, dates, windowDays) {
  const w = windowed(asset[seriesName], windowDays);
  const by = new Map(w.map((p) => [p.date, p[vkey]]));
  const raw = dates.map((d) => ({ v: by.has(d) ? by.get(d) : null }));
  return indexSeries(raw, "v");
}

// ---- correlation --------------------------------------------------------
function pearson(pairs) {
  const n = pairs.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) { sx += x; sy += y; sxy += x * y; sxx += x * x; syy += y * y; }
  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  if (vx <= 0 || vy <= 0) return null;
  return cov / Math.sqrt(vx * vy);
}
// Correlation of DAILY CHANGES, not of levels. Correlating raw levels of two
// trending series returns ~±1 whatever the truth (two independent random walks
// that both drift score |r|≈0.95), so it invents relationships. Comparing the
// day-to-day moves answers the real question: when A moves, does B move too?
// Young tokens also produce absurd launch-day returns (a listing at ~0 gives
// +34,000,000%), so returns are winsorized to ±50%/day before correlating.
function corrReturns(seriesA, keyA, seriesB, keyB, windowDays) {
  const wa = windowed(seriesA, windowDays);
  const wb = windowed(seriesB, windowDays);
  const bBy = new Map(wb.map((p) => [p.date, p[keyB]]));
  const clip = (r) => Math.max(-0.5, Math.min(0.5, r));
  const pairs = [];
  let prev = null;
  for (const p of wa) {
    const va = p[keyA], vb = bBy.get(p.date);
    if (va == null || vb == null) continue;
    if (prev && prev.a > 0 && prev.b > 0) {
      pairs.push([clip(va / prev.a - 1), clip(vb / prev.b - 1)]);
    }
    prev = { a: va, b: vb };
  }
  return { r: pearson(pairs), n: pairs.length };
}

// ---- Information Coefficient (does a signal PREDICT the future?) --------
// The correlation heatmap answers "what moves together" (simultaneous). The IC
// answers "what predicts": Spearman rank-correlation between the signal at t and
// the price return over t→t+k. Rank-based, so robust to outliers/non-linearity.
// Industry rule of thumb: |IC| > 0.05 = economically meaningful for a daily
// signal; IR (mean/σ of the IC) > 0.5 = strong.
function addDaysISO(dateStr, k) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
}
function rankOf(values) {
  const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(values.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1; // average rank for ties
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
function spearman(pairs, minN = 12) {
  if (!pairs || pairs.length < minN) return null;
  const rx = rankOf(pairs.map((p) => p[0]));
  const ry = rankOf(pairs.map((p) => p[1]));
  return pearson(rx.map((v, i) => [v, ry[i]]));
}
// date -> forward simple return over k calendar days (small gap tolerance so a
// missing weekend/collection day doesn't drop the point).
function forwardReturns(prices, k) {
  const by = new Map((prices || []).map((p) => [p.date, p.price]));
  const out = new Map();
  for (const p of prices || []) {
    if (!(p.price > 0)) continue;
    let f = null;
    for (let j = 0; j <= 3 && f == null; j++) f = by.get(addDaysISO(p.date, k + j));
    if (f != null) out.set(p.date, f / p.price - 1);
  }
  return out;
}
// Time-series IC for one asset: pair each signal_t with the return t→t+k.
function icTimeSeries(signalMap, prices, k, minN = 20) {
  if (!signalMap || !signalMap.size) return { ic: null, n: 0 };
  const fr = forwardReturns(prices, k);
  const pairs = [];
  for (const [d, v] of signalMap) { const f = fr.get(d); if (f != null) pairs.push([v, f]); }
  return { ic: spearman(pairs, minN), n: pairs.length };
}
// Pooled IC: stack every (signal_t, forward return) pair across a set of assets
// — the headline "does this signal work overall?" number.
function icPooled(assets, buildSignal, k, minN = 40) {
  const pairs = [];
  for (const a of assets) {
    const sig = buildSignal(a);
    if (!sig) continue;
    const fr = forwardReturns(a.prices, k);
    for (const [d, v] of sig) { const f = fr.get(d); if (f != null) pairs.push([v, f]); }
  }
  return { ic: spearman(pairs, minN), n: pairs.length };
}

// ---- z-scores / signal indicators --------------------------------------
// Per-day z-score of `key` vs its trailing WIN-day mean/stddev, keyed by date.
// z = (today − meanWIN) / stdWIN. A high z = a value far above the asset's own
// normal — comparable across assets of any size.
function zScoreByDate(series, key, WIN = 30, MIN = 10) {
  const s = (series || []).filter((p) => p[key] != null);
  const out = new Map();
  for (let i = 0; i < s.length; i++) {
    const win = s.slice(Math.max(0, i - WIN), i).map((p) => p[key]); // trailing, excludes today
    if (win.length < MIN) continue;
    const mean = win.reduce((a, b) => a + b, 0) / win.length;
    const std = Math.sqrt(win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length);
    if (std > 0) out.set(s[i].date, (s[i][key] - mean) / std);
  }
  return out;
}

// Buzz Score (M4): z-score of daily mentions. z > +2σ = attention spike.
function buzzSeries(asset) {
  return [...zScoreByDate(asset.mentions, "count").entries()]
    .map(([date, buzz]) => ({ date, buzz }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Attention/Price Divergence (M5-lite): normalized attention minus normalized
// price, same z-score method. High positive = attention far above its norm
// while price isn't → silent accumulation (attention leading price). Negative =
// price running ahead of attention.
function divergenceSeries(asset) {
  const mz = zScoreByDate(asset.mentions, "count");
  const pz = zScoreByDate(asset.prices, "price");
  const out = [];
  for (const [date, m] of mz) if (pz.has(date)) out.push({ date, div: m - pz.get(date) });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
function lastValue(series, key) {
  if (!series) return null;
  for (let i = series.length - 1; i >= 0; i--) if (series[i][key] != null) return series[i][key];
  return null;
}

// ---- signal zones & per-asset verdict (the trader layer) ----------------
// Canonical overheating thresholds, MEASURED on our own history (edge = a
// zone's median forward return minus the pooled median, memes). Shared by the
// Studio sub-pane bands (studio-core reads these), the gauges and the verdict.
// Each zone: bull (green, favourable) · bear (red, overheat/distribution) ·
// warn (orange) · mid (reference). `edge` is the display note.
const SIGNAL_ZONES = {
  flowratio: { label: "Pression achat", fmt: (v) => v.toFixed(0) + "%", lo: 40, hi: 60,
    bands: [{ v: 52, kind: "bull", edge: "+5pp/30j" }, { v: 50, kind: "mid" }, { v: 48, kind: "bear", edge: "−4pp" }] },
  divergence: { label: "Divergence", fmt: (v) => (v >= 0 ? "+" : "") + v.toFixed(2), lo: -3, hi: 3,
    bands: [{ v: 1, kind: "bull", edge: "+3pp/30j" }, { v: 0, kind: "mid" }, { v: -1.7, kind: "bear", edge: "−14pp" }] },
  rsi: { label: "RSI 14", fmt: (v) => v.toFixed(0), lo: 0, hi: 100,
    bands: [{ v: 65, kind: "bear", edge: "−23pp/30j, 15% win" }, { v: 50, kind: "mid" }, { v: 30, kind: "bull", edge: "rebond court" }] },
  // Recalibré: 0% de win historique dès 40% d'acheteurs en gain (pas 50%).
  inprofit: { label: "% en gain", fmt: (v) => v.toFixed(0) + "%", lo: 0, hi: 100,
    bands: [{ v: 40, kind: "bear", edge: "−37%/30j, 0% win" }, { v: 25, kind: "warn" }, { v: 20, kind: "bull", edge: "45% win" }] },
  composite: { label: "Composite", fmt: (v) => String(Math.round(v)), lo: 0, hi: 100,
    bands: [{ v: 65, kind: "bull" }, { v: 50, kind: "mid" }, { v: 35, kind: "bear" }] },
  buzz: { label: "Buzz", fmt: (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + "σ", lo: -2, hi: 3,
    bands: [{ v: 2, kind: "warn", edge: "pic" }] },
};
const ZONE_HEX = { bear: "#ff5c6c", bull: "#2fbf71", warn: "#e0a000", mid: "#5a5570", neutral: "#8a84a6" };

// Latest Wilder-ish RSI(14) from a price series.
function rsiLast(prices, period = 14) {
  const pr = (prices || []).filter((p) => p.price != null).map((p) => p.price);
  if (pr.length < period + 1) return null;
  let g = 0, l = 0;
  for (let i = pr.length - period; i < pr.length; i++) {
    const ch = pr[i] - pr[i - 1];
    if (ch >= 0) g += ch; else l -= ch;
  }
  const ag = g / period, al = l / period;
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}

// ---- Divergence confirmée (signal d'entrée backtesté) -------------------
// Backtest finding (memes, 2023→2026, 8 assets): the *level* of SMA7(divergence)
// has ~0 IC and staying ≥+2 actually mean-reverts DOWN. What pays is the MOMENT
// SMA7(div) CROSSES UP through +2 WHILE momentum confirms (RSI>50): fwd returns
// +9%/7j, +13%/14j, +8%/30j at 55-59% win vs a −3%/−8% baseline. The RSI gate is
// essential — the same cross without it is worthless. n=22 events → a live
// hypothesis to track, not a certainty (that's why the harness recomputes it).
const DIVCONF_DEFAULT = { sma: 7, thr: 2, rsiFloor: 50, rsiCeil: 100, cross: true };
const medianOf = (arr) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Full Wilder RSI(14) series → Map(date -> rsi). Companion to rsiLast.
function rsiSeriesMap(prices, period = 14) {
  const p = (prices || []).filter((x) => x.price > 0);
  const out = new Map();
  if (p.length < period + 1) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) { const ch = p[i].price - p[i - 1].price; if (ch >= 0) g += ch; else l -= ch; }
  let ag = g / period, al = l / period;
  const rv = () => (al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  out.set(p[period].date, rv());
  for (let i = period + 1; i < p.length; i++) {
    const ch = p[i].price - p[i - 1].price, up = ch > 0 ? ch : 0, dn = ch < 0 ? -ch : 0;
    ag = (ag * (period - 1) + up) / period; al = (al * (period - 1) + dn) / period;
    out.set(p[i].date, rv());
  }
  return out;
}
// Trailing SMA over a [{date,[key]}] series → Map(date -> mean of last n).
function smaMap(series, key, n) {
  const s = (series || []).filter((p) => p[key] != null);
  const out = new Map();
  for (let i = n - 1; i < s.length; i++) {
    let sum = 0; for (let j = i - n + 1; j <= i; j++) sum += s[j][key];
    out.set(s[i].date, sum / n);
  }
  return out;
}
// The confirmed-divergence entry signal for one asset (params tunable by the
// harness). Returns { fires:Map(date->1), rows:[{date,sma,rsi}], status }.
function divConfSignal(a, params) {
  const { sma, thr, rsiFloor, rsiCeil, cross } = { ...DIVCONF_DEFAULT, ...(params || {}) };
  const smaM = smaMap(a.divergence, "div", sma);
  const rsiM = rsiSeriesMap(a.prices);
  const dates = [...smaM.keys()].sort();
  const fires = new Map(), rows = [];
  let prev = null, lastFire = null;
  for (const d of dates) {
    const s = smaM.get(d), r = rsiM.get(d) ?? null;
    rows.push({ date: d, sma: s, rsi: r });
    const trig = cross ? (prev != null && prev < thr && s >= thr) : s >= thr;
    const rsiOk = r != null && r > rsiFloor && r <= rsiCeil;
    if (trig && rsiOk) { fires.set(d, 1); lastFire = d; }
    prev = s;
  }
  const last = rows.at(-1) || null;
  const inSetup = !!(last && last.sma >= thr && last.rsi != null && last.rsi > rsiFloor && last.rsi <= rsiCeil);
  return { fires, rows, status: { firingToday: last ? fires.has(last.date) : false, inSetup, lastFire, curSma: last?.sma ?? null, curRsi: last?.rsi ?? null } };
}
// Aggregate the fire events across assets vs the all-days baseline, per horizon.
// Returns { rule:{h:{n,win,med}}, base:{h:{...}}, events, assets, byAsset:[...] }.
function backtestEntry(assets, params, horizons = [7, 14, 30]) {
  const per = {}, baseArr = {};
  for (const h of horizons) { per[h] = []; baseArr[h] = []; }
  const evAssets = new Set(); const byAsset = [];
  for (const a of assets) {
    const { fires } = divConfSignal(a, params);
    const fr = {}; for (const h of horizons) fr[h] = forwardReturns(a.prices, h);
    let n = 0;
    for (const [d] of fires) {
      const h0 = fr[horizons[0]].get(d);
      if (h0 != null) { n++; evAssets.add(a.symbol); }
      for (const h of horizons) { const f = fr[h].get(d); if (f != null) per[h].push(f); }
    }
    if (n) byAsset.push({ symbol: a.symbol, n });
    for (const h of horizons) for (const [, v] of fr[h]) baseArr[h].push(v);
  }
  const stat = (arr) => arr.length ? { n: arr.length, win: arr.filter((x) => x > 0).length / arr.length, med: medianOf(arr) } : { n: 0, win: null, med: null };
  const rule = {}, base = {};
  for (const h of horizons) { rule[h] = stat(per[h]); base[h] = stat(baseArr[h]); }
  return { rule, base, events: [...evAssets].length ? per[horizons[0]].length : 0, assets: evAssets.size, byAsset: byAsset.sort((a, b) => b.n - a.n) };
}
// Median forward-return grid over (SMA7-div bin × RSI bin) — the div×RSI heatmap.
function divRsiGrid(assets, { sma = 7, horizon = 30, minCell = 8 } = {}) {
  const dbins = [[-1e9, -1], [-1, 0], [0, 1], [1, 2], [2, 1e9]];
  const rbins = [[0, 40], [40, 50], [50, 65], [65, 101]];
  const cells = dbins.map(() => rbins.map(() => []));
  for (const a of assets) {
    const smaM = smaMap(a.divergence, "div", sma);
    const rsiM = rsiSeriesMap(a.prices);
    const fr = forwardReturns(a.prices, horizon);
    for (const [d, s] of smaM) {
      const r = rsiM.get(d), f = fr.get(d);
      if (r == null || f == null) continue;
      const di = dbins.findIndex(([lo, hi]) => s >= lo && s < hi);
      const ri = rbins.findIndex(([lo, hi]) => r >= lo && r < hi);
      if (di >= 0 && ri >= 0) cells[di][ri].push(f);
    }
  }
  return { dbins, rbins, grid: cells.map((row) => row.map((arr) => (arr.length >= minCell ? { med: medianOf(arr), n: arr.length } : { med: null, n: arr.length }))) };
}

// Buy/sell signal EVENTS (dated, with the price of the day) — for drawing on a
// chart AND for the per-asset backtest (same rule, so the eye can verify the
// numbers). BUY = SMA(div) triggers up through +thr with RSI in [buyLo,buyHi];
// SELL = down through −thr with RSI in [sellLo,sellHi]. Defaults from the pooled
// backtest (an up-cross confirmed by momentum, RSI>50); mirror for sells. All
// tunable so the per-asset backtest — or the user's eyes — pick what works.
// BREAKOUT preset — the rare high-conviction entry (up-cross of +thr confirmed
// by momentum, RSI>50). SWING preset — the oscillator round-trip validated with
// the user: buy each up-cross of 0 while price is still weak (RSI≤50, dip-buy),
// exit on the next down-cross of 0. The RSI direction flips between them ON
// PURPOSE (confirm a breakout vs. fade a dip) — that's the whole reconciliation.
const DIVSIG_DEFAULT = { mode: "breakout", sma: 7, thr: 2, cross: true, buyLo: 50, buyHi: 100, sellLo: 0, sellHi: 50 };
const DIVSIG_SWING = { mode: "swing", sma: 7, swLo: 0, swHi: 0, swRsiMax: 50 };
function divSignals(a, params) {
  const p = { ...DIVSIG_DEFAULT, ...(params || {}) };
  const smaM = smaMap(a.divergence, "div", p.sma);
  const rsiM = rsiSeriesMap(a.prices);
  const priceBy = new Map((a.prices || []).map((x) => [x.date, x.price]));
  const dates = [...smaM.keys()].sort();
  const buys = [], sells = [];
  let prev = null;
  if (p.mode === "swing") {
    // Alternating dip-buy / exit oscillator (matches a real swing trader).
    let long = false;
    for (const d of dates) {
      const s = smaM.get(d), r = rsiM.get(d), px = priceBy.get(d) ?? null;
      if (!long && prev != null && prev < p.swLo && s >= p.swLo) {
        if (p.swRsiMax >= 100 || (r != null && r <= p.swRsiMax)) { buys.push({ date: d, price: px, rsi: r, sma: s }); long = true; }
      } else if (long && prev != null && prev > p.swHi && s <= p.swHi) {
        sells.push({ date: d, price: px, rsi: r, sma: s }); long = false;
      }
      prev = s;
    }
  } else {
    for (const d of dates) {
      const s = smaM.get(d), r = rsiM.get(d), px = priceBy.get(d) ?? null;
      const up = p.cross ? (prev != null && prev < p.thr && s >= p.thr) : s >= p.thr;
      const dn = p.cross ? (prev != null && prev > -p.thr && s <= -p.thr) : s <= -p.thr;
      if (up && r != null && r >= p.buyLo && r <= p.buyHi) buys.push({ date: d, price: px, rsi: r, sma: s });
      if (dn && r != null && r >= p.sellLo && r <= p.sellHi) sells.push({ date: d, price: px, rsi: r, sma: s });
      prev = s;
    }
  }
  return { buys, sells };
}
// ---- Configurable strategy engine (Studio « Stratégie ») -----------------
// User-tunable rule: BUY when SMA(divergence) crosses UP through `buyLevel`
// (la borne haute) with every buy condition true; SELL the open position when
// it crosses DOWN through `sellLevel` (la borne basse) with the sell
// conditions true. Conditions pick any indicator below with </> and a value —
// the lab for "does RSI<50 or % en gain<20 make the call better?".
const STRAT_DEFAULT = {
  divType: "ema", divPeriod: 9, // smoothing of the divergence line (EMA 9 by default)
  buyLevel: 0, sellLevel: 0,    // borne haute (achat) / borne basse (vente)
  buyConds: [{ ind: "rsi", op: "<", val: 50 }], sellConds: [],
  capital: 1000,
  buyPct: 100, sellPct: 100,    // money management: share of CASH per buy, of POSITION per sell
  scaleIn: false, scaleOut: false, scaleEvery: 1, maxTranches: 3, // « lisser » while conditions hold
  noAvgDown: false,             // refuse to add below the position's average cost
  buyCooldown: 0,               // minimum days between two buys (0 = off)
};
const STRAT_PRESETS = [
  { id: "swing", label: "Swing (défaut)", strat: () => structuredClone(STRAT_DEFAULT) },
  { id: "swing3", label: "Swing fractionné ⅓", strat: () => ({ ...structuredClone(STRAT_DEFAULT), buyPct: 33, sellPct: 50, scaleIn: true, scaleEvery: 3, maxTranches: 3 }) },
  { id: "breakout", label: "Breakout (SMA7 ±2)", strat: () => ({ ...structuredClone(STRAT_DEFAULT), divType: "sma", divPeriod: 7, buyLevel: 2, sellLevel: -2, buyConds: [{ ind: "rsi", op: ">", val: 50 }] }) },
];
// Exponential moving average over a [{date,[key]}] series → Map(date -> ema),
// seeded on the first `n` values (same convention as the Studio's EMA study).
function emaMap(series, key, n) {
  const s = (series || []).filter((p) => p[key] != null);
  const out = new Map();
  if (s.length < n) return out;
  const k = 2 / (n + 1);
  let e = 0;
  for (let i = 0; i < n; i++) e += s[i][key];
  e /= n;
  out.set(s[n - 1].date, e);
  for (let i = n; i < s.length; i++) { e = s[i][key] * k + e * (1 - k); out.set(s[i].date, e); }
  return out;
}
// Price distance to its own SMA/EMA, in % — the comparable way to use a moving
// average as a CONDITION (an absolute MA level means nothing across assets).
function maDistMap(prices, n, type) {
  const p = (prices || []).filter((x) => x.price > 0);
  const src = p.map((x) => ({ date: x.date, v: x.price }));
  const m = type === "ema" ? emaMap(src, "v", n) : smaMap(src, "v", n);
  const out = new Map();
  for (const x of p) { const mv = m.get(x.date); if (mv > 0) out.set(x.date, (x.price / mv - 1) * 100); }
  return out;
}
// Rate of change over n days, in % — the direct "don't catch a falling knife"
// gauge: negative means the price is still below where it was n days ago.
function rocMap(prices, n) {
  const p = (prices || []).filter((x) => x.price > 0);
  const out = new Map();
  for (let i = n; i < p.length; i++) if (p[i - n].price > 0) out.set(p[i].date, (p[i].price / p[i - n].price - 1) * 100);
  return out;
}
// Distance to the lowest low / highest high of the last n days, in %.
function extremeDistMap(prices, n, which) {
  const p = (prices || []).filter((x) => x.price > 0);
  const out = new Map();
  for (let i = n; i < p.length; i++) {
    let ext = which === "low" ? Infinity : -Infinity;
    for (let j = i - n; j < i; j++) {
      if (which === "low") { if (p[j].price < ext) ext = p[j].price; }
      else if (p[j].price > ext) ext = p[j].price;
    }
    if (Number.isFinite(ext) && ext > 0) out.set(p[i].date, (p[i].price / ext - 1) * 100);
  }
  return out;
}
// The smoothed divergence line the triggers read.
function divLineMap(a, st) {
  const n = Math.max(2, Number(st.divPeriod) || 9);
  return st.divType === "sma" ? smaMap(a.divergence, "div", n) : emaMap(a.divergence, "div", n);
}
// ---- higher-timeframe conditions (« RSI14 weekly de BTC > 50 ») ----------
// Self-contained here on purpose: lib.js ships on pages that never load the
// Studio core, so it must not depend on that file's resampling helpers.
const HTF_LABEL = { D: "J", W: "S", M: "M" };
function htfKey(dateStr, tf) {
  if (tf === "M") return dateStr.slice(0, 7) + "-01";
  if (tf === "W") {
    const d = new Date(dateStr + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
    return d.toISOString().slice(0, 10);
  }
  return dateStr;
}
// Rows → one row per bucket carrying the bucket's CLOSE (last row). Volume is
// summed instead, the OHLCV convention (a week's volume is its total, not its
// last day's).
function resampleLast(rows, tf) {
  if (!rows?.length || tf === "D") return rows || [];
  const by = new Map();
  for (const r of rows) {
    const k = htfKey(r.date, tf);
    const prev = by.get(k);
    const row = { ...r, date: k };
    if (prev && r.volume != null) row.volume = (prev.volume || 0) + r.volume;
    by.set(k, row);
  }
  return [...by.values()];
}
// A shadow asset whose series are resampled — the indicator is then computed ON
// the weekly/monthly bars (a weekly RSI14 spans 14 weeks, not 14 days).
function resampleAsset(asset, tf) {
  if (tf === "D") return asset;
  const out = { symbol: asset.symbol };
  for (const k of ["prices", "pnl", "tradeflow", "buzz", "holderTiers", "holders", "divergence"]) {
    out[k] = resampleLast(asset[k], tf);
  }
  return out;
}
// Project a bucket-keyed map onto daily dates using the LAST CLOSED bucket:
// a date inside week W reads week W−1. Buckets are keyed by their first day, so
// reading the current bucket would leak that week's close backwards — exactly
// the look-ahead that makes a backtest lie.
function expandHtf(m, tf, dailyDates) {
  if (tf === "D") return m;
  const keys = [...m.keys()].sort();
  const out = new Map();
  let i = -1;
  for (const d of dailyDates) {
    const bk = htfKey(d, tf);
    while (i + 1 < keys.length && keys[i + 1] < bk) i++;
    if (i >= 0) out.set(d, m.get(keys[i]));
  }
  return out;
}

// Indicator sources a condition can read. `period` (when present) makes the
// source parameterised — the condition row then shows a period input.
const COND_SOURCES = {
  rsi: { label: "RSI 14", get: (a) => rsiSeriesMap(a.prices) },
  smaDist: { label: "Prix vs SMA (%)", period: 20, get: (a, n) => maDistMap(a.prices, n, "sma") },
  emaDist: { label: "Prix vs EMA (%)", period: 9, get: (a, n) => maDistMap(a.prices, n, "ema") },
  roc: { label: "Momentum N j (%)", period: 20, get: (a, n) => rocMap(a.prices, n) },
  fromLow: { label: "Écart au + bas N j (%)", period: 20, get: (a, n) => extremeDistMap(a.prices, n, "low") },
  fromHigh: { label: "Écart au + haut N j (%)", period: 20, get: (a, n) => extremeDistMap(a.prices, n, "high") },
  inprofit: { label: "% en gain", get: (a) => new Map((a.pnl || []).filter((p) => p.pctInProfit != null).map((p) => [p.date, p.pctInProfit])) },
  flow: { label: "Pression achat %", get: (a) => new Map((a.tradeflow || []).filter((p) => p.ratio != null).map((p) => [p.date, p.ratio])) },
  buzz: { label: "Buzz (z)", get: (a) => new Map((a.buzz || []).filter((p) => p.buzz != null).map((p) => [p.date, p.buzz])) },
  volz: { label: "Volume (z)", get: (a) => zScoreByDate(a.prices, "volume") },
  mm50: { label: "Prix vs MM50 (%)", get: (a) => maDistMap(a.prices, 50, "sma") },
  h50z: { label: "Holders≥$50 (z)", get: (a) => zScoreByDate(a.holderTiers, "h50") },
};
// Portfolio simulation: walk every day holding CASH + UNITS. A buy deploys
// `buyPct`% of the cash still available, a sell liquidates `sellPct`% of the
// position — so partial signals leave ammunition for the next ones. With
// scaleIn/scaleOut the position keeps being built (or trimmed) every
// `scaleEvery` days while the line stays past the level AND the conditions
// still hold, up to `maxTranches` per episode. Realised P&L per sell uses the
// running average cost (same convention as the on-chain PnL ledger).
// `all` (symbol -> asset) enables CROSS-ASSET conditions: a condition may read
// its indicator from another asset — « acheter PENGU seulement si le RSI de BTC
// > 50 ». That's the classic market-regime filter: alts follow the majors, so
// gating on BTC's trend is often a stronger filter than anything local.
function stratRun(a, strat, all) {
  const st = { ...STRAT_DEFAULT, ...(strat || {}) };
  const line = divLineMap(a, st);
  const px = (a.prices || []).filter((p) => p.price > 0).sort((x, y) => x.date.localeCompare(y.date));
  const dailyDates = px.map((p) => p.date);
  const condMaps = {}, missing = new Set();
  const ckey = (c) => (c.sym || "") + "|" + c.ind + ":" + (c.period ?? "") + ":" + (c.tf || "D");
  const assetOf = (c) => {
    if (!c.sym) return a;
    if (!all) return null;
    return typeof all.get === "function" ? all.get(c.sym) : all[c.sym];
  };
  for (const c of [...(st.buyConds || []), ...(st.sellConds || [])]) {
    if (condMaps[ckey(c)]) continue;
    const src = COND_SOURCES[c.ind];
    const target = assetOf(c);
    const tf = ["W", "M"].includes(c.tf) ? c.tf : "D";
    let m = new Map();
    if (src && target) {
      m = src.get(resampleAsset(target, tf), c.period ?? src.period);
      m = expandHtf(m, tf, dailyDates);
    }
    condMaps[ckey(c)] = m;
    if (!m.size) missing.add((src?.label ?? c.ind) + (c.sym ? ` ${c.sym}` : "") + (tf !== "D" ? ` ${HTF_LABEL[tf]}` : ""));
  }
  // Each condition carries the connector that binds it to the previous one.
  // AND binds tighter than OR (standard precedence): « A ET B OU C » reads
  // « (A ET B) OU C » — so the list is a chain of AND-groups, any group true
  // makes the whole rule fire.
  const test = (c, d) => {
    const v = condMaps[ckey(c)]?.get(d);
    return v == null ? false : (c.op === "<" ? v < c.val : v > c.val);
  };
  const pass = (conds, d) => {
    const list = conds || [];
    if (!list.length) return true;
    let group = true, anyGroup = false;
    for (let i = 0; i < list.length; i++) {
      const ok = test(list[i], d);
      if (i === 0) { group = ok; continue; }
      if (list[i].join === "or") { anyGroup = anyGroup || group; group = ok; }
      else group = group && ok;
    }
    return anyGroup || group;
  };

  const capital = Number(st.capital) > 0 ? Number(st.capital) : 1000;
  const buyFrac = Math.min(1, Math.max(0.01, (Number(st.buyPct) || 100) / 100));
  const sellFrac = Math.min(1, Math.max(0.01, (Number(st.sellPct) || 100) / 100));
  const every = Math.max(1, Number(st.scaleEvery) || 1);
  const maxTr = Math.max(1, Number(st.maxTranches) || 3);

  let cash = capital, units = 0, cost = 0;
  const buys = [], sells = [], equity = [];
  let prev = null, buyEp = false, sellEp = false, buyN = 0, sellN = 0, lastBuyI = -1e9, lastSellI = -1e9;
  let firstBuyI = -1, investedDays = 0;

  for (let i = 0; i < px.length; i++) {
    const d = px[i].date, p = px[i].price;
    const s = line.get(d);
    if (s != null) {
      const upX = prev != null && prev < st.buyLevel && s >= st.buyLevel;
      const dnX = prev != null && prev > st.sellLevel && s <= st.sellLevel;
      const doBuy = () => {
        // Risk guards. « Ne pas moyenner à la baisse » keeps the FIRST entry of
        // a decline (which is often the jackpot) but refuses the following ones
        // that drag the average cost down — measured as the single best lever
        // on both return and drawdown. The cooldown spaces entries out.
        if (st.noAvgDown && units > 0 && p < cost / units) return;
        if (st.buyCooldown > 0 && i - lastBuyI < st.buyCooldown) return;
        const spend = cash * buyFrac;
        if (spend > 0.005) {
          units += spend / p; cost += spend; cash -= spend; buyN++; lastBuyI = i;
          if (firstBuyI < 0) firstBuyI = i;
          buys.push({ date: d, price: p, amount: spend, frac: buyFrac });
        }
      };
      const doSell = () => {
        const qty = units * sellFrac;
        if (qty > 0 && units > 0) {
          const avg = cost / units, proceeds = qty * p;
          cash += proceeds; cost -= avg * qty; units -= qty; sellN++; lastSellI = i;
          if (units < 1e-12) { units = 0; cost = 0; }
          sells.push({ date: d, price: p, amount: proceeds, pnl: proceeds - avg * qty, ret: avg > 0 ? p / avg - 1 : null, frac: sellFrac });
        }
      };
      if (upX && pass(st.buyConds, d)) { buyEp = true; buyN = 0; doBuy(); }
      else if (st.scaleIn && buyEp && s >= st.buyLevel && buyN < maxTr && i - lastBuyI >= every && pass(st.buyConds, d)) doBuy();
      if (s < st.buyLevel) buyEp = false;

      if (dnX && pass(st.sellConds, d)) { sellEp = true; sellN = 0; doSell(); }
      else if (st.scaleOut && sellEp && s <= st.sellLevel && sellN < maxTr && i - lastSellI >= every && pass(st.sellConds, d)) doSell();
      if (s > st.sellLevel) sellEp = false;

      prev = s;
    }
    if (firstBuyI >= 0 && units > 0) investedDays++;
    equity.push({ date: d, value: cash + units * p });
  }

  const last = px.at(-1) || null;
  const open = units > 0 && last ? { units, avg: cost / units, value: units * last.price, date: buys.at(-1)?.date ?? null, ret: cost > 0 ? (units * last.price) / cost - 1 : null } : null;
  return { buys, sells, equity, open, missing: [...missing], capital, cash, units, px, firstBuyI, investedDays };
}
// Report over the simulation: equity-curve based (drawdown measured daily, not
// on a chain of trade returns) + realised stats per sell tranche.
function stratBacktest(a, strat, all) {
  const r = stratRun(a, strat, all);
  const rets = r.sells.map((s) => s.ret).filter((x) => x != null);
  let peak = -Infinity, maxDD = 0;
  for (const e of r.equity) {
    if (e.value > peak) peak = e.value;
    if (peak > 0) { const dd = e.value / peak - 1; if (dd < maxDD) maxDD = dd; }
  }
  const equityFinal = r.equity.at(-1)?.value ?? r.capital;
  const bh = r.firstBuyI >= 0 && r.px.length ? r.px.at(-1).price / r.px[r.firstBuyI].price - 1 : null;
  const liveDays = r.firstBuyI >= 0 ? r.px.length - r.firstBuyI : 0;
  return {
    ...r,
    n: rets.length,
    nBuys: r.buys.length,
    win: rets.length ? rets.filter((x) => x > 0).length / rets.length : null,
    med: medianOf(rets),
    cum: equityFinal / r.capital - 1,
    equityFinal,
    maxDD,
    bh: Number.isFinite(bh) ? bh : null,
    exposure: liveDays > 0 ? r.investedDays / liveDays : null,
  };
}
// Back-compat alias for the chart overlay (it only reads buys/sells).
const stratSignals = (a, strat, all) => stratRun(a, strat, all);

// Per-asset backtest of the BUY signal → which assets actually have an edge.
function backtestByAsset(assets, params, horizons = [7, 14, 30]) {
  return assets.map((a) => {
    const { buys } = divSignals(a, params);
    const h = {};
    for (const k of horizons) {
      const fr = forwardReturns(a.prices, k);
      const arr = [];
      for (const b of buys) { const f = fr.get(b.date); if (f != null) arr.push(f); }
      h[k] = arr.length ? { n: arr.length, win: arr.filter((x) => x > 0).length / arr.length, med: medianOf(arr) } : { n: 0, win: null, med: null };
    }
    return { symbol: a.symbol, group: a.group, buys: buys.length, h };
  }).sort((x, y) => y.buys - x.buys);
}

// Which zone a value falls in for a signal: "bull" | "bear" | "neutral".
// Directionality is inferred from the bands (a value beyond a bull band =
// bull; beyond a bear band = bear). Handles both "high is good" (flowratio)
// and "high is bad" (inprofit, rsi) by reading each band's kind.
function zoneOf(key, v) {
  const z = SIGNAL_ZONES[key];
  if (!z || v == null) return "neutral";
  const bull = z.bands.find((b) => b.kind === "bull");
  const bear = z.bands.find((b) => b.kind === "bear");
  // is "bull" the high side or the low side?
  const bullHigh = !bear || (bull && bull.v > bear.v);
  if (bull && (bullHigh ? v >= bull.v : v <= bull.v)) return "bull";
  if (bear && (bullHigh ? v <= bear.v : v >= bear.v)) return "bear";
  return "neutral";
}

// Per-asset trading verdict from the signals that have data. Returns
// { verdict: "accumulation"|"distribution"|"neutre", score, signals:[...] }.
// score = (#bull − #bear); the label follows the net and the presence of the
// strong on-chain distribution flag.
function assetVerdict(a) {
  const vals = {
    flowratio: lastValue(a.tradeflow, "ratio"),
    divergence: lastValue(a.divergence, "div"),
    rsi: rsiLast(a.prices),
    inprofit: a.pnl?.length ? lastValue(a.pnl, "pctInProfit") : null,
    composite: a.composite?.length ? lastValue(a.composite, "score") : null,
  };
  const signals = [];
  let bull = 0, bear = 0;
  for (const [key, v] of Object.entries(vals)) {
    if (v == null) continue;
    let zone = zoneOf(key, v);
    // Confidence filter (backtest): a divergence-bull with no momentum behind it
    // (RSI ≤ 50) is the worst-performing setup measured — neutralise it so the
    // verdict doesn't chase attention the price hasn't confirmed.
    let note = "";
    if (key === "divergence" && zone === "bull" && vals.rsi != null && vals.rsi <= 50) { zone = "neutral"; note = " (RSI faible)"; }
    if (zone === "bull") bull++; else if (zone === "bear") bear++;
    signals.push({ key, label: SIGNAL_ZONES[key].label + note, value: v, zone, fmt: SIGNAL_ZONES[key].fmt });
  }
  // post-pump veto: chasing a fresh >15%/3d pump measured −9%/7j
  const d3 = (a.prices || []).slice(-4);
  const pumped = d3.length >= 2 && d3[0].price > 0 && d3.at(-1).price / d3[0].price - 1 >= 0.15;
  if (pumped) { bear++; signals.push({ key: "pump", label: "Pompe récente", value: null, zone: "bear", fmt: () => "≥+15%/3j" }); }
  const net = bull - bear;
  let verdict = "neutre";
  if (net >= 2 || (net >= 1 && bear === 0)) verdict = "accumulation";
  else if (net <= -2 || (bear >= 1 && vals.inprofit != null && vals.inprofit >= 40)) verdict = "distribution";
  return { verdict, score: net, bull, bear, signals };
}
const VERDICT_META = {
  accumulation: { emoji: "🟢", label: "Accumulation", cls: "v-bull" },
  neutre: { emoji: "⚪", label: "Neutre", cls: "v-neutral" },
  distribution: { emoji: "🔴", label: "Distribution", cls: "v-bear" },
};

// Reusable horizontal gauge: shows where `value` sits on a signal's scale,
// with the coloured zone bands behind it. Returns a DOM element.
function signalGauge(key, value, opts = {}) {
  const z = SIGNAL_ZONES[key];
  const wrap = document.createElement("div");
  wrap.className = "gauge";
  if (!z || value == null) { wrap.innerHTML = `<div class="gauge-lbl">${z?.label || key}</div><div class="gauge-track"></div><div class="gauge-val">—</div>`; return wrap; }
  const pct = (v) => Math.max(0, Math.min(100, ((v - z.lo) / (z.hi - z.lo)) * 100));
  const zone = zoneOf(key, value);
  // build zone segments as a gradient over the track
  const bull = z.bands.find((b) => b.kind === "bull");
  const bear = z.bands.find((b) => b.kind === "bear");
  const bullHigh = !bear || (bull && bull.v > bear.v);
  const stops = [];
  if (bear) { const p = pct(bear.v); stops.push(bullHigh ? `${ZONE_HEX.bear} 0 ${p}%` : `${ZONE_HEX.bull} 0 ${p}%`); }
  if (bull) { const p = pct(bull.v); stops.push(bullHigh ? `transparent ${pct(bear?.v ?? z.lo)}% ${p}%` : ``); }
  // simpler: 3-stop gradient bear→neutral→bull along the axis
  const grad = bullHigh
    ? `linear-gradient(90deg, ${ZONE_HEX.bear} 0 ${pct(bear?.v ?? z.lo)}%, ${ZONE_HEX.mid}44 ${pct(bear?.v ?? z.lo)}% ${pct(bull?.v ?? z.hi)}%, ${ZONE_HEX.bull} ${pct(bull?.v ?? z.hi)}% 100%)`
    : `linear-gradient(90deg, ${ZONE_HEX.bull} 0 ${pct(bull?.v ?? z.lo)}%, ${ZONE_HEX.mid}44 ${pct(bull?.v ?? z.lo)}% ${pct(bear?.v ?? z.hi)}%, ${ZONE_HEX.bear} ${pct(bear?.v ?? z.hi)}% 100%)`;
  wrap.innerHTML = `<div class="gauge-lbl">${z.label}</div>
    <div class="gauge-track" style="background:${grad}">
      <span class="gauge-needle" style="left:${pct(value)}%"></span>
    </div>
    <div class="gauge-val" style="color:${ZONE_HEX[zone] || ZONE_HEX.neutral}">${z.fmt(value)}</div>`;
  return wrap;
}

// Relative community velocity (M7): community growth vs the peer group.
// Per date: mean 7-day % growth of holders + telegram members, minus the
// MEDIAN of the same figure across the asset's group that day. Positive =
// the community grows faster than its peers (gaining attention share).
function velocitySeries(assets) {
  const g7 = (series, key) => {
    const s = (series || []).filter((p) => p[key] != null);
    const out = new Map();
    for (let i = 0; i < s.length; i++) {
      const past = s.find((p) => p.date >= dateAddDays(s[i].date, -7));
      if (past && past.date < s[i].date && past[key] > 0) out.set(s[i].date, (s[i][key] / past[key] - 1) * 100);
    }
    return out;
  };
  const growth = assets.map((a) => {
    const h = g7(a.holders, "holders"), t = g7(a.telegram, "members");
    const dates = new Set([...h.keys(), ...t.keys()]);
    const m = new Map();
    for (const d of dates) {
      const vals = [h.get(d), t.get(d)].filter((v) => v != null);
      if (vals.length) m.set(d, vals.reduce((x, y) => x + y, 0) / vals.length);
    }
    return m;
  });
  assets.forEach((a, i) => {
    const out = [];
    for (const [d, g] of growth[i]) {
      const peers = assets.map((b, j) => (b.group === a.group && j !== i ? growth[j].get(d) : null))
        .filter((v) => v != null).sort((x, y) => x - y);
      if (peers.length >= 3) out.push({ date: d, vel: g - peers[Math.floor(peers.length / 2)] });
    }
    a.velocity = out.sort((x, y) => x.date.localeCompare(y.date));
  });
}

// Composite score (M8): one 0-100 daily number per asset blending our signals,
// each as a z-score, WEIGHTED BY THE LIVE MEASURED IC (recomputed from the
// data at every load, per the empirical-validation rule; hardcoded fallbacks
// only when history is too short to measure).
const COMPOSITE_FALLBACK_W = { flow: 0.34, divergence: 0.13, buzz: 0.07, velocity: 0.05 };
function compositeWeights(assets) {
  const memes = assets.filter((a) => a.group === "memes");
  const builders = {
    flow: (a) => zScoreByDate(a.tradeflow, "ratio"),
    divergence: (a) => new Map((a.divergence || []).map((p) => [p.date, p.div])),
    buzz: (a) => new Map((a.buzz || []).map((p) => [p.date, p.buzz])),
    velocity: (a) => new Map((a.velocity || []).map((p) => [p.date, p.vel])),
  };
  const w = {};
  for (const [k, build] of Object.entries(builders)) {
    const { ic, n } = icPooled(memes, build, 7);
    w[k] = ic != null && n >= 60 ? Math.max(0.02, Math.abs(ic)) : COMPOSITE_FALLBACK_W[k];
  }
  return w;
}
function compositeSeries(a, w) {
  const parts = {
    flow: zScoreByDate(a.tradeflow, "ratio"),
    divergence: new Map((a.divergence || []).map((p) => [p.date, p.div])),
    buzz: new Map((a.buzz || []).map((p) => [p.date, p.buzz])),
    velocity: new Map((a.velocity || []).map((p) => [p.date, p.vel])),
  };
  const dates = new Set();
  for (const m of Object.values(parts)) for (const d of m.keys()) dates.add(d);
  const out = [];
  for (const d of [...dates].sort()) {
    let num = 0, den = 0;
    for (const [k, m] of Object.entries(parts)) {
      const v = m.get(d);
      if (v == null) continue;
      num += w[k] * Math.max(-3, Math.min(3, v)); // clamp outliers
      den += w[k];
    }
    if (den > 0) out.push({ date: d, score: Math.round(Math.max(0, Math.min(100, 50 + 20 * (num / den)))) });
  }
  return out;
}

// ---- data ---------------------------------------------------------------
async function loadData() {
  const data = await fetch("./data.json").then((r) => r.json());
  const tvlByChain = data.tvlByChain || {};
  for (const a of data.assets) {
    a.tvl = tvlByChain[a.chain] || [];
    a.buzz = buzzSeries(a); // computed indicators — plug into the registry like any series
    a.divergence = divergenceSeries(a);
  }
  velocitySeries(data.assets); // M7 needs every asset (peer medians) — after the loop
  const compW = compositeWeights(data.assets); // M8 weights = live measured ICs
  data.compositeWeights = compW;
  for (const a of data.assets) a.composite = compositeSeries(a, compW);
  // Radar tokens reshaped as pseudo-assets (symbol "SYM@chain") so the token
  // page and the Studio can reuse the whole metric/indicator machinery on them.
  data.radarAssets = [];
  for (const [chain, toks] of Object.entries(data.radar || {})) {
    for (const t of toks) {
      const a = {
        group: "radar", radar: t, chain, address: t.address,
        symbol: `${t.symbol}@${chain}`,
        latestChange24h: lastValue(t.series, "d24"),
        marketCap: lastValue(t.series, "fdv"),
        prices: t.series.map((p) => ({ date: p.date, price: p.price, volume: p.vol })),
        liquidity: t.series.map((p) => ({ date: p.date, liq: p.liq })),
        mentions: t.mentions || [],
        telegram: t.series.filter((p) => p.tg != null).map((p) => ({ date: p.date, members: p.tg })),
        discord: t.series.filter((p) => p.dc != null).map((p) => ({ date: p.date, members: p.dc })),
        holders: t.series.filter((p) => p.holders != null).map((p) => ({ date: p.date, holders: p.holders })),
        tradeflow: t.series.filter((p) => p.ratio != null).map((p) => ({ date: p.date, ratio: p.ratio })),
        holderTiers: [], holderFlows: [], onchain: null,
        tvl: tvlByChain[chain] || [],
      };
      a.buzz = buzzSeries(a);
      a.divergence = divergenceSeries(a);
      data.radarAssets.push(a);
    }
  }
  return data;
}

// ---- journal (dated milestones) ------------------------------------------
// Milestones live in localStorage. scope "global" shows on EVERY chart of the
// site; any other scope (e.g. "studio" or a Mon Dash widget id) only on that
// chart — for project-specific events that would pollute the rest.
const JOURNAL_KEY = "chog-journal-v1";
const JOURNAL_CATS = [["macro", "Macro", "#e0a000"], ["crypto", "Crypto", "#3987e5"], ["projet", "Projet", "#e0559a"]];
const journalCatColor = (cat) => JOURNAL_CATS.find(([k]) => k === cat)?.[2] || "#836ef9";
function journalAll() {
  try { return JSON.parse(localStorage.getItem(JOURNAL_KEY)) || []; } catch { return []; }
}
function journalSave(evts) {
  localStorage.setItem(JOURNAL_KEY, JSON.stringify(evts));
}
function journalEvents(scope) {
  return journalAll()
    .filter((e) => e.scope === "global" || (scope && e.scope === scope))
    .sort((a, b) => a.date.localeCompare(b.date));
}
function journalAdd({ date, label, cat = "crypto", scope = "global" }) {
  const evts = journalAll();
  evts.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), date, label, cat, scope });
  journalSave(evts);
}
// Markers must sit on an existing data point — snap each event to the first
// date >= the event date within the plotted series.
function applyEventMarkers(series, dataPts, events) {
  if (!series || !events?.length || !dataPts?.length) return;
  const times = dataPts.map((p) => p.time || p.date);
  const markers = [];
  for (const e of events) {
    const t = times.find((d) => d >= e.date);
    if (!t) continue;
    markers.push({
      time: t, position: "aboveBar", shape: "square",
      color: journalCatColor(e.cat),
      text: "🚩 " + (e.label.length > 16 ? e.label.slice(0, 15) + "…" : e.label),
    });
  }
  if (!markers.length) return;
  try {
    if (typeof LightweightCharts !== "undefined" && LightweightCharts.createSeriesMarkers) {
      LightweightCharts.createSeriesMarkers(series, markers);
      return;
    }
  } catch { /* fall through to v4 */ }
  try { series.setMarkers(markers); } catch { /* markers are cosmetic */ }
}
// Impact of an event: % change of `key` from the event date to date+k days
// (first available point at or after each date — daily data can have gaps).
function dateAddDays(dateStr, k) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
}
function valueAtOrAfter(series, key, date, maxSlipDays = 4) {
  if (!series) return null;
  const limit = dateAddDays(date, maxSlipDays);
  for (const p of series) {
    if (p.date >= date && p[key] != null) return p.date <= limit ? p[key] : null;
  }
  return null;
}
function pctFrom(series, key, date, k) {
  const v0 = valueAtOrAfter(series, key, date);
  const v1 = valueAtOrAfter(series, key, dateAddDays(date, k));
  if (v0 == null || v1 == null || v0 === 0) return null;
  return (v1 / v0 - 1) * 100;
}

// ---- custom-indicator help ---------------------------------------------
// Custom indicators aren't self-explanatory like "Prix", so every one of them
// carries a `help` descriptor (what it is / how to read it / an example / how
// well it actually predicts). helpIcon renders the ⓘ + its hover card.
function helpIcon(help, label) {
  if (!help) return null;
  const wrap = document.createElement("span");
  wrap.className = "help-ico";
  wrap.tabIndex = 0;
  wrap.textContent = "ⓘ";
  wrap.setAttribute("aria-label", `À quoi sert ${label} ?`);
  const card = document.createElement("span");
  card.className = "help-card";
  card.innerHTML = `<b class="help-title">${label}</b>`
    + (help.what ? `<span class="help-p">${help.what}</span>` : "")
    + (help.read ? `<span class="help-p"><i>Lecture :</i> ${help.read}</span>` : "")
    + (help.example ? `<span class="help-ex"><i>Exemple :</i> ${help.example}</span>` : "")
    + (help.quality ? `<span class="help-q">${help.quality}</span>` : "");
  wrap.append(card);
  return wrap;
}

// ---- chrome -------------------------------------------------------------
function buildTopbar(active) {
  const tabs = [
    ["index.html", "CHOG"],
    ["trader.html", "Trader"],
    ["screener.html", "Screener"],
    ["studio.html", "Studio"],
    ["dash.html", "Mon Dash"],
    ["journal.html", "Journal"],
    ["radar.html", "Radar"],
    ["signals.html", "Signaux"],
    ["admin.html", "Admin"],
  ];
  const nav = document.createElement("nav");
  nav.className = "topbar";
  const inner = document.createElement("div");
  inner.className = "topbar-inner";
  const brand = document.createElement("a");
  brand.className = "brand-mark";
  brand.href = "index.html";
  brand.innerHTML = '<span class="brand-dot"></span>CHOG&nbsp;<span class="dim">Intel</span>';
  const tabsEl = document.createElement("div");
  tabsEl.className = "nav-tabs";
  for (const [href, label] of tabs) {
    const a = document.createElement("a");
    a.href = href;
    a.textContent = label;
    if (label.toLowerCase() === active) a.className = "active";
    tabsEl.append(a);
  }
  inner.append(brand, tabsEl);
  nav.append(inner);
  document.body.prepend(nav);
}
