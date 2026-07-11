/* Shared library for all views (screener, asset, signals).
   Loaded as a classic script before each view script — its top-level
   consts/functions are visible to the scripts that follow on the page. */

// Fixed per-symbol colours (identity follows the entity, never its rank).
const COLORS = {
  CHOG: "#836ef9", PEPE: "#37a537", WIF: "#e0a000", BONK: "#f07530",
  BRETT: "#3987e5", PENGU: "#2ec8e6", FARTCOIN: "#9ccc4a", ANSEM: "#ef5350",
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
  return `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%`;
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
function indexSeries(points, key) {
  const base = points.find((p) => p[key] != null && p[key] !== 0);
  if (!base) return points.map(() => null);
  return points.map((p) => (p[key] == null ? null : (p[key] / base[key]) * 100));
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
function corrLevels(seriesA, keyA, seriesB, keyB, windowDays) {
  const wa = windowed(seriesA, windowDays);
  const wb = windowed(seriesB, windowDays);
  const bBy = new Map(wb.map((p) => [p.date, p[keyB]]));
  const pairs = [];
  for (const p of wa) {
    const vb = bBy.get(p.date);
    if (p[keyA] != null && vb != null) pairs.push([p[keyA], vb]);
  }
  return { r: pearson(pairs), n: pairs.length };
}

// ---- data ---------------------------------------------------------------
async function loadData() {
  const data = await fetch("./data.json").then((r) => r.json());
  const tvlByChain = data.tvlByChain || {};
  for (const a of data.assets) a.tvl = tvlByChain[a.chain] || [];
  return data;
}

// ---- chrome -------------------------------------------------------------
function buildTopbar(active) {
  const tabs = [
    ["index.html", "Screener"],
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
