/* Shared dashboard logic for both pages. Reads public/data.json (emitted by
   build-dashboard-data.js) and renders stat tiles + charts. Committed dark
   Monad-purple look. */

// Fixed per-symbol colors (identity follows the entity, never its rank).
// Beyond 8 series per group the CVD-distinctness of any palette degrades — the
// always-on legend + the dynamic selector (used with a few assets at a time)
// are the mitigation, per the dataviz method's "too many series" guidance.
const COLORS = {
  // memes
  CHOG: "#836ef9",
  PEPE: "#37a537",
  WIF: "#e0a000",
  BONK: "#f07530",
  BRETT: "#3987e5",
  PENGU: "#2ec8e6",
  FARTCOIN: "#9ccc4a",
  ANSEM: "#ef5350",
  // majors
  MON: "#836ef9",
  BTC: "#f07530",
  ETH: "#3987e5",
  SOL: "#17b8a6",
  XRP: "#b0bec5",
  SUI: "#2ec8e6",
  HYPE: "#35e0a5",
  TAO: "#e0559a",
  AKT: "#ef5350",
  STRK: "#a98bf0",
};

const CSS = getComputedStyle(document.documentElement);
const ink = (name) => CSS.getPropertyValue(name).trim();

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
  const s = pct >= 0 ? "▲" : "▼";
  return `${s} ${Math.abs(pct).toFixed(1)}%`;
}

function fmtUsdCompact(n) {
  if (n == null) return "—";
  return "$" + fmtCompact(n);
}

// % change of `key` between the latest point and the point ~`days` back,
// read straight from the stored daily series — no extra API calls. Returns
// null when there isn't enough history yet (e.g. mentions on day one).
function pctOverDays(series, key, days) {
  if (!series || series.length < 2) return null;
  const last = series[series.length - 1];
  if (last[key] == null) return null;
  const target = new Date(last.date + "T00:00:00Z");
  target.setUTCDate(target.getUTCDate() - days);
  const targetDate = target.toISOString().slice(0, 10);
  // nearest stored point on or before the target date
  let ref = null;
  for (const p of series) {
    if (p.date <= targetDate && p[key] != null) ref = p;
  }
  if (!ref || ref[key] === 0) return null;
  return ((last[key] - ref[key]) / ref[key]) * 100;
}

// value / first-known-value × 100, so different scales share one axis.
function indexSeries(points, key) {
  const base = points.find((p) => p[key] != null && p[key] !== 0);
  if (!base) return points.map(() => null);
  return points.map((p) => (p[key] == null ? null : (p[key] / base[key]) * 100));
}

function unionDates(assets, key) {
  const s = new Set();
  for (const a of assets) for (const p of a[key]) s.add(p.date);
  return [...s].sort();
}

// Keep only points within `windowDays` of the series' latest date (Infinity = all).
function windowed(series, windowDays) {
  if (!series || !series.length || !isFinite(windowDays)) return series || [];
  const last = new Date(series[series.length - 1].date + "T00:00:00Z");
  const cutoff = new Date(last);
  cutoff.setUTCDate(cutoff.getUTCDate() - windowDays);
  const cut = cutoff.toISOString().slice(0, 10);
  return series.filter((p) => p.date >= cut);
}

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

// Correlation of the values themselves (over a window), date-aligned. This is
// what the price-vs-TVL scatter shows, so card and scatter agree. A shared
// upward/downward trend can inflate it — the scatter is there to sanity-check.
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

function alignedIndexed(asset, dates, key, valueKey) {
  const by = new Map(asset[key].map((p) => [p.date, p[valueKey]]));
  const raw = dates.map((d) => ({ [valueKey]: by.has(d) ? by.get(d) : null }));
  return indexSeries(raw, valueKey);
}

