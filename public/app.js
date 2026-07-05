/* Shared dashboard logic for both pages. Reads public/data.json (emitted by
   build-dashboard-data.js) and renders stat tiles + charts. Committed dark
   Monad-purple look. */

// Fixed per-symbol colors (identity follows the entity, never its rank).
const COLORS = {
  CHOG: "#836ef9",
  PEPE: "#199e70",
  WIF: "#c98500",
  BONK: "#d95926",
  BRETT: "#3987e5",
  MON: "#836ef9",
  BTC: "#d95926",
  ETH: "#3987e5",
  SOL: "#199e70",
  XRP: "#d55181",
  SUI: "#c98500",
  HYPE: "#e66767",
  TAO: "#008300",
};

const CSS = getComputedStyle(document.documentElement);
const ink = (name) => CSS.getPropertyValue(name).trim();

// ---- formatting ---------------------------------------------------------
function fmtCompact(n) {
  if (n == null) return "—";
  const a = Math.abs(n);
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

// ---- raw table ----------------------------------------------------------
function renderTable(tbody, assets) {
  tbody.innerHTML = "";
  for (const a of assets) {
    const color = COLORS[a.symbol] || ink("--brand");
    const price = a.prices.at(-1);
    const mentions = a.mentions.at(-1);
    const change = a.latestChange24h;
    const tr = document.createElement("tr");

    const symTd = document.createElement("td");
    const symWrap = document.createElement("span");
    symWrap.className = "sym-cell";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = color;
    symWrap.append(dot, document.createTextNode(a.symbol));
    symTd.append(symWrap);

    const chainTd = document.createElement("td");
    chainTd.textContent = a.chain;

    const mTd = document.createElement("td");
    mTd.textContent = fmtCompact(mentions?.count ?? null);

    const pTd = document.createElement("td");
    pTd.textContent = fmtPrice(price?.price ?? null);

    const dTd = document.createElement("td");
    dTd.textContent = fmtDelta(change);
    dTd.className = change == null ? "" : change >= 0 ? "up" : "down";

    tr.append(symTd, chainTd, mTd, pTd, dTd);
    tbody.append(tr);
  }
}

// ---- bootstrap ----------------------------------------------------------
async function boot() {
  const page = document.body.dataset.page;
  const data = await fetch("./data.json").then((r) => r.json());
  const assets = data.assets.filter((a) => a.group === page);

  const metaEl = document.getElementById("meta");
  if (metaEl)
    metaEl.textContent =
      "Dernière collecte : " + new Date(data.generatedAt).toLocaleString("fr-FR");

  const tilesEl = document.getElementById("tiles");
  if (tilesEl) renderTiles(tilesEl, assets);

  const tableEl = document.querySelector("#raw-table tbody");
  if (tableEl) renderTable(tableEl, assets);

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
