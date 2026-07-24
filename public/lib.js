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
    const zone = zoneOf(key, v);
    if (zone === "bull") bull++; else if (zone === "bear") bear++;
    signals.push({ key, label: SIGNAL_ZONES[key].label, value: v, zone, fmt: SIGNAL_ZONES[key].fmt });
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