// ---- chart factory ------------------------------------------------------
function baseOptions(yTitle) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        position: "top",
        align: "start",
        labels: {
          color: ink("--text-2"),
          usePointStyle: true,
          pointStyleWidth: 10,
          boxHeight: 7,
          padding: 16,
          font: { size: 12.5 },
        },
      },
      tooltip: {
        backgroundColor: "#1e1a2b",
        borderColor: "rgba(255,255,255,0.12)",
        borderWidth: 1,
        titleColor: ink("--text"),
        bodyColor: ink("--text-2"),
        padding: 10,
        cornerRadius: 9,
        boxPadding: 5,
        usePointStyle: true,
        callbacks: {
          label: (c) =>
            `  ${c.dataset.label}: ${c.parsed.y == null ? "—" : c.parsed.y.toFixed(1)}`,
        },
      },
      zoom: {
        pan: { enabled: true, mode: "x" },
        zoom: {
          wheel: { enabled: true },
          pinch: { enabled: true },
          drag: { enabled: false },
          mode: "x",
        },
      },
    },
    scales: {
      x: {
        grid: { color: ink("--grid"), drawTicks: false },
        border: { display: false },
        ticks: { color: ink("--text-3"), maxRotation: 0, autoSkipPadding: 24, font: { size: 11 } },
      },
      y: {
        grid: { color: ink("--grid"), drawTicks: false },
        border: { display: false },
        ticks: { color: ink("--text-3"), font: { size: 11 } },
        title: { display: !!yTitle, text: yTitle, color: ink("--text-3"), font: { size: 11 } },
      },
    },
  };
}

function lineDataset({ label, data, color, dashed = false }) {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    borderDash: dashed ? [5, 4] : [],
    // Dense lines stay clean (radius 0); an isolated point — e.g. a single day
    // of mentions surrounded by nulls — is drawn as a dot so it stays visible
    // while history is still accumulating.
    pointRadius: (ctx) => {
      const d = ctx.dataset.data;
      const i = ctx.dataIndex;
      if (d[i] == null) return 0;
      const isolated = (d[i - 1] == null || i === 0) && (d[i + 1] == null || i === d.length - 1);
      return isolated ? 4 : 0;
    },
    pointHoverRadius: 5,
    pointBackgroundColor: color,
    pointBorderColor: ink("--surface"),
    pointBorderWidth: 2,
    tension: 0.25,
    spanGaps: true,
  };
}

function maxSeriesLen(assets, key) {
  return Math.max(0, ...assets.map((a) => a[key].length));
}

// Centered muted overlay for charts that don't have enough history yet.
function historyOverlay(box, text) {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText =
    "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;" +
    "text-align:center;padding:0 24px;color:var(--text-3);font-size:13.5px;pointer-events:none;";
  box.append(el);
}

// ---- stat tiles ---------------------------------------------------------
function renderTiles(container, assets) {
  container.innerHTML = "";
  for (const a of assets) {
    const color = COLORS[a.symbol] || ink("--brand");
    const price = a.prices.at(-1);
    const mentions = a.mentions.at(-1);
    const change = a.latestChange24h;

    const tile = document.createElement("div");
    tile.className = "tile";

    const top = document.createElement("div");
    top.className = "tile-top";
    const sw = document.createElement("span");
    sw.className = "tile-swatch";
    sw.style.color = color;
    sw.style.background = color;
    const sym = document.createElement("span");
    sym.className = "tile-sym";
    sym.textContent = a.symbol;
    const chain = document.createElement("span");
    chain.className = "tile-chain";
    chain.textContent = a.chain;
    top.append(sw, sym, chain);

    const val = document.createElement("div");
    val.className = "tile-value";
    val.textContent = fmtPrice(price?.price ?? null);

    const row = document.createElement("div");
    row.className = "tile-row";
    if (change != null) {
      const chip = document.createElement("span");
      chip.className = "chip " + (change >= 0 ? "up" : "down");
      chip.textContent = fmtDelta(change);
      row.append(chip);
      const lbl = document.createElement("span");
      lbl.className = "tile-sub";
      lbl.style.marginTop = "0";
      lbl.textContent = "24h";
      row.append(lbl);
    }

    const sub = document.createElement("div");
    sub.className = "tile-sub";
    const b = document.createElement("b");
    b.textContent = fmtCompact(mentions?.count ?? null);
    sub.append(b, document.createTextNode(" mentions X / 24h"));

    tile.append(top, val, row, sub);
    container.append(tile);
  }
}

// ---- static charts ------------------------------------------------------
function chogMentionsVsPrice(canvas, chog) {
  const dates = [...new Set([...chog.mentions.map((p) => p.date), ...chog.prices.map((p) => p.date)])].sort();
  new Chart(canvas, {
    type: "line",
    data: {
      labels: dates,
      datasets: [
        lineDataset({ label: "Mentions X", data: alignedIndexed(chog, dates, "mentions", "count"), color: "#836ef9" }),
        lineDataset({ label: "Prix", data: alignedIndexed(chog, dates, "prices", "price"), color: "#3987e5" }),
      ],
    },
    options: baseOptions("Indice (base 100)"),
  });
}

