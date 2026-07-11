/* Asset view: a TradingView-style Lightweight Charts view for one asset.
   Price + registry indicators as indexed (base 100) overlays you toggle on/off,
   a stat header, and this asset's correlations. */

const METRIC_COLOR = {
  price: "#836ef9", volume: "#e0a000", tvl: "#3987e5",
  mentions: "#17b8a6", discord: "#e0559a",
};

// Indexed base-100 data for a metric over a window, as Lightweight Charts points.
function metricIndexed(a, m, win) {
  const w = windowed(a[m.series], win).filter((p) => p[m.vkey] != null);
  if (!w.length) return [];
  const base = w.find((p) => p[m.vkey] !== 0)?.[m.vkey];
  if (!base) return [];
  return w.map((p) => ({ time: p.date, value: (p[m.vkey] / base) * 100 }));
}

function segmentedControl(options, current, onChange) {
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

async function boot() {
  buildTopbar("");
  const data = await loadData();
  const sym = new URLSearchParams(location.search).get("sym") || "CHOG";
  const a = data.assets.find((x) => x.symbol === sym) || data.assets[0];

  // --- header
  const head = document.getElementById("asset-head");
  const dot = `<span class="head-dot" style="background:${colorOf(a.symbol)}"></span>`;
  head.innerHTML =
    `<div class="asset-title">${dot}<h1>${a.symbol}</h1><span class="asset-sub">${a.chain} · ${GROUP_LABEL[a.group] || a.group}</span></div>`;

  // --- stat header
  const stats = document.getElementById("stats");
  for (const m of METRICS) {
    const v = m.latest(a);
    const tile = document.createElement("div");
    tile.className = "stat-mini";
    const lbl = document.createElement("div");
    lbl.className = "stat-mini-label";
    lbl.textContent = m.label;
    const val = document.createElement("div");
    val.className = "stat-mini-value";
    val.textContent = fmtBy(m.format, v);
    tile.append(lbl, val);
    // primary delta (24h if available else first)
    const d = (m.deltas || [])[0];
    if (d != null) {
      const dv = pctOverDays(a[m.series], m.vkey, d);
      const chip = document.createElement("span");
      chip.className = "stat-mini-delta " + (dv == null ? "" : dv >= 0 ? "up" : "down");
      chip.textContent = fmtDelta(dv);
      tile.append(chip);
    }
    stats.append(tile);
  }

  // --- chart
  const state = { window: 90, active: new Set(["price", "mentions"]) };
  const chartEl = document.getElementById("chart");
  const chart = LightweightCharts.createChart(chartEl, {
    height: 400,
    layout: { background: { color: "transparent" }, textColor: ink("--text-2"), fontFamily: ink("--font") || "system-ui" },
    grid: { vertLines: { color: ink("--grid") }, horzLines: { color: ink("--grid") } },
    rightPriceScale: { borderColor: ink("--border") },
    timeScale: { borderColor: ink("--border"), timeVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  });
  const ro = new ResizeObserver(() => chart.applyOptions({ width: chartEl.clientWidth }));
  ro.observe(chartEl);
  chart.applyOptions({ width: chartEl.clientWidth });

  let seriesList = [];
  function renderChart() {
    for (const s of seriesList) chart.removeSeries(s);
    seriesList = [];
    for (const m of CHART_METRICS) {
      if (!state.active.has(m.id)) continue;
      const dataPts = metricIndexed(a, m, state.window);
      if (!dataPts.length) continue;
      const s = chart.addLineSeries({
        color: METRIC_COLOR[m.id] || "#836ef9",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      s.setData(dataPts);
      seriesList.push(s);
    }
    chart.timeScale().fitContent();
    document.getElementById("chart-note").innerHTML =
      "Tout indexé base 100 sur la fenêtre. Molette/glisser sur le graphe pour naviguer dans le temps.";
  }

  // --- chart controls: window + indicator toggles
  const controls = document.getElementById("chart-controls");
  const winGroup = document.createElement("div");
  winGroup.className = "control-group";
  const winLbl = document.createElement("span");
  winLbl.className = "control-label";
  winLbl.textContent = "Fenêtre";
  winGroup.append(winLbl, segmentedControl(
    [[30, "30j"], [90, "90j"], [Infinity, "Max"]],
    () => state.window,
    (v) => { state.window = v; renderChart(); }
  ));

  const indGroup = document.createElement("div");
  indGroup.className = "control-group";
  const indLbl = document.createElement("span");
  indLbl.className = "control-label";
  indLbl.textContent = "Indicateurs";
  indGroup.append(indLbl);
  for (const m of CHART_METRICS) {
    const t = document.createElement("button");
    t.className = "asset-toggle" + (state.active.has(m.id) ? " on" : "");
    const dotc = document.createElement("span");
    dotc.className = "dot";
    dotc.style.color = METRIC_COLOR[m.id];
    dotc.style.background = METRIC_COLOR[m.id];
    const name = document.createElement("span");
    name.textContent = m.label;
    t.append(dotc, name);
    t.addEventListener("click", () => {
      if (state.active.has(m.id)) state.active.delete(m.id);
      else state.active.add(m.id);
      t.classList.toggle("on");
      renderChart();
    });
    indGroup.append(t);
  }
  controls.append(winGroup, indGroup);
  renderChart();

  // --- correlations (price vs each other metric)
  const corr = document.getElementById("corr");
  const pairs = [
    ["Prix ↔ Mentions", "prices", "price", "mentions", "count"],
    ["Prix ↔ TVL", "prices", "price", "tvl", "tvl"],
    ["Prix ↔ Discord", "prices", "price", "discord", "members"],
    ["Prix ↔ Volume", "prices", "price", "prices", "volume"],
    ["Mentions ↔ TVL", "mentions", "count", "tvl", "tvl"],
    ["Mentions ↔ Discord", "mentions", "count", "discord", "members"],
  ];
  for (const [label, sA, kA, sB, kB] of pairs) {
    const { r, n } = corrLevels(a[sA], kA, a[sB], kB, state.window);
    const row = document.createElement("div");
    row.className = "corr-row corr-standalone";
    const l = document.createElement("span");
    l.className = "corr-label";
    l.textContent = label;
    const v = document.createElement("span");
    v.className = "corr-val " + (r == null ? "" : r >= 0.2 ? "up" : r <= -0.2 ? "down" : "");
    v.textContent = r == null ? "—" : (r >= 0 ? "+" : "") + r.toFixed(2);
    const nn = document.createElement("span");
    nn.className = "corr-n";
    nn.textContent = r == null ? "" : `n=${n}`;
    row.append(l, v, nn);
    corr.append(row);
  }
}

boot();
