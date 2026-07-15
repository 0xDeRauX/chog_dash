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
  const assets = data.assets;
  const bySym = Object.fromEntries(assets.map((a) => [a.symbol, a]));
  const metrics = METRICS.filter((m) => m.series);
  const mById = Object.fromEntries(metrics.map((m) => [m.id, m]));
  const ctx = { bySym, mById };

  // ---- state (URL > localStorage > default) ----
  const DEFAULT = {
    w: 365,
    mode: "index",
    series: [{ sym: "CHOG", metric: "price" }, { sym: "CHOG", metric: "mentions" }],
    inds: [{ type: "ema", period: 20, target: 0, overlay: true, width: 1, dash: 1 }],
    draws: [],
  };
  const normInd = (i) => ({
    type: i.type,
    period: Number(i.period) || INDS[i.type]?.defPeriod || 14,
    target: Number(i.target) || 0,
    overlay: i.overlay != null ? !!i.overlay : INDS[i.type]?.overlay !== false,
    color: i.color || null,
    width: [1, 2, 3].includes(i.width) ? i.width : 1,
    dash: [0, 1, 2].includes(i.dash) ? i.dash : (INDS[i.type]?.dash ?? 0),
    hidden: !!i.hidden,
  });
  const normSerie = (e) => ({ sym: e.sym, metric: e.metric, color: e.color || null, hidden: !!e.hidden });

  function fromUrl() {
    const q = new URLSearchParams(location.search);
    if (!q.get("s")) return null;
    const series = q.get("s").split(",").map((t) => {
      const [sym, metric] = t.split(":");
      return { sym, metric };
    }).filter((e) => bySym[e.sym] && mById[e.metric]).map(normSerie);
    if (!series.length) return null;
    return {
      w: q.get("w") === "max" ? Infinity : Number(q.get("w")) || 365,
      mode: q.get("m") === "raw" ? "raw" : "index",
      series,
      inds: (q.get("i") || "").split(",").filter(Boolean).map((t) => {
        const [type, period, target, place] = t.split(":");
        return { type, period, target, overlay: place !== "p" };
      }).filter((i) => INDS[i.type] && Number(i.target) < series.length).map(normInd),
      draws: [],
    };
  }
  function fromStorage() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY));
      if (!s?.series?.length) return null;
      if (s.w === "max") s.w = Infinity;
      s.mode = s.mode === "raw" ? "raw" : "index";
      s.series = s.series.filter((e) => bySym[e.sym] && mById[e.metric]).map(normSerie);
      s.inds = (s.inds || []).filter((i) => INDS[i.type] && i.target < s.series.length).map(normInd);
      s.draws = Array.isArray(s.draws) ? s.draws : [];
      return s.series.length ? s : null;
    } catch { return null; }
  }
  let state = { ...structuredClone(DEFAULT), ...(fromUrl() || fromStorage() || {}) };

  const persist = () =>
    localStorage.setItem(LS_KEY, JSON.stringify({ ...state, w: state.w === Infinity ? "max" : state.w }));
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
  const chart = LightweightCharts.createChart(chartEl, studioChartOptions());

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
    requestAnimationFrame(redrawDraws);
  }
  chart.subscribeCrosshairMove((param) => {
    for (const { series, el, last, fmt } of legendMap) {
      const d = param.seriesData?.get(series);
      const v = d?.value ?? last;
      el.textContent = v != null ? fmt(v) : "—";
    }
  });

  // ---- drawing tools (canvas overlay) ----
  const drawCanvas = document.getElementById("draw-canvas");
  const dctx = drawCanvas.getContext("2d");
  let drawMode = "cursor";
  let pending = null;
  let mousePx = null;

  const TOOLS = [
    ["cursor", "✥", "Curseur (naviguer)"],
    ["trend", "╱", "Ligne de tendance (2 clics)"],
    ["hline", "─", "Ligne horizontale (1 clic)"],
    ["vline", "│", "Ligne verticale (1 clic)"],
    ["rect", "▭", "Rectangle (2 clics)"],
    ["erase", "⌫", "Gomme (clic sur un tracé)"],
  ];
  const toXY = (pt) => {
    const x = pt.t != null ? chart.timeScale().timeToCoordinate(pt.t) : null;
    const y = pt.v != null && anchorSeries ? anchorSeries.priceToCoordinate(pt.v) : null;
    return { x, y };
  };
  const fromPx = (x, y) => {
    const t = chart.timeScale().coordinateToTime(x);
    const v = anchorSeries ? anchorSeries.coordinateToPrice(y) : null;
    return { t, v };
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
  function strokeShape(d, preview = false) {
    const W = drawCanvas.clientWidth, H = drawCanvas.clientHeight;
    dctx.strokeStyle = d.color || "#9d8bff";
    dctx.lineWidth = 1.5;
    dctx.setLineDash(preview ? [5, 4] : []);
    dctx.beginPath();
    if (d.type === "hline") {
      const { y } = toXY({ v: d.p1.v });
      if (y == null) return;
      dctx.moveTo(0, y);
      dctx.lineTo(W, y);
    } else if (d.type === "vline") {
      const { x } = toXY({ t: d.p1.t });
      if (x == null) return;
      dctx.moveTo(x, 0);
      dctx.lineTo(x, H);
    } else {
      const a = toXY(d.p1), b = toXY(d.p2);
      if (a.x == null || a.y == null || b.x == null || b.y == null) return;
      if (d.type === "trend") {
        dctx.moveTo(a.x, a.y);
        dctx.lineTo(b.x, b.y);
      } else if (d.type === "rect") {
        dctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        dctx.fillStyle = (d.color || "#9d8bff") + "22";
        dctx.fill();
      }
    }
    dctx.stroke();
    dctx.setLineDash([]);
  }
  function redrawDraws() {
    sizeCanvas();
    dctx.clearRect(0, 0, drawCanvas.clientWidth, drawCanvas.clientHeight);
    for (const d of state.draws) strokeShape(d);
    if (pending && mousePx) {
      const cur = fromPx(mousePx.x, mousePx.y);
      if (cur.t != null || cur.v != null) {
        strokeShape({ type: drawMode, p1: pending, p2: { t: cur.t, v: cur.v }, color: "#9d8bff" }, true);
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
    for (let i = state.draws.length - 1; i >= 0; i--) {
      const d = state.draws[i];
      if (d.type === "hline") {
        const { y } = toXY({ v: d.p1.v });
        if (y != null && Math.abs(py - y) < 7) return i;
      } else if (d.type === "vline") {
        const { x } = toXY({ t: d.p1.t });
        if (x != null && Math.abs(px - x) < 7) return i;
      } else {
        const a = toXY(d.p1), b = toXY(d.p2);
        if (a.x == null || b.x == null) continue;
        if (d.type === "trend" && distToSeg(px, py, a, b) < 7) return i;
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
  function setDrawMode(mode) {
    drawMode = mode;
    pending = null;
    document.body.classList.toggle("drawing", mode !== "cursor");
    renderDrawRail();
    redrawDraws();
  }
  drawCanvas.addEventListener("mousemove", (ev) => {
    const r = drawCanvas.getBoundingClientRect();
    mousePx = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    if (pending) redrawDraws();
  });
  drawCanvas.addEventListener("click", (ev) => {
    if (drawMode === "cursor") return;
    const r = drawCanvas.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    if (drawMode === "erase") {
      const i = hitTest(x, y);
      if (i >= 0) { state.draws.splice(i, 1); persist(); redrawDraws(); }
      return;
    }
    const pt = fromPx(x, y);
    if (drawMode === "hline") {
      if (pt.v == null) return;
      state.draws.push({ type: "hline", p1: { v: pt.v }, color: "#9d8bff" });
      persist(); redrawDraws();
    } else if (drawMode === "vline") {
      if (pt.t == null) return;
      state.draws.push({ type: "vline", p1: { t: pt.t }, color: "#9d8bff" });
      persist(); redrawDraws();
    } else if (drawMode === "trend" || drawMode === "rect") {
      if (pt.t == null || pt.v == null) return;
      if (!pending) { pending = { t: pt.t, v: pt.v }; }
      else {
        state.draws.push({ type: drawMode, p1: pending, p2: { t: pt.t, v: pt.v }, color: "#9d8bff" });
        pending = null;
        persist();
      }
      redrawDraws();
    }
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && drawMode !== "cursor") setDrawMode("cursor");
  });

  const drawRail = document.getElementById("draw-rail");
  function renderDrawRail() {
    drawRail.innerHTML = "";
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
      state.draws = [];
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

    const right = document.createElement("div");
    right.className = "studio-toolbar-right";
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
      row.append(mkSelect(assets.map((a) => [a.symbol, a.symbol]), e.sym, (v) => { e.sym = v; update(); }, "studio-select rail-sym"));
      row.append(mkSelect(metrics.map((m) => [m.id, m.label]), e.metric, (v) => { e.metric = v; update(); }, "studio-select rail-metric"));
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
      l1.append(mkSelect(
        state.series.map((e, idx) => [idx, `${e.sym} ${mById[e.metric].label}`]),
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