function mentionsOnly(canvas, assets) {
  const dates = unionDates(assets, "mentions");
  new Chart(canvas, {
    type: "line",
    data: {
      labels: dates,
      datasets: assets.map((a) =>
        lineDataset({
          label: a.symbol,
          data: alignedIndexed(a, dates, "mentions", "count"),
          color: COLORS[a.symbol] || ink("--brand"),
        })
      ),
    },
    options: baseOptions("Indice mentions (base 100)"),
  });
  if (maxSeriesLen(assets, "mentions") < 2) {
    historyOverlay(
      canvas.parentElement,
      "L'historique des mentions X se construit jour après jour — la courbe apparaîtra dès quelques jours de collecte (les mentions ne sont pas rétro-remplissables comme le prix)."
    );
  }
}

// ---- dynamic cross panel ------------------------------------------------
function buildDynamicPanel(root, assets, opts = {}) {
  const defaultOn = new Set(opts.defaultOn || assets.slice(0, 3).map((a) => a.symbol));
  let mode = "cross"; // 'mentions' | 'price' | 'cross'

  const controls = document.createElement("div");
  controls.className = "controls";

  // asset toggles
  const assetGroup = document.createElement("div");
  assetGroup.className = "control-group";
  const assetLabel = document.createElement("span");
  assetLabel.className = "control-label";
  assetLabel.textContent = "Actifs";
  assetGroup.append(assetLabel);
  const toggles = new Map();
  for (const a of assets) {
    const color = COLORS[a.symbol] || ink("--brand");
    const t = document.createElement("button");
    t.className = "asset-toggle" + (defaultOn.has(a.symbol) ? " on" : "");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.color = color;
    dot.style.background = color;
    const name = document.createElement("span");
    name.textContent = a.symbol;
    t.append(dot, name);
    t.addEventListener("click", () => {
      t.classList.toggle("on");
      render();
    });
    toggles.set(a.symbol, t);
    assetGroup.append(t);
  }

  // metric segmented control
  const metricGroup = document.createElement("div");
  metricGroup.className = "control-group";
  const metricLabel = document.createElement("span");
  metricLabel.className = "control-label";
  metricLabel.textContent = "Métrique";
  const seg = document.createElement("div");
  seg.className = "segmented";
  const modes = [
    ["mentions", "Mentions"],
    ["price", "Prix"],
    ["cross", "Croisé"],
  ];
  for (const [key, text] of modes) {
    const b = document.createElement("button");
    b.textContent = text;
    b.className = key === mode ? "on" : "";
    b.addEventListener("click", () => {
      mode = key;
      seg.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      render();
    });
    seg.append(b);
  }
  metricGroup.append(metricLabel, seg);

  controls.append(assetGroup, metricGroup);

  const box = document.createElement("div");
  box.className = "chart-box";
  const canvas = document.createElement("canvas");
  box.append(canvas);

  const note = document.createElement("div");
  note.className = "legend-note";

  root.append(controls, box, note);

  let chart = null;
  function render() {
    const selected = assets.filter((a) => toggles.get(a.symbol).classList.contains("on"));
    const useMentions = mode === "mentions" || mode === "cross";
    const usePrice = mode === "price" || mode === "cross";
    const dateKeys = [];
    if (useMentions) dateKeys.push("mentions");
    if (usePrice) dateKeys.push("prices");
    const dates = [
      ...new Set(selected.flatMap((a) => dateKeys.flatMap((k) => a[k].map((p) => p.date)))),
    ].sort();

    const datasets = [];
    for (const a of selected) {
      const color = COLORS[a.symbol] || ink("--brand");
      if (useMentions)
        datasets.push(
          lineDataset({
            label: mode === "cross" ? `${a.symbol} · mentions` : a.symbol,
            data: alignedIndexed(a, dates, "mentions", "count"),
            color,
          })
        );
      if (usePrice)
        datasets.push(
          lineDataset({
            label: mode === "cross" ? `${a.symbol} · prix` : a.symbol,
            data: alignedIndexed(a, dates, "prices", "price"),
            color,
            dashed: mode === "cross",
          })
        );
    }

    note.innerHTML = "";
    if (mode === "cross") {
      note.innerHTML =
        "Ligne pleine = <b>mentions X</b>, pointillés = <b>prix</b>, même couleur par actif. Tout indexé base 100 pour lire les divergences.";
    } else {
      note.innerHTML = "Indexé base 100 (première valeur connue = 100) pour comparer les trajectoires.";
    }

    chart?.destroy();
    chart = new Chart(canvas, {
      type: "line",
      data: { labels: dates, datasets },
      options: baseOptions("Indice (base 100)"),
    });
  }

  render();
}

