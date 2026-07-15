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
  AKT: "#ef5350", STRK: "#a98bf0",
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

// ---- data ---------------------------------------------------------------
async function loadData() {
  const data = await fetch("./data.json").then((r) => r.json());
  const tvlByChain = data.tvlByChain || {};
  for (const a of data.assets) {
    a.tvl = tvlByChain[a.chain] || [];
    a.buzz = buzzSeries(a); // computed indicators — plug into the registry like any series
    a.divergence = divergenceSeries(a);
  }
  return data;
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
    ["screener.html", "Screener"],
    ["studio.html", "Studio"],
    ["dash.html", "Mon Dash"],
    ["signals.html", "Signaux"],
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
