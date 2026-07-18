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
    fs: 12, // chart font size
    magnet: false, // snap drawings to the anchor series values
    log: false, // logarithmic price scale on the main pane
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
  function renderChart() {
    for (const s of drawn) chart.removeSeries(s);
    const res = renderConfig(chart, state, ctx);
    drawn = res.created;
    anchorSeries = res.anchorSeries;
    paneAnchors = res.paneAnchors || [];
    vprofiles = res.vprofiles || [];
    try {
      chart.priceScale("right").applyOptions({
        mode: state.log ? LightweightCharts.PriceScaleMode.Logarithmic : LightweightCharts.PriceScaleMode.Normal,
      });
    } catch { /* scale mode is cosmetic */ }
    // magnet snap map: displayed values of the first series, by date
    anchorPtsCache = new Map();
    if (state.series[0]) {
      for (const p of seriesPts(bySym[state.series[0].sym], mById.price, state.w, state.mode === "index")) {
        anchorPtsCache.set(p.time, p.value);
      }
    }
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
    ["text", "T", "Texte (1 clic)"],
    ["measure", "📏", "Mesure (glisser : Δ prix, Δ %, Δ jours — non persistée, Échap pour effacer)"],
    ["erase", "⌫", "Gomme (clic sur un tracé)"],
  ];
  const TWO_CLICK = ["trend", "ray", "eline", "rect"];
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
  function strokeShape(d, preview = false, selected = false) {
    const W = drawCanvas.clientWidth, H = drawCanvas.clientHeight;
    const color = d.color || "#9d8bff";
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
  chartZone.addEventListener("dblclick", (ev) => {
    if (drawMode !== "cursor") return;
    const { x, y } = relPx(ev);
    const i = hitTest(x, y);
    if (i >= 0 && state.draws[i].type === "text") {
      const t = prompt("Texte :", state.draws[i].text || "");
      if (t != null) { state.draws[i].text = t.trim() || "…"; persist(); redrawDraws(); }
    }
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
    if (measuring && measureBox) {
      measureBox.b = { ...mousePx, ...fromPxIn(mousePx.x, mousePx.y, measureBox.a.pane || 0) };
      redrawDraws();
    } else if (pending) redrawDraws();
  });
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