// ---- leaderboard (sortable) ---------------------------------------------
function renderLeaderboard(container, assets) {
  const columns = [
    { key: "sym", label: "Actif", kind: "sym", value: (a) => a.symbol },
    { key: "mcap", label: "Market cap", kind: "usd", value: (a) => a.marketCap },
    { key: "vol", label: "Volume 24h", kind: "usd", value: (a) => a.prices.at(-1)?.volume ?? null },
    { key: "price", label: "Prix", kind: "price", value: (a) => a.prices.at(-1)?.price ?? null },
    { key: "p24", label: "Prix 24h", kind: "pct", value: (a) => a.latestChange24h },
    { key: "p7", label: "Prix 7j", kind: "pct", value: (a) => pctOverDays(a.prices, "price", 7) },
    { key: "p30", label: "Prix 30j", kind: "pct", value: (a) => pctOverDays(a.prices, "price", 30) },
    { key: "tvl", label: "TVL", kind: "usd", value: (a) => (a.tvl?.length ? a.tvl.at(-1).tvl : null) },
    { key: "tvl7", label: "TVL 7j", kind: "pct", value: (a) => pctOverDays(a.tvl, "tvl", 7) },
    { key: "tvl30", label: "TVL 30j", kind: "pct", value: (a) => pctOverDays(a.tvl, "tvl", 30) },
    { key: "m24", label: "Ment. 24h", kind: "pct", value: (a) => pctOverDays(a.mentions, "count", 1) },
    { key: "m7", label: "Ment. 7j", kind: "pct", value: (a) => pctOverDays(a.mentions, "count", 7) },
    { key: "m30", label: "Ment. 30j", kind: "pct", value: (a) => pctOverDays(a.mentions, "count", 30) },
    { key: "dc", label: "Membres DC", kind: "num", value: (a) => (a.discord?.length ? a.discord.at(-1).members : null) },
    { key: "dc7", label: "Membres 7j", kind: "pct", value: (a) => pctOverDays(a.discord, "members", 7) },
  ];

  // Precompute every cell value once.
  const rows = assets.map((a) => ({
    a,
    vals: Object.fromEntries(columns.map((c) => [c.key, c.value(a)])),
  }));

  let sortKey = "mcap";
  let sortDir = "desc";

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const c of columns) {
    const th = document.createElement("th");
    th.textContent = c.label;
    th.className = "sortable" + (c.key === sortKey ? " active" : "");
    th.dataset.key = c.key;
    const arrow = document.createElement("span");
    arrow.className = "sort-arrow";
    arrow.textContent = c.key === sortKey ? (sortDir === "desc" ? " ↓" : " ↑") : "";
    th.append(arrow);
    th.addEventListener("click", () => {
      if (sortKey === c.key) {
        sortDir = sortDir === "desc" ? "asc" : "desc";
      } else {
        sortKey = c.key;
        sortDir = c.kind === "sym" ? "asc" : "desc";
      }
      renderRows();
      // refresh header state
      headRow.querySelectorAll("th").forEach((el) => {
        const on = el.dataset.key === sortKey;
        el.classList.toggle("active", on);
        el.querySelector(".sort-arrow").textContent = on ? (sortDir === "desc" ? " ↓" : " ↑") : "";
      });
    });
    headRow.append(th);
  }
  thead.append(headRow);

  const tbody = document.createElement("tbody");
  table.append(thead, tbody);
  container.append(table);

  function renderRows() {
    const col = columns.find((c) => c.key === sortKey);
    const sorted = [...rows].sort((r1, r2) => {
      const v1 = r1.vals[sortKey];
      const v2 = r2.vals[sortKey];
      if (col.kind === "sym") {
        return sortDir === "asc" ? v1.localeCompare(v2) : v2.localeCompare(v1);
      }
      // numeric — nulls always sink to the bottom
      if (v1 == null && v2 == null) return 0;
      if (v1 == null) return 1;
      if (v2 == null) return -1;
      return sortDir === "asc" ? v1 - v2 : v2 - v1;
    });

    tbody.innerHTML = "";
    for (const { a, vals } of sorted) {
      const tr = document.createElement("tr");
      for (const c of columns) {
        const td = document.createElement("td");
        const v = vals[c.key];
        if (c.kind === "sym") {
          const wrap = document.createElement("span");
          wrap.className = "sym-cell";
          const dot = document.createElement("span");
          dot.className = "dot";
          dot.style.background = COLORS[a.symbol] || ink("--brand");
          wrap.append(dot, document.createTextNode(a.symbol));
          td.append(wrap);
        } else if (c.kind === "usd") {
          td.textContent = fmtUsdCompact(v);
        } else if (c.kind === "num") {
          td.textContent = fmtCompact(v);
        } else if (c.kind === "price") {
          td.textContent = fmtPrice(v);
        } else {
          td.textContent = fmtDelta(v);
          td.className = v == null ? "" : v >= 0 ? "up" : "down";
        }
        tr.append(td);
      }
      tbody.append(tr);
    }
  }

  renderRows();

  if (maxSeriesLen(assets, "mentions") < 2) {
    const note = document.createElement("div");
    note.className = "legend-note";
    note.textContent =
      "Les colonnes Mentions 24h/7j/30j se remplissent au fil des jours (calculées à partir des compteurs quotidiens déjà stockés, sans requête supplémentaire).";
    container.append(note);
  }
}

