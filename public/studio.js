/* Studio — freeform comparison lab. TradingView-style fullscreen workspace in
   the site's Monad-purple identity: slim toolbar, side rail listing series &
   indicators (with per-line style editors), chart filling the rest, floating
   legend with live crosshair values, a vertical drawing rail (trendlines,
   H/V lines, rectangles) on a canvas overlay, and "save view" → Mon Dash.

   The math + config rendering live in studio-core.js (shared with dash.js).
   Engine: Lightweight Charts v5 (native panes, drag-resizable separators). */

const LS_KEY = "chog-studio-v2";
const LS_WIDGETS = "chog-dash-widgets-v1";
const MAX_SERIES = 8;

async function boot() {
  buildTopbar("studio");

  // A cached older studio.html served next to a newer studio.js would leave a
  // blank page (the containers this script drives wouldn't exist). Fail loudly
  // with a fix instead of rendering nothing.
  const required = ["studio-toolbar", "studio-rail", "chart", "legend", "zone-overlay", "zone-pane", "draw-rail", "draw-canvas"];
  const missing = required.filter((id) => !document.getElementById(id));
  if (missing.length) {
    const warn = document.createElement("div");
    warn.className = "studio-stale";
    warn.innerHTML = "<b>Page en cache obsolète.</b> Recharge en forçant le cache "
      + "(<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>, ou <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> sur Mac).";
    document.body.append(warn);
    console.error("Studio: stale HTML, missing #" + missing.join(", #"));
    return;
  }

  const data = await loadData();
  // Radar tokens ("SYM@chain") join the asset list: short history, but every
  // metric indicator works on them like on config assets.
  const assets = data.assets.concat(data.radarAssets || []);
  const bySym = Object.fromEntries(assets.map((a) => [a.symbol, a]));
  const metrics = METRICS.filter((m) => m.series);
  const mById = Object.fromEntries(metrics.map((m) => [m.id, m]));
  const ctx = { bySym, mById };

  // ---- state (URL > localStorage > default) ----
  const DEFAULT = {
    w: 365,
    mode: "index",
    unit: "price", // price | mcap (raw mode: show market cap = price × supply)
    tf: "D", // bar interval: D(aily) / W(eekly) / M(onthly)
    fs: 12, // chart font size
    magnet: false, // snap drawings to the anchor series values
    log: false, // logarithmic price scale on the main pane
    showSignals: true, // strategy buy/sell markers on the chart
    strat: structuredClone(STRAT_DEFAULT), // configurable signal engine (see lib.js)
    stratPreset: "swing", // "swing" | "breakout" | "saved:<name>" | "custom"
    stratAll: false, // show the every-asset results table in the rail
    series: [{ sym: "CHOG", metric: "price" }],
    inds: [
      { type: "met", metric: "mentions", target: 0, overlay: true, width: 2, dash: 0 },
      { type: "ema", period: 20, metric: "price", target: 0, overlay: true, width: 1, dash: 1 },
    ],
    draws: [],
  };
  const normInd = (i) => ({
    type: i.type,
    period: Number(i.period) || INDS[i.type]?.defPeriod || 14,
    metric: mById[i.metric] ? i.metric : (i.type === "met" ? "mentions" : "price"),
    target: Number(i.target) || 0,
    overlay: i.overlay != null ? !!i.overlay : INDS[i.type]?.overlay !== false,
    color: i.color || null,
    width: [1, 2, 3].includes(i.width) ? i.width : 1,
    dash: [0, 1, 2].includes(i.dash) ? i.dash : (INDS[i.type]?.dash ?? 0),
    hidden: !!i.hidden,
  });
  const normSerie = (e) => ({ sym: e.sym, metric: "price", color: e.color || null, hidden: !!e.hidden });

  function fromUrl() {
    const q = new URLSearchParams(location.search);
    if (!q.get("s")) return null;
    // Old links carried "SYM:metric" series — keep parsing them; migrateCfg
    // below converts non-price series into "met" indicators.
    const series = q.get("s").split(",").map((t) => {
      const [sym, metric] = t.split(":");
      return { sym, metric: metric || "price", color: null, hidden: false };
    }).filter((e) => bySym[e.sym] && mById[e.metric]);
    if (!series.length) return null;
    const cfg = {
      w: q.get("w") === "max" ? Infinity : Number(q.get("w")) || 365,
      mode: q.get("m") === "raw" ? "raw" : "index",
      series,
      inds: (q.get("i") || "").split(",").filter(Boolean).map((t) => {
        const [type, p2, target, place, metric] = t.split(":");
        return {
          type,
          period: type === "met" ? 0 : p2,
          metric: type === "met" ? p2 : metric,
          target, overlay: place !== "p",
        };
      }).filter((i) => INDS[i.type] && Number(i.target) < series.length),
      draws: [],
    };
    migrateCfg(cfg);
    cfg.series = cfg.series.map(normSerie);
    cfg.inds = cfg.inds.filter((i) => i.target < cfg.series.length).map(normInd);
    return cfg;
  }
  function fromStorage() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY));
      if (!s?.series?.length) return null;
      if (s.w === "max") s.w = Infinity;
      s.mode = s.mode === "raw" ? "raw" : "index";
      s.unit = s.unit === "mcap" ? "mcap" : "price";
      s.tf = ["D", "W", "M"].includes(s.tf) ? s.tf : "D";
      s.fs = [10, 12, 14].includes(s.fs) ? s.fs : 12;
      s.series = s.series.filter((e) => bySym[e.sym] && mById[e.metric || "price"]);
      migrateCfg(s); // older states carried metrics as series
      s.series = s.series.map(normSerie);
      s.inds = (s.inds || []).filter((i) => INDS[i.type] && i.target < s.series.length).map(normInd);
      s.draws = Array.isArray(s.draws) ? s.draws : [];
      return s.series.length ? s : null;
    } catch { return null; }
  }
  let state = { ...structuredClone(DEFAULT), ...(fromUrl() || fromStorage() || {}) };
  // A share URL describes the VIEW (series/indicators), not the strategy lab —
  // arriving via a link must not reset the locally tuned strategy.
  if (new URLSearchParams(location.search).get("s")) {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY));
      if (s?.strat) {
        state.strat = s.strat;
        state.stratPreset = s.stratPreset || "custom";
        state.stratAll = !!s.stratAll;
      }
    } catch { /* keep defaults */ }
  }
  // Strategy shape: migrate the short-lived sigMode field, then normalise —
  // stored numbers may be strings, conditions may reference removed sources.
  // Strategy shape normaliser. Runs at boot AND every time a preset or a saved
  // strategy is loaded — strategies saved before the EMA / money-management
  // fields existed carry `sma` and no sizing, and must not land half-filled.
  function normStrat(raw) {
    const st = raw && typeof raw === "object" ? raw : structuredClone(STRAT_DEFAULT);
    if (st.sma != null && st.divPeriod == null) { st.divType = "sma"; st.divPeriod = st.sma; }
    delete st.sma;
    st.divType = st.divType === "sma" ? "sma" : "ema";
    st.divPeriod = Math.max(2, Number(st.divPeriod) || 9);
    st.buyLevel = Number.isFinite(Number(st.buyLevel)) ? Number(st.buyLevel) : 0;
    st.sellLevel = Number.isFinite(Number(st.sellLevel)) ? Number(st.sellLevel) : 0;
    const normConds = (l) => (Array.isArray(l) ? l : [])
      .filter((c) => COND_SOURCES[c.ind])
      .map((c) => {
        const o = { ind: c.ind, op: c.op === ">" ? ">" : "<", val: Number(c.val) || 0, join: c.join === "or" ? "or" : "and" };
        const def = COND_SOURCES[c.ind].period;
        if (def) o.period = Math.max(2, Number(c.period) || def);
        if (c.sym && bySym[c.sym]) o.sym = c.sym; // cross-asset source (else: the charted asset)
        if (["W", "M"].includes(c.tf)) o.tf = c.tf; // higher-timeframe source (else: daily)
        return o;
      });
    st.buyConds = normConds(st.buyConds);
    st.sellConds = normConds(st.sellConds);
    st.capital = Number(st.capital) > 0 ? Number(st.capital) : 1000;
    const pct = (v, d) => Math.min(100, Math.max(1, Number(v) || d));
    st.buyPct = pct(st.buyPct, 100);
    st.sellPct = pct(st.sellPct, 100);
    st.scaleIn = !!st.scaleIn;
    st.scaleOut = !!st.scaleOut;
    st.scaleEvery = Math.max(1, Number(st.scaleEvery) || 1);
    st.maxTranches = Math.max(1, Number(st.maxTranches) || 3);
    st.noAvgDown = !!st.noAvgDown;
    st.buyCooldown = Math.max(0, Number(st.buyCooldown) || 0);
    return st;
  }
  if (!state.strat || typeof state.strat !== "object") {
    const bo = state.sigMode === "breakout";
    state.strat = bo ? STRAT_PRESETS.find((p) => p.id === "breakout").strat() : structuredClone(STRAT_DEFAULT);
    state.stratPreset = bo ? "breakout" : "swing";
  }
  delete state.sigMode;
  state.strat = normStrat(state.strat);

  const persist = () =>
    localStorage.setItem(LS_KEY, JSON.stringify({ ...state, w: state.w === Infinity ? "max" : state.w }));
  persist(); // durably store the (possibly migrated) shape right away
  const shareUrl = () => `${location.origin}${location.pathname}?${cfgToQuery(state)}`;
  const serieColor = (i) => state.series[i]?.color || PALETTE[i % PALETTE.length];

  // ---- save current view as a Mon Dash widget ----
  function saveView() {
    const name = prompt("Nom de la vue (elle apparaîtra dans Mon Dash) :", state.series.map((e) => e.sym).filter((v, i, a) => a.indexOf(v) === i).join(" · "));
    if (!name) return false;
    let widgets = [];
    try { widgets = JSON.parse(localStorage.getItem(LS_WIDGETS)) || []; } catch { widgets = []; }
    widgets.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name.trim().slice(0, 60),
      cols: 1,
      h: "m",
      cfg: {
        w: state.w === Infinity ? "max" : state.w,
        mode: state.mode,
        series: structuredClone(state.series),
        inds: structuredClone(state.inds),
      },
    });
    localStorage.setItem(LS_WIDGETS, JSON.stringify(widgets));
    return true;
  }

  // ---- chart ----
  const chartEl = document.getElementById("chart");
  const card = document.getElementById("studio-card");
  const chart = LightweightCharts.createChart(chartEl, studioChartOptions(state.fs));

  const isFs = () => document.fullscreenElement === card || card.classList.contains("studio-fs");
  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    } else if (card.requestFullscreen) {
      await card.requestFullscreen().catch(() => card.classList.toggle("studio-fs"));
    } else {
      card.classList.toggle("studio-fs");
    }
    renderToolbar();
  }
  document.addEventListener("fullscreenchange", renderToolbar);

  // ---- render chart + floating legend (from core renderConfig) ----
  let drawn = [];
  let legendMap = [];
  let anchorSeries = null;
  let signalCache = { buys: [], sells: [] }; // Divergence+RSI events for the anchor asset
  function renderChart() {
    for (const s of drawn) chart.removeSeries(s);
    const res = renderConfig(chart, state, ctx);
    drawn = res.created;
    anchorSeries = res.anchorSeries;
    paneAnchors = res.paneAnchors || [];
    paneLabelsData = res.paneLabels || [];
    vprofiles = res.vprofiles || [];
    setTimeout(renderPaneLabels, 30); // after panes lay out
    try {
      const MODE = LightweightCharts.PriceScaleMode;
      chart.priceScale("right", 0).applyOptions({ mode: state.log ? MODE.Logarithmic : MODE.Normal });
      // Sub-panes must stay LINEAR: they host oscillators that go negative
      // (divergence, MACD, flows) and a log scale cannot plot ≤ 0 — it renders a
      // clipped, non-linear mess. A pane created by a later render inherits the
      // chart-level right-scale options, so the log mode set just above leaks
      // into it (that was the "switch Prix/MC and the sub-pane breaks until you
      // re-click Log" bug). Force every sub-pane back to Normal after each render.
      const panes = chart.panes();
      for (let i = 1; i < panes.length; i++) {
        try { chart.priceScale("right", i).applyOptions({ mode: MODE.Normal }); } catch { /* pane has no right scale */ }
      }
    } catch { /* scale mode is cosmetic */ }
    // magnet snap map: displayed values of the first series, by date; plus a
    // raw daily volume-by-date map used by the fixed-range volume profile tool.
    anchorPtsCache = new Map();
    volByCache = new Map();
    if (state.series[0]) {
      for (const p of seriesPts(bySym[state.series[0].sym], mById.price, state.w, state.mode === "index")) {
        anchorPtsCache.set(p.time, p.value);
      }
      for (const p of bySym[state.series[0].sym].prices || []) volByCache.set(p.date, p.volume || 0);
    }
    // Divergence+RSI buy/sell events for the charted asset (recomputed per render,
    // drawn on the overlay in redrawDraws — same rule as the Signaux backtest).
    signalCache = (state.showSignals !== false && state.series[0] && bySym[state.series[0].sym]?.divergence?.length)
      ? stratSignals(bySym[state.series[0].sym], state.strat, bySym)
      : { buys: [], sells: [] };
    legendMap = [];
    const legend = document.getElementById("legend");
    legend.innerHTML = "";
    for (const it of res.items) {
      const row = document.createElement("div");
      row.className = "fl-row" + (it.sub ? " sub" : "") + (it.struck ? " off" : "");
      row.innerHTML = `<span class="fl-dot" style="background:${it.color}"></span><b>${it.label}</b>`;
      if (it.series || it.value != null) {
        const v = document.createElement("span");
        v.className = "fl-val";
        v.textContent = it.value != null ? it.fmt(it.value) : "—";
        row.append(v);
        if (it.series) legendMap.push({ series: it.series, el: v, last: it.value, fmt: it.fmt });
      }
      legend.append(row);
    }
    // journal milestones (global + studio-scoped) as markers on the anchor
    if (state.showEvents !== false && res.anchorSeries && state.series[0]) {
      const evts = journalEvents("studio");
      if (evts.length) {
        const pts0 = seriesPts(bySym[state.series[0].sym], mById.price, state.w, state.mode === "index");
        applyEventMarkers(res.anchorSeries, pts0, evts);
      }
    }
    requestAnimationFrame(redrawDraws);
  }
  chart.subscribeCrosshairMove((param) => {
    for (const { series, el, last, fmt } of legendMap) {
      const d = param.seriesData?.get(series);
      const v = d?.value ?? last;
      el.textContent = v != null ? fmt(v) : "—";
    }
  });

  // ---- drawing tools (canvas overlay, manipulable) ----
  const drawCanvas = document.getElementById("draw-canvas");
  const dctx = drawCanvas.getContext("2d");
  const chartZone = drawCanvas.parentElement; // .studio-chartzone
  let drawMode = "cursor";
  let pending = null;
  let mousePx = null;
  let selIdx = null;    // selected drawing (shows handles, Delete removes)
  let dragging = null;  // { part: "body"|"p1"|"p2", sx, sy, p1, p2 }

  // Older stored draws predate per-draw styling.
  state.draws.forEach((d) => { d.width ??= 2; d.dash ??= 0; d.color ??= "#9d8bff"; });

  const TOOLS = [
    ["cursor", "✥", "Curseur (naviguer · cliquer un tracé pour le sélectionner/déplacer)"],
    ["trend", "╱", "Ligne de tendance (2 clics)"],
    ["ray", "↗", "Demi-droite (2 clics, prolongée vers la droite)"],
    ["eline", "↔", "Ligne étendue (2 clics, prolongée des deux côtés)"],
    ["hray", "⇢", "Rayon horizontal (1 clic, vers la droite)"],
    ["hline", "─", "Ligne horizontale (1 clic)"],
    ["vline", "│", "Ligne verticale (1 clic)"],
    ["channel", "∥", "Canal parallèle (3 clics : ligne puis largeur)"],
    ["rect", "▭", "Rectangle (2 clics)"],
    ["vpfix", "▤", "Volume Profile à gamme fixe (2 clics : début → fin de la plage)"],
    ["text", "T", "Texte (1 clic)"],
    ["measure", "📏", "Mesure (glisser : Δ prix, Δ %, Δ jours — non persistée, Échap pour effacer)"],
    ["erase", "⌫", "Gomme (clic sur un tracé)"],
  ];
  const TWO_CLICK = ["trend", "ray", "eline", "rect", "vpfix"];
  const TEXT_SIZES = { 1: 11, 2: 13, 3: 16 };
  const tStr = (t) => typeof t === "string" ? t
    : t && t.year ? `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}` : null;
  // Days between two chart times (daily bars → linear interpolation basis).
  const daysBetween = (t1, t2) => (new Date(tStr(t2) + "T00:00:00Z") - new Date(tStr(t1) + "T00:00:00Z")) / 864e5;
  const lineValueAt = (p1, p2, t) => {
    const span = daysBetween(p1.t, p2.t) || 1;
    return p1.v + (p2.v - p1.v) * (daysBetween(p1.t, t) / span);
  };
  // Magnet: snap a placed/dragged point's value onto the anchor series.
  let anchorPtsCache = new Map(); // dateStr -> displayed value
  let volByCache = new Map(); // dateStr -> raw daily volume (fixed-range vol profile)
  const maybeSnap = (pt) => {
    if (!state.magnet || !pt || pt.t == null || (pt.pane ?? 0) !== 0) return pt;
    const v = anchorPtsCache.get(tStr(pt.t));
    return v != null ? { ...pt, v } : pt;
  };
  // Measure tool overlay (never persisted).
  let measureBox = null; // { a:{x,y,t,v}, b:{x,y,t,v} }
  let measuring = false;
  // Volume profiles computed by renderConfig, painted here.
  let vprofiles = [];
  // Clipboard + undo for drawings.
  let clipboardDraw = null;
  const undoStack = [];
  const pushUndo = () => {
    undoStack.push(JSON.stringify(state.draws));
    if (undoStack.length > 40) undoStack.shift();
  };
  // Pane-aware conversions: LWC v5 price coordinates are relative to their
  // pane, so each drawing stores its pane and is anchored to that pane's first
  // series. Offsets = cumulated pane heights (+1px separators).
  let paneAnchors = [];
  let paneLabelsData = [];
  // In-pane caption (like the price legend, but for each sub-pane): a coloured
  // dot + the indicator name, pinned at the pane's top-left so you always know
  // what a sub-pane shows.
  function renderPaneLabels() {
    let host = chartZone.querySelector(".pane-caps");
    if (!host) { host = document.createElement("div"); host.className = "pane-caps"; chartZone.append(host); }
    host.innerHTML = "";
    const offs = paneOffsets();
    for (let i = 1; i < offs.length; i++) {
      const info = paneLabelsData[i];
      if (!info) continue;
      const el = document.createElement("div");
      el.className = "pane-cap";
      el.style.top = (offs[i] + 4) + "px";
      el.innerHTML = `<span class="fl-dot" style="background:${info.color}"></span>${info.label}`;
      host.append(el);
    }
  }
  const paneOffsets = () => {
    const offs = [0];
    try {
      const panes = chart.panes();
      let acc = 0;
      for (let i = 0; i < panes.length - 1; i++) {
        acc += panes[i].getHeight() + 1;
        offs.push(acc);
      }
    } catch { /* single pane */ }
    return offs;
  };
  const paneAt = (y) => {
    const offs = paneOffsets();
    let i = 0;
    for (let k = 0; k < offs.length; k++) if (y >= offs[k]) i = k;
    return { pane: i, off: offs[i] };
  };
  const anchorFor = (pane) => paneAnchors[pane] || anchorSeries;
  const toXY = (pt, pane = 0) => {
    const x = pt.t != null ? chart.timeScale().timeToCoordinate(pt.t) : null;
    const a = anchorFor(pane);
    const yy = pt.v != null && a ? a.priceToCoordinate(pt.v) : null;
    return { x, y: yy == null ? null : yy + (paneOffsets()[pane] ?? 0) };
  };
  const fromPx = (x, y) => {
    const t = chart.timeScale().coordinateToTime(x);
    const { pane, off } = paneAt(y);
    const a = anchorFor(pane);
    return { t, v: a ? a.coordinateToPrice(y - off) : null, pane };
  };
  const fromPxIn = (x, y, pane) => {
    const t = chart.timeScale().coordinateToTime(x);
    const a = anchorFor(pane);
    return { t, v: a ? a.coordinateToPrice(y - (paneOffsets()[pane] ?? 0)) : null, pane };
  };
  function sizeCanvas() {
    const r = chartEl.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    drawCanvas.width = r.width * dpr;
    drawCanvas.height = r.height * dpr;
    drawCanvas.style.width = r.width + "px";
    drawCanvas.style.height = r.height + "px";
    dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  // Extend segment a→b to the canvas border past b (for rays).
  function extendToEdge(a, b, W, H) {
    const dx = b.x - a.x, dy = b.y - a.y;
    if (dx === 0 && dy === 0) return b;
    let t = Infinity;
    if (dx > 0) t = (W - a.x) / dx; else if (dx < 0) t = -a.x / dx;
    if (dy > 0) t = Math.min(t, (H - a.y) / dy); else if (dy < 0) t = Math.min(t, -a.y / dy);
    return { x: a.x + dx * t, y: a.y + dy * t };
  }
  const dashPattern = (d) => (d === 2 ? [6, 5] : d === 1 ? [2, 4] : []);
  // Pixel endpoints exposing the drag handles of a drawing.
  function endpointsPx(d) {
    const W = drawCanvas.clientWidth, H = drawCanvas.clientHeight;
    if (d.type === "hline") { const { y } = toXY({ v: d.p1.v }, d.pane || 0); return y == null ? [] : [{ x: W / 2, y, part: "p1" }]; }
    if (d.type === "vline") { const { x } = toXY({ t: d.p1.t }); return x == null ? [] : [{ x, y: H / 2, part: "p1" }]; }
    if (d.type === "text" || d.type === "hray") {
      const a = toXY(d.p1, d.pane || 0);
      return a.x == null || a.y == null ? [] : [{ ...a, part: "p1" }];
    }
    if (d.type === "vpfix") {
      const x1 = chart.timeScale().timeToCoordinate(d.p1.t), x2 = chart.timeScale().timeToCoordinate(d.p2.t);
      const out = [];
      if (x1 != null) out.push({ x: x1, y: H / 2, part: "p1" });
      if (x2 != null) out.push({ x: x2, y: H / 2, part: "p2" });
      return out;
    }
    const a = toXY(d.p1, d.pane || 0), b = toXY(d.p2, d.pane || 0);
    if (a.x == null || a.y == null || b.x == null || b.y == null) return [];
    const pts = [{ ...a, part: "p1" }, { ...b, part: "p2" }];
    if (d.type === "channel") {
      // third handle in the middle of the parallel line → adjusts the width
      const off = toXY({ t: d.p1.t, v: d.p1.v + d.dv }, d.pane || 0);
      if (off.y != null) pts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + (off.y - a.y), part: "dv" });
    }
    return pts;
  }
  // Fixed-range volume profile: histogram of volume per price level over the
  // user-drawn time range [t1,t2] (displayed price levels from anchorPtsCache,
  // raw daily volume from volByCache). Independent of the anchored Volume
  // Profile indicator, which spans the whole window.
  function vpfixRows(t1, t2) {
    const ta = tStr(t1) < tStr(t2) ? tStr(t1) : tStr(t2);
    const tb = tStr(t1) < tStr(t2) ? tStr(t2) : tStr(t1);
    const pts = [];
    for (const [date, level] of anchorPtsCache) if (date >= ta && date <= tb && level != null) pts.push({ date, level });
    if (pts.length < 3) return null;
    const vals = pts.map((p) => p.level);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const N = 24, step = (hi - lo) / N || 1;
    const rows = Array.from({ length: N }, (_, i) => ({ v0: lo + i * step, v1: lo + (i + 1) * step, vol: 0 }));
    for (const p of pts) rows[Math.min(N - 1, Math.floor((p.level - lo) / step))].vol += volByCache.get(p.date) || 0;
    let max = 0, poc = -1;
    rows.forEach((r, i) => { if (r.vol > max) { max = r.vol; poc = i; } });
    return max > 0 ? { rows, max, poc, ta, tb } : null;
  }
  function paintVpfix(d, selected) {
    const H = drawCanvas.clientHeight;
    const color = d.color || "#9d8bff";
    const x1 = chart.timeScale().timeToCoordinate(d.p1.t);
    const x2 = chart.timeScale().timeToCoordinate(d.p2.t);
    if (x1 == null || x2 == null) return;
    const xa = Math.min(x1, x2), xb = Math.max(x1, x2);
    // range box
    dctx.setLineDash([4, 3]);
    dctx.lineWidth = selected ? 1.6 : 1;
    dctx.strokeStyle = color;
    dctx.strokeRect(xa, 0, xb - xa, H);
    dctx.fillStyle = color + "12";
    dctx.fillRect(xa, 0, xb - xa, H);
    dctx.setLineDash([]);
    const prof = vpfixRows(d.p1.t, d.p2.t);
    const a = anchorFor(0);
    if (!prof || !a) return;
    const off = paneOffsets()[0] || 0;
    const maxBar = Math.min((xb - xa) * 0.92, 170);
    for (let i = 0; i < prof.rows.length; i++) {
      const r = prof.rows[i];
      const y0 = a.priceToCoordinate(r.v1), y1 = a.priceToCoordinate(r.v0);
      if (y0 == null || y1 == null) continue;
      const top = Math.min(y0, y1) + off, hgt = Math.max(1, Math.abs(y1 - y0) - 1);
      const w = (r.vol / prof.max) * maxBar;
      dctx.fillStyle = i === prof.poc ? color + "cc" : color + "5a";
      dctx.fillRect(xb - w, top, w, hgt); // bars anchored at the range's right edge
    }
  }
  function strokeShape(d, preview = false, selected = false) {
    const W = drawCanvas.clientWidth, H = drawCanvas.clientHeight;
    const color = d.color || "#9d8bff";
    if (d.type === "vpfix") { paintVpfix(d, selected); if (selected) for (const h of endpointsPx(d)) { dctx.beginPath(); dctx.arc(h.x, h.y, 4.5, 0, Math.PI * 2); dctx.fillStyle = ink("--bg") || "#0b0912"; dctx.fill(); dctx.lineWidth = 1.8; dctx.strokeStyle = color; dctx.stroke(); } return; }
    dctx.strokeStyle = color;
    dctx.lineWidth = (d.width || 2) + (selected ? 0.8 : 0);
    dctx.setLineDash(preview ? [5, 4] : dashPattern(d.dash || 0));
    dctx.beginPath();
    if (d.type === "hline") {
      const { y } = toXY({ v: d.p1.v }, d.pane || 0);
      if (y == null) return;
      dctx.moveTo(0, y);
      dctx.lineTo(W, y);
    } else if (d.type === "vline") {
      const { x } = toXY({ t: d.p1.t });
      if (x == null) return;
      dctx.moveTo(x, 0);
      dctx.lineTo(x, H);
    } else if (d.type === "text") {
      const a = toXY(d.p1, d.pane || 0);
      if (a.x == null || a.y == null) return;
      dctx.setLineDash([]);
      dctx.font = `600 ${TEXT_SIZES[d.width || 2]}px ${ink("--font") || "system-ui"}`;
      dctx.fillStyle = color;
      dctx.fillText(d.text || "…", a.x, a.y);
    } else if (d.type === "hray") {
      const a = toXY(d.p1, d.pane || 0);
      if (a.x == null || a.y == null) return;
      dctx.moveTo(a.x, a.y);
      dctx.lineTo(W, a.y);
    } else {
      const a = toXY(d.p1, d.pane || 0), b = toXY(d.p2, d.pane || 0);
      if (a.x == null || a.y == null || b.x == null || b.y == null) return;
      if (d.type === "trend") {
        dctx.moveTo(a.x, a.y);
        dctx.lineTo(b.x, b.y);
      } else if (d.type === "ray") {
        const e = extendToEdge(a, b, W, H);
        dctx.moveTo(a.x, a.y);
        dctx.lineTo(e.x, e.y);
      } else if (d.type === "eline") {
        const e1 = extendToEdge(b, a, W, H); // through a, away from b
        const e2 = extendToEdge(a, b, W, H); // through b, away from a
        dctx.moveTo(e1.x, e1.y);
        dctx.lineTo(e2.x, e2.y);
      } else if (d.type === "channel") {
        const off = toXY({ t: d.p1.t, v: d.p1.v + (d.dv || 0) }, d.pane || 0);
        const dy = off.y != null ? off.y - a.y : 0;
        dctx.moveTo(a.x, a.y);
        dctx.lineTo(b.x, b.y);
        dctx.moveTo(a.x, a.y + dy);
        dctx.lineTo(b.x, b.y + dy);
        dctx.stroke();
        dctx.beginPath();
        dctx.moveTo(a.x, a.y);
        dctx.lineTo(b.x, b.y);
        dctx.lineTo(b.x, b.y + dy);
        dctx.lineTo(a.x, a.y + dy);
        dctx.closePath();
        dctx.fillStyle = color + "1e";
        dctx.fill();
        dctx.beginPath(); // stroke already done above
      } else if (d.type === "rect") {
        dctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        dctx.fillStyle = color + "22";
        dctx.fill();
      }
    }
    if (d.type !== "text") dctx.stroke();
    dctx.setLineDash([]);
    if (selected) {
      for (const h of endpointsPx(d)) {
        dctx.beginPath();
        dctx.arc(h.x, h.y, 4.5, 0, Math.PI * 2);
        dctx.fillStyle = ink("--bg") || "#0b0912";
        dctx.fill();
        dctx.lineWidth = 1.8;
        dctx.strokeStyle = color;
        dctx.stroke();
      }
    }
  }
  function redrawDraws() {
    sizeCanvas();
    dctx.clearRect(0, 0, drawCanvas.clientWidth, drawCanvas.clientHeight);
    // journal milestones as dashed vertical lines (in addition to the markers)
    if (state.showEvents !== false) {
      const H = drawCanvas.clientHeight;
      for (const e of journalEvents("studio")) {
        const x = chart.timeScale().timeToCoordinate(e.date);
        if (x == null) continue;
        dctx.setLineDash([3, 4]);
        dctx.strokeStyle = journalCatColor(e.cat) + "88";
        dctx.lineWidth = 1;
        dctx.beginPath();
        dctx.moveTo(x, 0);
        dctx.lineTo(x, H);
        dctx.stroke();
        dctx.setLineDash([]);
      }
    }
    // Divergence+RSI buy/sell signals — vertical line at the event date
    // (achat vert / vente rouge) + a triangle at the entry price on the main
    // pane. Same rule as the Signaux backtest, so it's verifiable by eye.
    if (state.showSignals !== false && (signalCache.buys.length || signalCache.sells.length)) {
      const H = drawCanvas.clientHeight;
      const paint = (evs, color, dir) => {
        for (const e of evs) {
          const x = chart.timeScale().timeToCoordinate(e.date);
          if (x == null) continue;
          dctx.setLineDash([]);
          dctx.strokeStyle = color + "9a";
          dctx.lineWidth = 1.5;
          dctx.beginPath(); dctx.moveTo(x, 0); dctx.lineTo(x, H); dctx.stroke();
          const dv = anchorPtsCache.get(e.date);
          const y = dv != null && anchorSeries ? anchorSeries.priceToCoordinate(dv) : null;
          const ty = y != null ? y : (dir > 0 ? H - 16 : 16); // fallback to pane edge
          // marker size tracks the tranche fraction — a 25% entry reads smaller
          const s = 4 + 3.5 * Math.min(1, e.frac ?? 1), off = dir > 0 ? 13 : -13;
          dctx.fillStyle = color;
          dctx.beginPath();
          if (dir > 0) { dctx.moveTo(x, ty + off - s); dctx.lineTo(x - s, ty + off + s); dctx.lineTo(x + s, ty + off + s); }
          else { dctx.moveTo(x, ty + off + s); dctx.lineTo(x - s, ty + off - s); dctx.lineTo(x + s, ty + off - s); }
          dctx.closePath(); dctx.fill();
        }
      };
      paint(signalCache.buys, "#2fbf71", 1);
      paint(signalCache.sells, "#ff5c6c", -1);
      // legend count (top-left)
      dctx.font = "11px system-ui, sans-serif";
      dctx.fillStyle = "#2fbf71";
      dctx.fillText(`▲ ${signalCache.buys.length} achat${signalCache.buys.length > 1 ? "s" : ""}`, 8, 14);
      dctx.fillStyle = "#ff5c6c";
      dctx.fillText(`▼ ${signalCache.sells.length} vente${signalCache.sells.length > 1 ? "s" : ""}`, 8, 28);
    }
    // volume profiles (computed by renderConfig, painted on the overlay)
    if (vprofiles.length && anchorSeries) {
      const W = drawCanvas.clientWidth;
      for (const vp of vprofiles) {
        for (const row of vp.rows) {
          const y0 = anchorSeries.priceToCoordinate(row.v1);
          const y1 = anchorSeries.priceToCoordinate(row.v0);
          if (y0 == null || y1 == null || row.vol <= 0) continue;
          const w = (row.vol / vp.max) * W * 0.22;
          const poc = row.vol === vp.max;
          dctx.fillStyle = vp.color + (poc ? "66" : "2e");
          dctx.fillRect(W - w, Math.min(y0, y1), w, Math.max(1, Math.abs(y1 - y0) - 1));
          if (poc) {
            dctx.strokeStyle = vp.color;
            dctx.setLineDash([4, 3]);
            dctx.lineWidth = 1;
            const yc = (y0 + y1) / 2;
            dctx.beginPath();
            dctx.moveTo(0, yc);
            dctx.lineTo(W, yc);
            dctx.stroke();
            dctx.setLineDash([]);
          }
        }
      }
    }
    state.draws.forEach((d, i) => strokeShape(d, false, i === selIdx));
    // in-progress placement previews
    if (pending && mousePx) {
      const cur = maybeSnap(fromPxIn(mousePx.x, mousePx.y, pending.pane || 0));
      if (cur.t != null || cur.v != null) {
        if (drawMode === "channel") {
          if (!pending.p2) {
            strokeShape({ type: "trend", p1: pending.p1, p2: { t: cur.t, v: cur.v }, pane: pending.pane, color: "#9d8bff" }, true);
          } else {
            const dv = (cur.v ?? 0) - lineValueAt(pending.p1, pending.p2, cur.t ?? pending.p2.t);
            strokeShape({ type: "channel", p1: pending.p1, p2: pending.p2, dv, pane: pending.pane, color: "#9d8bff" }, true);
          }
        } else {
          strokeShape({ type: drawMode, p1: pending.p1, p2: { t: cur.t, v: cur.v }, pane: pending.pane, color: "#9d8bff" }, true);
        }
      }
    }
    // measure overlay (Δ price, Δ %, Δ days)
    if (measureBox) {
      const a = measureBox.a, m = measureBox.b;
      dctx.strokeStyle = "#9d8bff";
      dctx.setLineDash([4, 3]);
      dctx.lineWidth = 1;
      dctx.strokeRect(Math.min(a.x, m.x), Math.min(a.y, m.y), Math.abs(m.x - a.x), Math.abs(m.y - a.y));
      dctx.setLineDash([]);
      dctx.fillStyle = "rgba(131,110,249,0.10)";
      dctx.fillRect(Math.min(a.x, m.x), Math.min(a.y, m.y), Math.abs(m.x - a.x), Math.abs(m.y - a.y));
      if (a.v != null && m.v != null) {
        const dPct = a.v !== 0 ? ((m.v - a.v) / Math.abs(a.v)) * 100 : 0;
        const dDays = a.t != null && m.t != null ? Math.round(daysBetween(a.t, m.t)) : null;
        const lines = [
          `Δ ${state.mode === "index" ? (m.v - a.v).toFixed(1) + " pt" : fmtBy("price", Math.abs(m.v - a.v))}  (${dPct >= 0 ? "+" : ""}${dPct.toFixed(2)}%)`,
          dDays != null ? `${dDays >= 0 ? "" : "−"}${Math.abs(dDays)} jours` : "",
        ].filter(Boolean);
        const bx = Math.max(8, Math.min(m.x + 10, drawCanvas.clientWidth - 170));
        const by = Math.max(20, m.y - 10);
        dctx.font = `600 12px ${ink("--font") || "system-ui"}`;
        const wBox = 12 + Math.max(...lines.map((l) => dctx.measureText(l).width));
        dctx.fillStyle = "rgba(11,9,18,0.92)";
        dctx.fillRect(bx - 6, by - 15, wBox, 16 * lines.length + 8);
        dctx.strokeStyle = "#9d8bff";
        dctx.strokeRect(bx - 6, by - 15, wBox, 16 * lines.length + 8);
        dctx.fillStyle = dPct >= 0 ? "#35d07f" : "#ff6b6b";
        lines.forEach((l, i) => dctx.fillText(l, bx, by + i * 16));
      }
    }
  }
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => redrawDraws());
  new ResizeObserver(() => redrawDraws()).observe(chartEl);

  const distToSeg = (px, py, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
  };
  function hitTest(px, py) {
    const W = drawCanvas.clientWidth, H = drawCanvas.clientHeight;
    for (let i = state.draws.length - 1; i >= 0; i--) {
      const d = state.draws[i];
      if (d.type === "hline") {
        const { y } = toXY({ v: d.p1.v }, d.pane || 0);
        if (y != null && Math.abs(py - y) < 7) return i;
      } else if (d.type === "vline") {
        const { x } = toXY({ t: d.p1.t });
        if (x != null && Math.abs(px - x) < 7) return i;
      } else if (d.type === "text") {
        const a = toXY(d.p1, d.pane || 0);
        if (a.x == null || a.y == null) continue;
        dctx.font = `600 ${TEXT_SIZES[d.width || 2]}px ${ink("--font") || "system-ui"}`;
        const w = dctx.measureText(d.text || "…").width;
        const h = TEXT_SIZES[d.width || 2];
        if (px >= a.x - 4 && px <= a.x + w + 4 && py >= a.y - h - 4 && py <= a.y + 6) return i;
      } else if (d.type === "hray") {
        const a = toXY(d.p1, d.pane || 0);
        if (a.x != null && a.y != null && px >= a.x - 7 && Math.abs(py - a.y) < 7) return i;
      } else if (d.type === "vpfix") {
        const x1 = toXY({ t: d.p1.t }).x, x2 = toXY({ t: d.p2.t }).x;
        if (x1 != null && x2 != null) {
          const xa = Math.min(x1, x2), xb = Math.max(x1, x2);
          if (Math.abs(px - xa) < 7 || Math.abs(px - xb) < 7 || (px >= xa && px <= xb && py < 22)) return i;
        }
      } else {
        const a = toXY(d.p1, d.pane || 0), b = toXY(d.p2, d.pane || 0);
        if (a.x == null || b.x == null) continue;
        if (d.type === "trend" && distToSeg(px, py, a, b) < 7) return i;
        if (d.type === "ray" && distToSeg(px, py, a, extendToEdge(a, b, W, H)) < 7) return i;
        if (d.type === "eline"
          && distToSeg(px, py, extendToEdge(b, a, W, H), extendToEdge(a, b, W, H)) < 7) return i;
        if (d.type === "channel") {
          if (distToSeg(px, py, a, b) < 7) return i;
          const off = toXY({ t: d.p1.t, v: d.p1.v + (d.dv || 0) }, d.pane || 0);
          const dy = off.y != null ? off.y - a.y : 0;
          if (distToSeg(px, py, { x: a.x, y: a.y + dy }, { x: b.x, y: b.y + dy }) < 7) return i;
        }
        if (d.type === "rect") {
          const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
          const nearEdge = (Math.abs(px - x1) < 7 || Math.abs(px - x2) < 7) && py > y1 - 7 && py < y2 + 7
            || (Math.abs(py - y1) < 7 || Math.abs(py - y2) < 7) && px > x1 - 7 && px < x2 + 7;
          if (nearEdge) return i;
        }
      }
    }
    return -1;
  }
  // Endpoint handle under the pointer, checked before body hits (9px radius).
  function handleAt(px, py) {
    for (let i = state.draws.length - 1; i >= 0; i--) {
      for (const h of endpointsPx(state.draws[i])) {
        if (Math.hypot(px - h.x, py - h.y) < 9) return { idx: i, part: h.part };
      }
    }
    return null;
  }
  function setDrawMode(mode) {
    drawMode = mode;
    pending = null;
    if (mode !== "measure") { measureBox = null; measuring = false; }
    if (mode !== "cursor") { selIdx = null; closeCtxMenu(); }
    document.body.classList.toggle("drawing", mode !== "cursor");
    renderDrawRail();
    redrawDraws();
  }

  // ---- selection, move & resize (cursor mode) ----
  // Capture-phase pointerdown: if a drawing (or one of its handles) is under
  // the pointer we take the gesture (the chart never sees it, so it doesn't
  // pan); otherwise we do nothing and panning works as usual.
  const relPx = (ev) => {
    const r = drawCanvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  function applyDragTo(d, part, dx, dy, orig) {
    const shift = (pt) => {
      const px = toXYOrig(orig[pt === "p1" ? "a" : "b"]);
      if (!px) return null;
      return fromPxIn(px.x + dx, px.y + dy, d.pane || 0);
    };
    if (part === "body") {
      const n1 = shift("p1");
      if (n1) {
        if (d.type === "hline") { if (n1.v != null) d.p1 = { v: n1.v }; }
        else if (d.type === "vline") { if (n1.t != null) d.p1 = { t: n1.t }; }
        else if (n1.t != null && n1.v != null) d.p1 = { t: n1.t, v: n1.v };
      }
      if (d.p2) {
        const n2 = shift("p2");
        if (n2 && n2.t != null && n2.v != null) d.p2 = { t: n2.t, v: n2.v };
      }
    } else if (part === "dv") {
      // channel width handle: dv = cursor value − line value at cursor time
      const cur = fromPxIn(mousePx.x, mousePx.y, d.pane || 0);
      if (cur.v != null && cur.t != null) d.dv = cur.v - lineValueAt(d.p1, d.p2, cur.t);
    } else {
      const cur = maybeSnap(fromPxIn(mousePx.x, mousePx.y, d.pane || 0));
      if (d.type === "hline") { if (cur.v != null) d.p1 = { v: cur.v }; }
      else if (d.type === "vline") { if (cur.t != null) d.p1 = { t: cur.t }; }
      else if (cur.t != null && cur.v != null) d[part] = { t: cur.t, v: cur.v };
    }
  }
  // Pixel positions of the anchors at drag start (so "move" is a pure delta).
  let dragOrigPx = null;
  const toXYOrig = (pt) => pt || null;
  chartZone.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0 || drawMode !== "cursor") return;
    const { x, y } = relPx(ev);
    const h = handleAt(x, y);
    const bodyIdx = h ? -1 : hitTest(x, y);
    if (!h && bodyIdx < 0) {
      if (selIdx != null) { selIdx = null; closeCtxMenu(); redrawDraws(); }
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    closeCtxMenu();
    pushUndo(); // snapshot before the move/resize
    selIdx = h ? h.idx : bodyIdx;
    const d = state.draws[selIdx];
    // Keep partial coords: hline anchors only carry y, vline only x — fromPx
    // in applyDragTo tolerates NaN on the unused axis.
    dragOrigPx = { a: d.p1 ? toXY(d.p1, d.pane || 0) : null, b: d.p2 ? toXY(d.p2, d.pane || 0) : null };
    dragging = { part: h ? h.part : "body", sx: x, sy: y };
    mousePx = { x, y };
    const onMove = (mev) => {
      mousePx = relPx(mev);
      applyDragTo(d, dragging.part, mousePx.x - dragging.sx, mousePx.y - dragging.sy, dragOrigPx);
      redrawDraws();
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dragging = null;
      persist();
      redrawDraws();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    redrawDraws();
  }, true);
  // Hover feedback in cursor mode.
  chartZone.addEventListener("pointermove", (ev) => {
    if (drawMode !== "cursor" || dragging) return;
    const { x, y } = relPx(ev);
    chartZone.style.cursor = handleAt(x, y) ? "crosshair" : hitTest(x, y) >= 0 ? "grab" : "";
  });
  // Double-click a text drawing to edit it.
  // Double-click a pane to ISOLATE it full-height (hide the others), like
  // TradingView's maximize; double-click again to restore the proportional
  // layout. Editing a text drawing takes priority.
  let maximizedPane = null;
  function togglePaneMax(paneIdx) {
    let panes; try { panes = chart.panes(); } catch { return; }
    if (!panes || panes.length < 2) return;
    if (maximizedPane === paneIdx) {
      const nSub = panes.length - 1;
      panes.forEach((p, i) => p.setStretchFactor(i === 0 ? Math.max(1.4, nSub) : 1));
      maximizedPane = null;
    } else {
      panes.forEach((p, i) => p.setStretchFactor(i === paneIdx ? 1000 : 0.001));
      maximizedPane = paneIdx;
    }
    setTimeout(() => { redrawDraws(); renderPaneLabels(); }, 0);
  }
  chartZone.addEventListener("dblclick", (ev) => {
    if (drawMode !== "cursor") return;
    const { x, y } = relPx(ev);
    const i = hitTest(x, y);
    if (i >= 0 && state.draws[i].type === "text") {
      const t = prompt("Texte :", state.draws[i].text || "");
      if (t != null) { state.draws[i].text = t.trim() || "…"; persist(); redrawDraws(); }
      return;
    }
    togglePaneMax(paneAt(y).pane);
  });

  // ---- right-click context menu (TradingView-style options) ----
  let ctxMenu = null;
  function closeCtxMenu() {
    if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; }
  }
  function openCtxMenu(clientX, clientY) {
    closeCtxMenu();
    const d = state.draws[selIdx];
    if (!d) return;
    pushUndo(); // one snapshot per menu session (style edits & delete)
    ctxMenu = document.createElement("div");
    ctxMenu.className = "draw-ctx-menu";
    const zr = chartZone.getBoundingClientRect();
    ctxMenu.style.left = Math.min(clientX - zr.left, zr.width - 190) + "px";
    ctxMenu.style.top = Math.min(clientY - zr.top, zr.height - 170) + "px";

    const row1 = document.createElement("div");
    row1.className = "ctx-row";
    const colorInp = document.createElement("input");
    colorInp.type = "color";
    colorInp.className = "studio-color";
    colorInp.value = d.color || "#9d8bff";
    colorInp.addEventListener("input", () => { d.color = colorInp.value; persist(); redrawDraws(); });
    row1.append(colorInp);
    const widthSel = document.createElement("select");
    widthSel.className = "studio-select studio-mini";
    for (const [v, t] of [[1, "1px"], [2, "2px"], [3, "3px"]]) {
      const o = document.createElement("option");
      o.value = v; o.textContent = d.type === "text" ? { 1: "Petit", 2: "Moyen", 3: "Grand" }[v] : t;
      if (v === (d.width || 2)) o.selected = true;
      widthSel.append(o);
    }
    widthSel.addEventListener("change", () => { d.width = Number(widthSel.value); persist(); redrawDraws(); });
    row1.append(widthSel);
    if (d.type !== "text") {
      const dashSel = document.createElement("select");
      dashSel.className = "studio-select studio-mini";
      for (const [v, t] of DASHES) {
        const o = document.createElement("option");
        o.value = v; o.textContent = t;
        if (v === (d.dash || 0)) o.selected = true;
        dashSel.append(o);
      }
      dashSel.addEventListener("change", () => { d.dash = Number(dashSel.value); persist(); redrawDraws(); });
      row1.append(dashSel);
    }
    ctxMenu.append(row1);
    if (d.type === "text") {
      const edit = document.createElement("button");
      edit.className = "ctx-item";
      edit.textContent = "✎ Modifier le texte";
      edit.addEventListener("click", () => {
        const t = prompt("Texte :", d.text || "");
        if (t != null) { d.text = t.trim() || "…"; persist(); redrawDraws(); }
        closeCtxMenu();
      });
      ctxMenu.append(edit);
    }
    const del = document.createElement("button");
    del.className = "ctx-item ctx-del";
    del.textContent = "🗑 Supprimer";
    del.addEventListener("click", () => {
      state.draws.splice(selIdx, 1);
      selIdx = null;
      persist();
      closeCtxMenu();
      redrawDraws();
    });
    ctxMenu.append(del);
    chartZone.append(ctxMenu);
    setTimeout(() => document.addEventListener("pointerdown", onDocDown, { once: true }), 0);
  }
  const onDocDown = (ev) => { if (ctxMenu && !ctxMenu.contains(ev.target)) closeCtxMenu(); };
  chartZone.addEventListener("contextmenu", (ev) => {
    const { x, y } = relPx(ev);
    const h = handleAt(x, y);
    const i = h ? h.idx : hitTest(x, y);
    ev.preventDefault();
    if (i == null || i < 0) { closeCtxMenu(); return; }
    selIdx = i;
    redrawDraws();
    openCtxMenu(ev.clientX, ev.clientY);
  });
  drawCanvas.addEventListener("mousemove", (ev) => {
    const r = drawCanvas.getBoundingClientRect();
    mousePx = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    // While a drawing tool is active the overlay swallows the mouse, so the
    // chart's own crosshair (guide lines + value/time labels on the axes) would
    // freeze. Drive it manually from the cursor position so you always see where
    // you're placing a point and at what price — TradingView-style.
    if (drawMode !== "cursor") {
      const p = fromPx(mousePx.x, mousePx.y);
      const a = anchorFor(p.pane);
      if (a && p.t != null && p.v != null) { try { chart.setCrosshairPosition(p.v, p.t, a); } catch { /* off-range */ } }
    }
    if (measuring && measureBox) {
      measureBox.b = { ...mousePx, ...fromPxIn(mousePx.x, mousePx.y, measureBox.a.pane || 0) };
      redrawDraws();
    } else if (pending) redrawDraws();
  });
  drawCanvas.addEventListener("mouseleave", () => { try { chart.clearCrosshairPosition(); } catch { /* noop */ } });
  drawCanvas.addEventListener("click", (ev) => {
    if (drawMode === "cursor") return;
    const r = drawCanvas.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    if (drawMode === "erase") {
      const i = hitTest(x, y);
      if (i >= 0) {
        pushUndo();
        state.draws.splice(i, 1);
        if (selIdx === i) selIdx = null; else if (selIdx > i) selIdx--;
        persist(); redrawDraws();
      }
      return;
    }
    const pt = maybeSnap(fromPx(x, y));
    const base = { color: "#9d8bff", width: 2, dash: 0 };
    const commit = (d) => { pushUndo(); state.draws.push(d); selIdx = state.draws.length - 1; persist(); };
    if (drawMode === "hline") {
      if (pt.v == null) return;
      commit({ type: "hline", p1: { v: pt.v }, pane: pt.pane || 0, ...base });
      redrawDraws();
    } else if (drawMode === "vline") {
      if (pt.t == null) return;
      commit({ type: "vline", p1: { t: pt.t }, ...base });
      redrawDraws();
    } else if (drawMode === "hray") {
      if (pt.t == null || pt.v == null) return;
      commit({ type: "hray", p1: { t: pt.t, v: pt.v }, pane: pt.pane || 0, ...base });
      redrawDraws();
    } else if (drawMode === "text") {
      if (pt.t == null || pt.v == null) return;
      const t = prompt("Texte :", "");
      if (t?.trim()) commit({ type: "text", p1: { t: pt.t, v: pt.v }, text: t.trim(), pane: pt.pane || 0, ...base });
      redrawDraws();
    } else if (TWO_CLICK.includes(drawMode)) {
      if (pt.t == null || pt.v == null) return;
      if (!pending) { pending = { p1: { t: pt.t, v: pt.v }, pane: pt.pane || 0 }; }
      else {
        const p2 = maybeSnap(fromPxIn(x, y, pending.pane));
        if (p2.t == null || p2.v == null) return;
        commit({ type: drawMode, p1: pending.p1, p2: { t: p2.t, v: p2.v }, pane: pending.pane, ...base });
        pending = null;
      }
      redrawDraws();
    } else if (drawMode === "channel") {
      if (pt.t == null || pt.v == null) return;
      if (!pending) pending = { p1: { t: pt.t, v: pt.v }, pane: pt.pane || 0 };
      else {
        const pp = fromPxIn(x, y, pending.pane);
        if (pp.t == null || pp.v == null) return;
        if (!pending.p2) pending.p2 = { t: pp.t, v: pp.v };
        else {
          const dv = pp.v - lineValueAt(pending.p1, pending.p2, pp.t);
          commit({ type: "channel", p1: pending.p1, p2: pending.p2, dv, pane: pending.pane, ...base });
          pending = null;
        }
      }
      redrawDraws();
    }
  });
  // measure: press-drag, box + stats stay until Escape / next press
  drawCanvas.addEventListener("mousedown", (ev) => {
    if (drawMode !== "measure") return;
    const r = drawCanvas.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    const pt = fromPx(x, y);
    measureBox = { a: { x, y, ...pt }, b: { x, y, ...pt } };
    measuring = true;
    redrawDraws();
  });
  drawCanvas.addEventListener("mouseup", () => { measuring = false; });
  // Shift a drawing in (time, value) space: days on the X axis, a % of the
  // value on Y. hline/vline only move on their own axis.
  function shiftDraw(d, days, vFactor) {
    const mv = (p) => {
      const out = { ...p };
      if (days && p.t != null) out.t = addDaysStr(tStr(p.t), days);
      if (vFactor !== 1 && p.v != null) out.v = p.v * vFactor;
      return out;
    };
    if (d.type === "hline") { if (vFactor !== 1) d.p1 = { v: d.p1.v * vFactor }; return; }
    if (d.type === "vline") { if (days) d.p1 = { t: addDaysStr(tStr(d.p1.t), days) }; return; }
    d.p1 = mv(d.p1);
    if (d.p2) d.p2 = mv(d.p2);
  }
  document.addEventListener("keydown", (ev) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || "");
    const mod = ev.ctrlKey || ev.metaKey;
    if (ev.key === "Escape") {
      if (ctxMenu) { closeCtxMenu(); return; }
      if (measureBox) { measureBox = null; redrawDraws(); return; }
      if (drawMode !== "cursor") { setDrawMode("cursor"); return; }
      if (selIdx != null) { selIdx = null; redrawDraws(); }
      return;
    }
    if (typing) return;
    // Ctrl+Z — undo the last drawing change (add/move/style/delete)
    if (mod && ev.key.toLowerCase() === "z") {
      ev.preventDefault();
      if (undoStack.length) {
        state.draws = JSON.parse(undoStack.pop());
        selIdx = null;
        closeCtxMenu();
        persist();
        redrawDraws();
      }
      return;
    }
    // Ctrl+C / Ctrl+V / Ctrl+D on the selected drawing
    if (mod && ev.key.toLowerCase() === "c" && selIdx != null) {
      clipboardDraw = structuredClone(state.draws[selIdx]);
      return;
    }
    if (mod && (ev.key.toLowerCase() === "v" || ev.key.toLowerCase() === "d")) {
      if (ev.key.toLowerCase() === "d") {
        if (selIdx == null) return;
        clipboardDraw = structuredClone(state.draws[selIdx]);
      }
      if (!clipboardDraw) return;
      ev.preventDefault();
      pushUndo();
      const copy = structuredClone(clipboardDraw);
      shiftDraw(copy, 3, 1); // paste slightly to the right
      state.draws.push(copy);
      selIdx = state.draws.length - 1;
      persist();
      redrawDraws();
      return;
    }
    // Arrow nudging (Shift = bigger steps)
    if (selIdx != null && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(ev.key)) {
      ev.preventDefault();
      pushUndo();
      const days = ev.key === "ArrowLeft" ? -(ev.shiftKey ? 7 : 1) : ev.key === "ArrowRight" ? (ev.shiftKey ? 7 : 1) : 0;
      const vf = ev.key === "ArrowUp" ? (ev.shiftKey ? 1.02 : 1.005) : ev.key === "ArrowDown" ? (ev.shiftKey ? 0.98 : 0.995) : 1;
      shiftDraw(state.draws[selIdx], days, vf);
      persist();
      redrawDraws();
      return;
    }
    if ((ev.key === "Delete" || ev.key === "Backspace") && selIdx != null) {
      ev.preventDefault();
      pushUndo();
      state.draws.splice(selIdx, 1);
      selIdx = null;
      closeCtxMenu();
      persist();
      redrawDraws();
    }
  });

  const drawRail = document.getElementById("draw-rail");
  function renderDrawRail() {
    drawRail.innerHTML = "";
    const magnet = document.createElement("button");
    magnet.className = "draw-btn" + (state.magnet ? " on" : "");
    magnet.textContent = "🧲";
    magnet.title = "Aimant : accroche les points posés/étirés à la valeur de la 1re série";
    magnet.addEventListener("click", () => {
      state.magnet = !state.magnet;
      persist();
      renderDrawRail();
    });
    drawRail.append(magnet);
    for (const [mode, glyph, title] of TOOLS) {
      const b = document.createElement("button");
      b.className = "draw-btn" + (drawMode === mode ? " on" : "");
      b.textContent = glyph;
      b.title = title;
      b.addEventListener("click", () => setDrawMode(mode === drawMode && mode !== "cursor" ? "cursor" : mode));
      drawRail.append(b);
    }
    const clear = document.createElement("button");
    clear.className = "draw-btn draw-clear";
    clear.textContent = "🗑";
    clear.title = "Effacer tous les tracés";
    clear.addEventListener("click", () => {
      if (state.draws.length) pushUndo();
      state.draws = [];
      selIdx = null;
      closeCtxMenu();
      persist();
      setDrawMode("cursor");
    });
    drawRail.append(clear);
  }

  // ---- drag & drop placement ----
  const dropZones = document.getElementById("drop-zones");
  let draggingInd = null;
  function setupZone(zone, overlay) {
    zone.addEventListener("dragover", (ev) => { ev.preventDefault(); zone.classList.add("hover"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("hover"));
    zone.addEventListener("drop", (ev) => {
      ev.preventDefault();
      zone.classList.remove("hover");
      if (draggingInd != null && state.inds[draggingInd]) {
        state.inds[draggingInd].overlay = overlay;
        update();
      }
    });
  }
  setupZone(document.getElementById("zone-overlay"), true);
  setupZone(document.getElementById("zone-pane"), false);

  // ---- UI helpers ----
  const mkSelect = (options, value, onChange, cls = "studio-select") => {
    const sel = document.createElement("select");
    sel.className = cls;
    for (const [v, label] of options) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = label;
      if (String(v) === String(value)) o.selected = true;
      sel.append(o);
    }
    sel.addEventListener("change", () => onChange(sel.value));
    return sel;
  };
  const mkBtn = (text, cls, onClick, title) => {
    const b = document.createElement("button");
    b.className = cls;
    b.textContent = text;
    if (title) b.title = title;
    b.addEventListener("click", onClick);
    return b;
  };
  const mkColor = (value, onChange, title) => {
    const inp = document.createElement("input");
    inp.type = "color";
    inp.className = "studio-color";
    inp.value = value;
    inp.title = title || "Couleur";
    inp.addEventListener("input", () => onChange(inp.value));
    return inp;
  };
  const mkEye = (hidden, onToggle) =>
    mkBtn(hidden ? "🚫" : "👁", "btn-eye" + (hidden ? " off" : ""), onToggle, hidden ? "Afficher" : "Masquer");
  const mkNum = (value, onChange, opts = {}) => {
    const inp = document.createElement("input");
    inp.type = "number";
    inp.className = "studio-num strat-num";
    if (opts.step != null) inp.step = opts.step;
    inp.value = value;
    inp.addEventListener("change", () => onChange(Number(inp.value)));
    return inp;
  };
  const mkCheck = (checked, onChange, title) => {
    const inp = document.createElement("input");
    inp.type = "checkbox";
    inp.className = "strat-check";
    inp.checked = !!checked;
    if (title) inp.title = title;
    inp.addEventListener("change", () => onChange(inp.checked));
    return inp;
  };
  // Named strategies (saved from the Stratégie panel, reusable on any asset).
  const LS_STRATS = "chog-strategies-v1";
  const loadStrats = () => { try { return JSON.parse(localStorage.getItem(LS_STRATS)) || []; } catch { return []; } };
  const saveStrats = (l) => localStorage.setItem(LS_STRATS, JSON.stringify(l));
  const update = () => { persist(); renderRail(); renderChart(); };

  // ---- toolbar ----
  const toolbar = document.getElementById("studio-toolbar");
  function renderToolbar() {
    toolbar.innerHTML = "";
    const brand = document.createElement("span");
    brand.className = "studio-title";
    brand.textContent = "Studio";
    toolbar.append(brand);

    const winLbl = document.createElement("span");
    winLbl.className = "control-label";
    winLbl.textContent = "Fenêtre";
    toolbar.append(winLbl);
    const seg = document.createElement("div");
    seg.className = "segmented";
    for (const [v, t] of [[30, "30j"], [90, "90j"], [365, "365j"], [Infinity, "Max"]]) {
      const b = document.createElement("button");
      b.textContent = t;
      b.className = v === state.w ? "on" : "";
      b.addEventListener("click", () => { state.w = v; persist(); renderToolbar(); renderChart(); });
      seg.append(b);
    }
    toolbar.append(seg);

    const tfLbl = document.createElement("span");
    tfLbl.className = "control-label";
    tfLbl.textContent = "Intervalle";
    toolbar.append(tfLbl);
    const tfSeg = document.createElement("div");
    tfSeg.className = "segmented";
    for (const [v, t] of [["D", "Jour"], ["W", "Sem."], ["M", "Mois"]]) {
      const b = document.createElement("button");
      b.textContent = t;
      b.className = v === (state.tf || "D") ? "on" : "";
      b.title = "Agrège les bougies (prix + indicateurs) en " + { D: "quotidien", W: "hebdomadaire", M: "mensuel" }[v];
      b.addEventListener("click", () => { state.tf = v; persist(); renderToolbar(); renderChart(); });
      tfSeg.append(b);
    }
    toolbar.append(tfSeg);

    const scaleLbl = document.createElement("span");
    scaleLbl.className = "control-label";
    scaleLbl.textContent = "Échelle";
    toolbar.append(scaleLbl);
    const mseg = document.createElement("div");
    mseg.className = "segmented";
    for (const [v, t] of [["index", "Base 100"], ["raw", "Brut"]]) {
      const b = document.createElement("button");
      b.textContent = t;
      b.className = v === state.mode ? "on" : "";
      b.addEventListener("click", () => { state.mode = v; persist(); renderToolbar(); renderChart(); });
      mseg.append(b);
    }
    toolbar.append(mseg);

    const logBtn = mkBtn(state.log ? "Log ✓" : "Log", "btn-ghost" + (state.log ? " on" : ""), () => {
      state.log = !state.log;
      persist();
      renderToolbar();
      renderChart();
    }, "Échelle logarithmique sur le panneau principal");
    toolbar.append(logBtn);

    // Price ↔ market cap toggle (raw mode only; base-100 is unit-agnostic).
    const mcap = state.unit === "mcap";
    const unitBtn = mkBtn(mcap ? "MC ✓" : "Prix/MC", "btn-ghost" + (mcap ? " on" : ""), () => {
      state.unit = mcap ? "price" : "mcap";
      persist();
      renderToolbar();
      renderChart();
    }, "Afficher la série en market cap (prix × offre) ou en prix — panneau principal en mode Brut");
    unitBtn.disabled = state.mode === "index";
    if (state.mode !== "index") toolbar.append(unitBtn);

    const fsSeg = document.createElement("div");
    fsSeg.className = "segmented";
    fsSeg.title = "Taille de police du graphe";
    for (const [v, t] of [[10, "Aa"], [12, "Aa"], [14, "Aa"]]) {
      const b = document.createElement("button");
      b.textContent = t;
      b.style.fontSize = (v - 1) + "px";
      b.className = v === state.fs ? "on" : "";
      b.addEventListener("click", () => {
        state.fs = v;
        persist();
        chart.applyOptions({ layout: { fontSize: v } });
        renderToolbar();
      });
      fsSeg.append(b);
    }
    toolbar.append(fsSeg);

    const right = document.createElement("div");
    right.className = "studio-toolbar-right";
    right.append(mkBtn(state.showEvents !== false ? "🚩 Jalons ✓" : "🚩 Jalons", "btn-ghost" + (state.showEvents !== false ? " on" : ""), () => {
      state.showEvents = state.showEvents === false;
      persist();
      renderToolbar();
      renderChart();
    }, "Afficher/masquer les jalons du Journal sur ce graphe"));
    right.append(mkBtn(state.showSignals !== false ? "📍 Signaux ✓" : "📍 Signaux", "btn-ghost" + (state.showSignals !== false ? " on" : ""), () => {
      state.showSignals = state.showSignals === false;
      persist();
      renderToolbar();
      renderChart();
    }, "Afficher/masquer les signaux de la stratégie — achat (vert) / vente (rouge) — configurée dans le rail à gauche"));
    right.append(mkBtn("🚩+", "btn-ghost", () => {
      const date = prompt("Date du jalon (YYYY-MM-DD) :", new Date().toISOString().slice(0, 10));
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      const label = prompt("Libellé :");
      if (!label?.trim()) return;
      journalAdd({ date, label: label.trim(), cat: "projet", scope: "studio" });
      renderChart();
    }, "Ajouter un jalon visible uniquement dans le Studio"));
    right.append(mkBtn("💾 Enregistrer la vue", "btn-ghost btn-save", (ev) => {
      if (saveView()) {
        ev.target.textContent = "Enregistré ✓ — voir Mon Dash";
        setTimeout(() => (ev.target.textContent = "💾 Enregistrer la vue"), 2200);
      }
    }, "Sauvegarde cette configuration comme widget dans Mon Dash"));
    right.append(mkBtn(isFs() ? "Quitter le plein écran" : "Plein écran", "btn-ghost", toggleFullscreen));
    right.append(mkBtn("Copier le lien", "btn-ghost", (ev) => {
      navigator.clipboard?.writeText(shareUrl());
      ev.target.textContent = "Copié ✓";
      setTimeout(() => (ev.target.textContent = "Copier le lien"), 1500);
    }));
    right.append(mkBtn("Réinitialiser", "btn-ghost", () => {
      state = structuredClone(DEFAULT);
      persist();
      renderToolbar();
      update();
    }));
    toolbar.append(right);
  }

  // ---- side rail ----
  const rail = document.getElementById("studio-rail");
  function renderRail() {
    rail.innerHTML = "";

    const sHead = document.createElement("div");
    sHead.className = "rail-head";
    sHead.innerHTML = "<span>Séries</span>";
    if (state.series.length < MAX_SERIES) {
      sHead.append(mkBtn("+ Ajouter", "rail-add", () => {
        state.series.push(normSerie({ sym: "CHOG", metric: "price" }));
        update();
      }));
    }
    rail.append(sHead);
    state.series.forEach((e, i) => {
      const row = document.createElement("div");
      row.className = "rail-row" + (e.hidden ? " row-off" : "");
      row.append(mkColor(serieColor(i), (v) => { e.color = v; update(); }));
      row.append(mkSelect(assets.map((a) => [a.symbol, a.symbol + " · Prix"]), e.sym, (v) => { e.sym = v; update(); }, "studio-select rail-metric"));
      row.append(mkEye(e.hidden, () => { e.hidden = !e.hidden; update(); }));
      row.append(mkBtn("✕", "btn-x", () => {
        state.series.splice(i, 1);
        state.inds = state.inds
          .filter((ind) => ind.target !== i)
          .map((ind) => ({ ...ind, target: ind.target > i ? ind.target - 1 : ind.target }));
        if (!state.series.length) state.series.push(normSerie({ sym: "CHOG", metric: "price" }));
        update();
      }));
      rail.append(row);
    });

    const iHead = document.createElement("div");
    iHead.className = "rail-head";
    iHead.innerHTML = "<span>Indicateurs</span>";
    iHead.append(mkBtn("+ Ajouter", "rail-add", () => {
      state.inds.push(normInd({ type: "sma", period: 20, target: 0 }));
      update();
    }));
    rail.append(iHead);
    const hint = document.createElement("div");
    hint.className = "rail-hint";
    hint.textContent = "Glisse ⋮⋮ sur le graphe (superposer) ou sur la bande du bas (sous-panneau).";
    rail.append(hint);

    state.inds.forEach((ind, i) => {
      const wrap = document.createElement("div");
      wrap.className = "rail-ind" + (ind.hidden ? " row-off" : "");

      const l1 = document.createElement("div");
      l1.className = "rail-row";
      const handle = document.createElement("span");
      handle.className = "drag-handle";
      handle.textContent = "⋮⋮";
      handle.title = "Glisser pour placer (graphe = superposé, bande du bas = sous-panneau)";
      handle.draggable = true;
      handle.addEventListener("dragstart", (ev) => {
        draggingInd = i;
        ev.dataTransfer.setData("text/plain", String(i));
        ev.dataTransfer.effectAllowed = "move";
        document.body.classList.add("studio-dragging");
      });
      handle.addEventListener("dragend", () => {
        draggingInd = null;
        document.body.classList.remove("studio-dragging");
        dropZones.querySelectorAll(".drop-zone").forEach((z) => z.classList.remove("hover"));
      });
      l1.append(handle);
      l1.append(mkSelect(Object.entries(INDS).map(([k, d]) => [k, d.label]), ind.type, (v) => {
        ind.type = v;
        ind.overlay = INDS[v].overlay !== false;
        ind.dash = INDS[v].dash ?? 0;
        if (INDS[v].defPeriod) ind.period = INDS[v].defPeriod;
        if (v === "met" && ind.metric === "price") ind.metric = "mentions";
        update();
      }, "studio-select rail-ind-type"));
      // Custom indicators (MACD A/P, Régime A/P…) explain themselves via ⓘ.
      const indHelp = helpIcon(INDS[ind.type].help, INDS[ind.type].label);
      if (indHelp) l1.append(indHelp);
      if (INDS[ind.type].period) {
        const num = document.createElement("input");
        num.type = "number";
        num.min = 2;
        num.max = 200;
        num.value = ind.period;
        num.className = "studio-num";
        num.addEventListener("change", () => { ind.period = Math.max(2, Number(num.value) || 14); update(); });
        l1.append(num);
      }
      // "met" picks WHICH metric to plot; classic studies pick their SOURCE
      // (default Prix — an EMA over mentions is one select away).
      if (INDS[ind.type].needsMetric) {
        l1.append(mkSelect(
          metrics.filter((m) => m.id !== "price").map((m) => [m.id, m.label]),
          ind.metric, (v) => { ind.metric = v; update(); }, "studio-select rail-ind-metric"
        ));
      } else if (INDS[ind.type].hasSource) {
        l1.append(mkSelect(
          metrics.map((m) => [m.id, m.id === "price" ? "sur Prix" : "sur " + m.label]),
          ind.metric || "price", (v) => { ind.metric = v; update(); }, "studio-select rail-ind-metric"
        ));
      }
      l1.append(mkSelect(
        state.series.map((e, idx) => [idx, e.sym]),
        ind.target, (v) => { ind.target = Number(v); update(); }, "studio-select rail-ind-target"
      ));
      wrap.append(l1);

      const l2 = document.createElement("div");
      l2.className = "rail-row rail-row-style";
      l2.append(mkSelect([[1, "Superposé"], [0, "Sous-panneau"]], ind.overlay ? 1 : 0, (v) => {
        ind.overlay = v === "1";
        update();
      }, "studio-select studio-mini"));
      l2.append(mkColor(ind.color || serieColor(ind.target), (v) => { ind.color = v; update(); }));
      l2.append(mkSelect([[1, "1px"], [2, "2px"], [3, "3px"]], ind.width, (v) => { ind.width = Number(v); update(); }, "studio-select studio-mini"));
      l2.append(mkSelect(DASHES, ind.dash, (v) => { ind.dash = Number(v); update(); }, "studio-select studio-mini"));
      l2.append(mkEye(ind.hidden, () => { ind.hidden = !ind.hidden; update(); }));
      l2.append(mkBtn("✕", "btn-x", () => { state.inds.splice(i, 1); update(); }));
      wrap.append(l2);

      rail.append(wrap);
    });

    // ---- Stratégie : moteur de signaux configurable + simulation ----
    // Buy on SMA(div) crossing UP the borne haute, sell on crossing DOWN the
    // borne basse, gated by user-picked indicator conditions; capital
    // compounded through the round-trips. Saved strategies apply to whatever
    // asset the chart's first series shows.
    {
      const strat = state.strat;
      const touch = () => { state.stratPreset = "custom"; update(); };
      const labRow = (label, ...els) => {
        const r = document.createElement("div");
        r.className = "rail-row strat-row";
        const l = document.createElement("span");
        l.className = "strat-lbl";
        l.textContent = label;
        r.append(l, ...els);
        return r;
      };

      const stHead = document.createElement("div");
      stHead.className = "rail-head";
      stHead.innerHTML = "<span>Stratégie 📍</span>";
      rail.append(stHead);

      // preset / saved-strategy selector
      const presetOpts = [
        ...STRAT_PRESETS.map((p) => [p.id, p.label]),
        ...loadStrats().map((s) => ["saved:" + s.name, "💾 " + s.name]),
        ["custom", "Personnalisé"],
      ];
      const presetRow = document.createElement("div");
      presetRow.className = "rail-row";
      presetRow.append(mkSelect(presetOpts, state.stratPreset || "custom", (v) => {
        if (v === "custom") { state.stratPreset = "custom"; update(); return; }
        if (v.startsWith("saved:")) {
          const s = loadStrats().find((x) => x.name === v.slice(6));
          if (s) state.strat = normStrat(structuredClone(s.strat));
        } else {
          const p = STRAT_PRESETS.find((x) => x.id === v);
          if (p) state.strat = normStrat(p.strat());
        }
        state.stratPreset = v;
        update();
      }, "studio-select rail-metric"));
      if ((state.stratPreset || "").startsWith("saved:")) {
        presetRow.append(mkBtn("🗑", "btn-x", () => {
          saveStrats(loadStrats().filter((x) => x.name !== state.stratPreset.slice(6)));
          state.stratPreset = "custom";
          update();
        }, "Supprimer cette stratégie sauvegardée"));
      }
      rail.append(presetRow);

      // trigger: divergence smoothing (EMA/SMA + period) then the two bounds
      rail.append(labRow(
        "Divergence lissée",
        mkSelect([["ema", "EMA"], ["sma", "SMA"]], strat.divType, (v) => { strat.divType = v; touch(); }, "studio-select studio-mini strat-op"),
        mkNum(strat.divPeriod, (v) => { strat.divPeriod = Math.max(2, v || 9); touch(); })
      ));
      rail.append(labRow("Achat : franchit ↑", mkNum(strat.buyLevel, (v) => { strat.buyLevel = Number.isFinite(v) ? v : 0; touch(); }, { step: 0.5 })));
      rail.append(labRow("Vente : franchit ↓", mkNum(strat.sellLevel, (v) => { strat.sellLevel = Number.isFinite(v) ? v : 0; touch(); }, { step: 0.5 })));

      // gating conditions (buy side, sell side)
      const condList = (title, key) => {
        const head = document.createElement("div");
        head.className = "strat-sub";
        head.innerHTML = `<span>${title}</span>`;
        head.append(mkBtn("+ condition", "rail-add", () => { strat[key].push({ ind: "rsi", op: "<", val: 50, join: "and" }); touch(); }));
        rail.append(head);
        strat[key].forEach((c, i) => {
          const r = document.createElement("div");
          r.className = "rail-row strat-cond";
          // connector to the previous condition (the first one has none)
          if (i > 0) {
            r.append(mkSelect([["and", "ET"], ["or", "OU"]], c.join === "or" ? "or" : "and", (v) => { c.join = v; touch(); }, "studio-select studio-mini strat-join"));
          }
          r.append(mkSelect(Object.entries(COND_SOURCES).map(([k, s]) => [k, s.label]), c.ind, (v) => {
            c.ind = v;
            const def = COND_SOURCES[v].period;
            if (def) c.period = c.period || def; else delete c.period;
            touch();
          }, "studio-select strat-ind"));
          // parameterised sources (SMA/EMA) carry their own period
          if (COND_SOURCES[c.ind].period) {
            const per = mkNum(c.period ?? COND_SOURCES[c.ind].period, (v) => { c.period = Math.max(2, v || COND_SOURCES[c.ind].period); touch(); });
            per.classList.add("strat-per");
            per.title = "Période de la moyenne";
            r.append(per);
          }
          r.append(mkSelect([["<", "<"], [">", ">"]], c.op, (v) => { c.op = v; touch(); }, "studio-select studio-mini strat-op"));
          r.append(mkNum(c.val, (v) => { c.val = Number.isFinite(v) ? v : 0; touch(); }, { step: "any" }));
          r.append(mkBtn("✕", "btn-x", () => { strat[key].splice(i, 1); touch(); }));
          rail.append(r);
          // Second line: WHICH asset the indicator is read from. Empty = the
          // charted asset; another symbol = cross-asset filter (e.g. buy PENGU
          // only while BTC's RSI > 50 — the market-regime gate).
          const ar = document.createElement("div");
          ar.className = "rail-row strat-cond-asset";
          const al = document.createElement("span");
          al.className = "strat-lbl";
          al.textContent = "↳ sur";
          ar.append(al, mkSelect(
            [["", "cet actif"], ...assets.map((x) => [x.symbol, x.symbol])],
            c.sym || "", (v) => { if (v) c.sym = v; else delete c.sym; touch(); }, "studio-select strat-ind"
          ));
          // Timeframe the indicator is computed on: daily, weekly or monthly
          // bars (a weekly RSI14 spans 14 weeks). Reads the last CLOSED bar.
          ar.append(mkSelect(
            [["D", "Jour"], ["W", "Sem."], ["M", "Mois"]],
            c.tf || "D", (v) => { if (v === "D") delete c.tf; else c.tf = v; touch(); },
            "studio-select studio-mini strat-tf"
          ));
          rail.append(ar);
        });
        if (!strat[key].length) {
          const e = document.createElement("div");
          e.className = "rail-hint";
          e.textContent = "aucune — le franchissement suffit";
          rail.append(e);
        } else if (strat[key].some((c, i) => i > 0 && c.join === "or")) {
          const e = document.createElement("div");
          e.className = "rail-hint";
          e.textContent = "ET prioritaire sur OU : « A ET B OU C » = « (A ET B) OU C ».";
          rail.append(e);
        }
      };
      condList("Conditions d'achat", "buyConds");
      condList("Conditions de vente", "sellConds");

      // ---- money management : fractionner les entrées/sorties ----
      const mmHead = document.createElement("div");
      mmHead.className = "strat-sub";
      mmHead.innerHTML = "<span>Money management</span>";
      rail.append(mmHead);
      rail.append(labRow("Achat : % du cash dispo", mkNum(strat.buyPct, (v) => { strat.buyPct = Math.min(100, Math.max(1, v || 100)); touch(); })));
      rail.append(labRow("Vente : % de la position", mkNum(strat.sellPct, (v) => { strat.sellPct = Math.min(100, Math.max(1, v || 100)); touch(); })));
      rail.append(labRow("Lisser l'achat (tant que valide)", mkCheck(strat.scaleIn, (v) => { strat.scaleIn = v; touch(); }, "Continue d'acheter les jours suivants tant que la ligne reste au-dessus de la borne et que les conditions d'achat tiennent")));
      rail.append(labRow("Lisser la vente (tant que valide)", mkCheck(strat.scaleOut, (v) => { strat.scaleOut = v; touch(); }, "Continue d'alléger tant que la ligne reste sous la borne et que les conditions de vente tiennent")));
      if (strat.scaleIn || strat.scaleOut) {
        rail.append(labRow("Cadence (jours)", mkNum(strat.scaleEvery, (v) => { strat.scaleEvery = Math.max(1, v || 1); touch(); })));
        rail.append(labRow("Max tranches / épisode", mkNum(strat.maxTranches, (v) => { strat.maxTranches = Math.max(1, v || 3); touch(); })));
      }
      rail.append(labRow("Ne pas moyenner à la baisse", mkCheck(strat.noAvgDown, (v) => { strat.noAvgDown = v; touch(); }, "Refuse tout achat sous le prix de revient de la position en cours — garde la 1re entrée d'une baisse, bloque les rachats de plus en plus bas")));
      rail.append(labRow("Délai min entre 2 achats (j)", mkNum(strat.buyCooldown, (v) => { strat.buyCooldown = Math.max(0, v || 0); touch(); })));

      rail.append(labRow("Investissement ($)", mkNum(strat.capital, (v) => { strat.capital = v > 0 ? v : 1000; update(); })));

      // simulation results on the charted asset
      const asset = bySym[state.series[0]?.sym];
      const res = document.createElement("div");
      res.className = "strat-results";
      const pctS = (v, dec = 1) => (v == null ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(dec) + "%");
      const money = (v) => (v == null ? "—" : Math.round(v).toLocaleString("fr-FR") + " $");
      if (asset?.divergence?.length) {
        const bt = stratBacktest(asset, strat, bySym);
        let html = `<div class="strat-res-title">Résultats · ${asset.symbol} (historique complet)</div>`;
        if (!bt.nBuys) {
          html += `<div class="rail-hint">Aucun achat déclenché — élargis les bornes ou retire une condition.</div>`;
        } else {
          html += `<div class="strat-res-grid">
            <span>Tranches achat / vente</span><b>${bt.nBuys} / ${bt.sells.length}</b>
            <span>Ventes gagnantes</span><b>${bt.win != null ? Math.round(bt.win * 100) + "%" : "—"}</b>
            <span>Médiane / vente</span><b>${pctS(bt.med)}</b>
            <span>Perf. cumulée</span><b class="${bt.cum >= 0 ? "up" : "down"}">${pctS(bt.cum, 0)}</b>
            <span>Capital ${money(bt.capital)}</span><b class="${bt.equityFinal >= bt.capital ? "up" : "down"}">→ ${money(bt.equityFinal)}</b>
            <span>Achat-conservation</span><b>${pctS(bt.bh, 0)}</b>
            <span>Max drawdown</span><b>${pctS(bt.maxDD, 0)}</b>
            <span>Exposition</span><b>${bt.exposure != null ? Math.round(bt.exposure * 100) + "%" : "—"}</b>
          </div>`;
          if (bt.open) html += `<div class="strat-open">Position ouverte : ${money(bt.open.value)} (${pctS(bt.open.ret)} latent) + ${money(bt.cash)} en cash</div>`;
        }
        if (bt.missing.length) html += `<div class="strat-warn">⚠ Sans données : ${bt.missing.join(", ")} — cette condition bloque tout signal.</div>`;
        res.innerHTML = html;
      } else {
        res.innerHTML = `<div class="rail-hint">Pas de divergence calculable sur cet actif (mentions insuffisantes).</div>`;
      }
      rail.append(res);

      // same strategy on every asset (where does this config actually work?)
      rail.append(mkBtn((state.stratAll ? "▼" : "▶") + " Tester sur tous les actifs", "rail-add strat-allbtn", () => {
        state.stratAll = !state.stratAll;
        update();
      }));
      if (state.stratAll) {
        const tbl = document.createElement("table");
        tbl.className = "strat-table";
        tbl.innerHTML = "<thead><tr><th>Actif</th><th>A/V</th><th>Win</th><th>Cumul</th></tr></thead>";
        const tb = document.createElement("tbody");
        const rows = assets
          .filter((a) => a.divergence?.length)
          .map((a) => ({ sym: a.symbol, bt: stratBacktest(a, strat, bySym) }))
          .filter((r) => r.bt.nBuys)
          .sort((x, y) => y.bt.cum - x.bt.cum);
        for (const r of rows) {
          const tr = document.createElement("tr");
          if (r.bt.open) tr.title = "◦ position encore ouverte — le cumul inclut du latent, pas un résultat validé";
          tr.innerHTML = `<td>${r.sym}</td><td>${r.bt.nBuys}/${r.bt.sells.length}</td><td>${r.bt.win != null ? Math.round(r.bt.win * 100) + "%" : "—"}</td>`
            + `<td class="${r.bt.cum >= 0 ? "up" : "down"}">${pctS(r.bt.cum, 0)}${r.bt.open ? "◦" : ""}</td>`;
          tb.append(tr);
        }
        tbl.append(tb);
        rail.append(tbl);
        if (!rows.length) {
          const e = document.createElement("div");
          e.className = "rail-hint";
          e.textContent = "Aucun actif ne déclenche cette configuration.";
          rail.append(e);
        }
      }

      // save as a named strategy
      const saveRow = document.createElement("div");
      saveRow.className = "rail-row strat-save";
      const nameInp = document.createElement("input");
      nameInp.type = "text";
      nameInp.placeholder = "nom de la stratégie…";
      nameInp.className = "strat-name";
      nameInp.value = (state.stratPreset || "").startsWith("saved:") ? state.stratPreset.slice(6) : "";
      saveRow.append(nameInp);
      saveRow.append(mkBtn("💾 Sauvegarder", "rail-add", () => {
        const name = nameInp.value.trim();
        if (!name) { nameInp.focus(); return; }
        const list = loadStrats().filter((x) => x.name !== name);
        list.push({ name, strat: structuredClone(strat) });
        saveStrats(list);
        state.stratPreset = "saved:" + name;
        update();
      }, "Sauvegarde cette configuration — réapplicable sur n'importe quel actif via le sélecteur"));
      rail.append(saveRow);

      const stHint = document.createElement("div");
      stHint.className = "rail-hint";
      stHint.textContent = "La stratégie s'applique à la 1ʳᵉ série du graphe — change d'actif pour tester la même config ailleurs.";
      rail.append(stHint);
    }

    const note = document.createElement("div");
    note.className = "rail-note";
    note.innerHTML = "Séries indexées <b>base 100</b> ou <b>brutes</b> (bouton Échelle). "
      + "<b>MACD</b> : 12/26/9 sur la série choisie, flèches aux croisements ligne/signal. "
      + "<b>MACD A/P</b> : même mécanique sur la divergence attention−prix — croisement ↑ = l'attention commence à devancer le prix. "
      + "<b>Régime A/P</b> : intensité des mentions, <span style='color:var(--up)'>vert</span> = prix en hausse, <span style='color:var(--down)'>rouge</span> = en baisse. "
      + "Tracés : outils à gauche (Échap pour quitter). 💾 enregistre la vue dans <b>Mon Dash</b>.";
    rail.append(note);
  }

  renderToolbar();
  renderRail();
  renderDrawRail();
  renderChart();
}
boot();