// ---- Vision page --------------------------------------------------------
const METRIC_DEFS = [
  { key: "price", series: "prices", vkey: "price", dash: [], label: "prix" },
  { key: "mentions", series: "mentions", vkey: "count", dash: [5, 4], label: "mentions" },
  { key: "tvl", series: "tvl", vkey: "tvl", dash: [2, 3], label: "TVL" },
  { key: "discord", series: "discord", vkey: "members", dash: [10, 3], label: "Discord" },
  { key: "volume", series: "prices", vkey: "volume", dash: [4, 4], label: "volume" },
];

function indexedWindowed(asset, seriesName, vkey, dates, windowDays) {
  const w = windowed(asset[seriesName], windowDays);
  const by = new Map(w.map((p) => [p.date, p[vkey]]));
  const raw = dates.map((d) => ({ v: by.has(d) ? by.get(d) : null }));
  return indexSeries(raw, "v");
}

function segmented(options, current, onChange) {
  const seg = document.createElement("div");
  seg.className = "segmented";
  for (const [val, text] of options) {
    const b = document.createElement("button");
    b.textContent = text;
    b.className = val === current() ? "on" : "";
    b.addEventListener("click", () => {
      onChange(val);
      seg.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
    });
    seg.append(b);
  }
  return seg;
}

function controlGroup(labelText, control) {
  const g = document.createElement("div");
  g.className = "control-group";
  const l = document.createElement("span");
  l.className = "control-label";
  l.textContent = labelText;
  g.append(l, control);
  return g;
}

function corrClass(r) {
  if (r == null) return "";
  if (r >= 0.2) return "up";
  if (r <= -0.2) return "down";
  return "";
}

// Focused panel: Discord members · mentions · price for assets that have all
// three. One colour per asset; solid = Discord, dashed = mentions, dotted = price.
function buildCommunityPanel(root, assets) {
  const metrics = [
    { series: "discord", vkey: "members", dash: [], label: "Discord" },
    { series: "mentions", vkey: "count", dash: [5, 4], label: "mentions" },
    { series: "prices", vkey: "price", dash: [2, 3], label: "prix" },
  ];
  const state = { window: 90, selected: new Set(assets.slice(0, 4).map((a) => a.symbol)) };

  const controls = document.createElement("div");
  controls.className = "controls";
  const togglesWrap = document.createElement("div");
  togglesWrap.className = "control-group";
  controls.append(
    controlGroup(
      "Fenêtre",
      segmented(
        [[30, "30j"], [90, "90j"], [Infinity, "Max"]],
        () => state.window,
        (v) => { state.window = v; render(); }
      )
    ),
    controlGroup("Actifs", togglesWrap)
  );
  for (const a of assets) {
    const color = COLORS[a.symbol] || ink("--brand");
    const t = document.createElement("button");
    t.className = "asset-toggle" + (state.selected.has(a.symbol) ? " on" : "");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.color = color;
    dot.style.background = color;
    const name = document.createElement("span");
    name.textContent = a.symbol;
    t.append(dot, name);
    t.addEventListener("click", () => {
      if (state.selected.has(a.symbol)) state.selected.delete(a.symbol);
      else state.selected.add(a.symbol);
      t.classList.toggle("on");
      render();
    });
    togglesWrap.append(t);
  }

  const box = document.createElement("div");
  box.className = "chart-box";
  const canvas = document.createElement("canvas");
  box.append(canvas);
  const note = document.createElement("div");
  note.className = "legend-note";
  note.innerHTML =
    "Ligne pleine = <b>Discord</b>, tirets = <b>mentions</b>, pointillés = <b>prix</b>, une couleur par actif. Indexé base 100. (L'historique Discord démarre aujourd'hui et se remplit jour après jour.)";

  root.append(controls, box, note);

  let chart = null;
  function render() {
    const sel = assets.filter((a) => state.selected.has(a.symbol));
    const dates = [
      ...new Set(
        sel.flatMap((a) => metrics.flatMap((m) => windowed(a[m.series], state.window).map((p) => p.date)))
      ),
    ].sort();
    const datasets = [];
    for (const a of sel) {
      const color = COLORS[a.symbol] || ink("--brand");
      for (const m of metrics) {
        const ds = lineDataset({
          label: `${a.symbol} · ${m.label}`,
          data: indexedWindowed(a, m.series, m.vkey, dates, state.window),
          color,
        });
        ds.borderDash = m.dash;
        datasets.push(ds);
      }
    }
    chart?.destroy();
    chart = new Chart(canvas, {
      type: "line",
      data: { labels: dates, datasets },
      options: baseOptions("Indice (base 100)"),
    });
  }
  render();
}

function bootVision(allAssets) {
  const state = {
    group: "memes",
    window: 90,
    metrics: { price: true, mentions: true, tvl: true },
    selected: new Set(["CHOG"]),
  };

  const inGroup = () =>
    state.group === "all" ? allAssets : allAssets.filter((a) => a.group === state.group);
  const selectedAssets = () => inGroup().filter((a) => state.selected.has(a.symbol));

  const controlsEl = document.getElementById("vision-controls");
  const togglesWrap = document.createElement("div");
  togglesWrap.className = "control-group";

  // group / window / metric controls
  const topRow = document.createElement("div");
  topRow.className = "controls";
  topRow.append(
    controlGroup(
      "Univers",
      segmented(
        [["memes", "Memecoins"], ["majors", "Big caps"], ["all", "Tous"]],
        () => state.group,
        (v) => {
          state.group = v;
          // reset selection to the first asset of the new group
          const first = inGroup()[0];
          state.selected = new Set(first ? [first.symbol] : []);
          rebuildToggles();
          renderAll();
        }
      )
    ),
    controlGroup(
      "Fenêtre",
      segmented(
        [[30, "30j"], [90, "90j"], [Infinity, "Max"]],
        () => state.window,
        (v) => { state.window = v; renderAll(); }
      )
    ),
    controlGroup(
      "Métriques",
      (() => {
        const wrap = document.createElement("div");
        wrap.className = "control-group";
        for (const m of METRIC_DEFS) {
          const t = document.createElement("button");
          t.className = "asset-toggle" + (state.metrics[m.key] ? " on" : "");
          t.textContent = m.label[0].toUpperCase() + m.label.slice(1);
          t.addEventListener("click", () => {
            state.metrics[m.key] = !state.metrics[m.key];
            t.classList.toggle("on");
            renderAll();
          });
          wrap.append(t);
        }
        return wrap;
      })()
    )
  );

  const toggleRow = document.createElement("div");
  toggleRow.className = "controls";
  toggleRow.append(controlGroup("Actifs", togglesWrap));

  controlsEl.append(topRow, toggleRow);

  function rebuildToggles() {
    togglesWrap.innerHTML = "";
    for (const a of inGroup()) {
      const color = COLORS[a.symbol] || ink("--brand");
      const t = document.createElement("button");
      t.className = "asset-toggle" + (state.selected.has(a.symbol) ? " on" : "");
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.color = color;
      dot.style.background = color;
      const name = document.createElement("span");
      name.textContent = a.symbol;
      t.append(dot, name);
      t.addEventListener("click", () => {
        if (state.selected.has(a.symbol)) state.selected.delete(a.symbol);
        else state.selected.add(a.symbol);
        t.classList.toggle("on");
        renderAll();
      });
      togglesWrap.append(t);
    }
  }

  // charts + panels
  const chartCanvas = document.getElementById("vision-chart");
  const scatterCanvas = document.getElementById("vision-scatter");
  const corrEl = document.getElementById("vision-correlation");
  const chartNote = document.getElementById("vision-chart-note");
  let lineChart = null;
  let scatterChart = null;

  function renderLineChart() {
    const sel = selectedAssets();
    const active = METRIC_DEFS.filter((m) => state.metrics[m.key]);
    const dates = [
      ...new Set(
        sel.flatMap((a) => active.flatMap((m) => windowed(a[m.series], state.window).map((p) => p.date)))
      ),
    ].sort();

    const datasets = [];
    for (const a of sel) {
      const color = COLORS[a.symbol] || ink("--brand");
      for (const m of active) {
        datasets.push(
          lineDataset({
            label: `${a.symbol} · ${m.label}`,
            data: indexedWindowed(a, m.series, m.vkey, dates, state.window),
            color,
            dashed: false,
          })
        );
        datasets[datasets.length - 1].borderDash = m.dash;
      }
    }

    lineChart?.destroy();
    lineChart = new Chart(chartCanvas, {
      type: "line",
      data: { labels: dates, datasets },
      options: baseOptions("Indice (base 100)"),
    });
    chartNote.innerHTML =
      "Ligne pleine = <b>prix</b>, tirets = <b>mentions</b>, pointillés = <b>TVL</b>, une couleur par actif. Tout indexé base 100.";
  }

  function renderScatter() {
    const sel = selectedAssets();
    const datasets = [];
    for (const a of sel) {
      const color = COLORS[a.symbol] || ink("--brand");
      const wp = windowed(a.prices, state.window);
      const wt = windowed(a.tvl, state.window);
      if (!wp.length || !wt.length) continue;
      const priceBy = new Map(wp.map((p) => [p.date, p.price]));
      const tvlBy = new Map(wt.map((p) => [p.date, p.tvl]));
      const p0 = wp.find((p) => p.price != null)?.price;
      const t0 = wt.find((p) => p.tvl != null)?.tvl;
      const pts = [];
      for (const d of priceBy.keys()) {
        if (tvlBy.has(d) && p0 && t0) {
          pts.push({ x: (tvlBy.get(d) / t0) * 100, y: (priceBy.get(d) / p0) * 100 });
        }
      }
      datasets.push({
        label: a.symbol,
        data: pts,
        backgroundColor: color,
        borderColor: color,
        pointRadius: 3,
        pointHoverRadius: 5,
      });
    }
    scatterChart?.destroy();
    scatterChart = new Chart(scatterCanvas, {
      type: "scatter",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "top", align: "start", labels: { color: ink("--text-2"), usePointStyle: true, boxHeight: 7, padding: 14 } },
          tooltip: { backgroundColor: "#1e1a2b", borderColor: "rgba(255,255,255,0.12)", borderWidth: 1, titleColor: ink("--text"), bodyColor: ink("--text-2") },
          zoom: {
            pan: { enabled: true, mode: "xy" },
            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "xy" },
          },
        },
        scales: {
          x: { title: { display: true, text: "TVL chaîne (indice base 100)", color: ink("--text-3"), font: { size: 11 } }, grid: { color: ink("--grid") }, ticks: { color: ink("--text-3"), font: { size: 11 } } },
          y: { title: { display: true, text: "Prix (indice base 100)", color: ink("--text-3"), font: { size: 11 } }, grid: { color: ink("--grid") }, ticks: { color: ink("--text-3"), font: { size: 11 } } },
        },
      },
    });
  }

  function renderCorrelation() {
    corrEl.innerHTML = "";
    const sel = selectedAssets();
    if (!sel.length) {
      const p = document.createElement("p");
      p.className = "card-sub";
      p.textContent = "Sélectionne au moins un actif.";
      corrEl.append(p);
      return;
    }
    for (const a of sel) {
      const card = document.createElement("div");
      card.className = "corr-card";
      const h = document.createElement("div");
      h.className = "corr-head";
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = COLORS[a.symbol] || ink("--brand");
      h.append(dot, document.createTextNode(a.symbol));
      card.append(h);

      const pairs = [
        ["Prix ↔ TVL", corrLevels(a.prices, "price", a.tvl, "tvl", state.window)],
        ["Prix ↔ Mentions", corrLevels(a.prices, "price", a.mentions, "count", state.window)],
        ["Mentions ↔ TVL", corrLevels(a.mentions, "count", a.tvl, "tvl", state.window)],
      ];
      for (const [label, { r, n }] of pairs) {
        const row = document.createElement("div");
        row.className = "corr-row";
        const l = document.createElement("span");
        l.className = "corr-label";
        l.textContent = label;
        const v = document.createElement("span");
        v.className = "corr-val " + corrClass(r);
        v.textContent = r == null ? "—" : (r >= 0 ? "+" : "") + r.toFixed(2);
        const nn = document.createElement("span");
        nn.className = "corr-n";
        nn.textContent = r == null ? "" : `n=${n}`;
        row.append(l, v, nn);
        card.append(row);
      }
      corrEl.append(card);
    }
  }

  const leaderboardEl = document.getElementById("leaderboard");
  function renderVisionLeaderboard() {
    leaderboardEl.innerHTML = "";
    renderLeaderboard(leaderboardEl, inGroup());
  }

  function renderAll() {
    renderLineChart();
    renderScatter();
    renderCorrelation();
    renderVisionLeaderboard();
  }

  rebuildToggles();
  renderAll();

  // Community panel: only assets that have Discord + mentions + price data.
  const communityEl = document.getElementById("community");
  if (communityEl) {
    const dc = allAssets.filter(
      (a) => a.discord?.length && a.mentions?.length && a.prices?.length
    );
    if (dc.length) buildCommunityPanel(communityEl, dc);
  }
}

// ---- zoom/pan wiring ----------------------------------------------------
function setupZoom() {
  // The UMD plugin usually self-registers; register defensively if not.
  const zp = window.ChartZoom || window["chartjs-plugin-zoom"];
  if (zp && Chart.registry?.plugins?.get?.("zoom") == null) {
    try { Chart.register(zp); } catch (_) {}
  }

  // Double-click a chart to reset its zoom/pan.
  document.addEventListener("dblclick", (e) => {
    if (e.target?.tagName !== "CANVAS") return;
    const c = Chart.getChart(e.target);
    if (c?.resetZoom) c.resetZoom();
  });

  // A discoverability caption under every chart.
  for (const box of document.querySelectorAll(".chart-box")) {
    const hint = document.createElement("div");
    hint.className = "zoom-hint";
    hint.textContent = "Molette : zoom · glisser : déplacer · double-clic : réinitialiser";
    box.after(hint);
  }
}

// ---- bootstrap ----------------------------------------------------------
async function boot() {
  const page = document.body.dataset.page;
  setupZoom();

  const data = await fetch("./data.json").then((r) => r.json());
  const tvlByChain = data.tvlByChain || {};
  // TVL is chain-level — attach the shared series to every asset by its chain.
  for (const a of data.assets) a.tvl = tvlByChain[a.chain] || [];

  const metaEl = document.getElementById("meta");
  if (metaEl)
    metaEl.textContent =
      "Dernière collecte : " + new Date(data.generatedAt).toLocaleString("fr-FR");

  if (page === "vision") {
    bootVision(data.assets);
    return;
  }

  const assets = data.assets.filter((a) => a.group === page);

  const tilesEl = document.getElementById("tiles");
  if (tilesEl) renderTiles(tilesEl, assets);

  const leaderboardEl = document.getElementById("leaderboard");
  if (leaderboardEl) renderLeaderboard(leaderboardEl, assets);

  const chogVsPriceEl = document.getElementById("chog-mentions-price");
  if (chogVsPriceEl) {
    const chog = assets.find((a) => a.symbol === "CHOG");
    if (chog) chogMentionsVsPrice(chogVsPriceEl, chog);
  }

  const mentionsEl = document.getElementById("mentions-only");
  if (mentionsEl) mentionsOnly(mentionsEl, assets);

  const dynEl = document.getElementById("dynamic");
  if (dynEl)
    buildDynamicPanel(dynEl, assets, {
      defaultOn: page === "memes" ? ["CHOG", "PEPE", "BONK"] : ["BTC", "SOL", "MON"],
    });
}

boot();
