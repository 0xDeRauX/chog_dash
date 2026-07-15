/* Studio core — shared between the Studio workspace (studio.js) and the
   personal dashboard (dash.js): the indicator math, the series builder and
   renderConfig(), which draws a full saved configuration (series + indicators,
   panes, markers) onto a Lightweight Charts v5 instance.
   Classic script; depends on lib.js (windowed, fmtBy) + registry.js (METRICS). */

const PALETTE = ["#836ef9", "#17b8a6", "#e0a000", "#e0559a", "#3987e5", "#35e0a5", "#ef5350", "#9ccc4a", "#2ec8e6", "#f07530"];

// Indicator catalog: default placement + default line style per type.
// - macd     : classic 12/26/9 on any displayed series, crossover arrows.
// - macdap   : same MACD mechanics applied to the attention−price divergence
//              (z(mentions) − z(price)) of the target's asset — crossings mark
//              turning points of the accumulation regime.
// - regime   : attention-intensity bars (mention z-score) colored by price
//              direction over the period.
const INDS = {
  sma: { label: "SMA", period: true, overlay: true, dash: 2 },
  ema: { label: "EMA", period: true, overlay: true, dash: 1 },
  boll: { label: "Bollinger", period: true, overlay: true, dash: 2 },
  rsi: { label: "RSI", period: true, overlay: false, dash: 0 },
  macd: {
    label: "MACD", period: false, overlay: false, dash: 0,
    help: {
      what: "MACD classique (12/26/9) applicable à <b>n'importe quelle série</b> — pas seulement le prix. Ligne = EMA12 − EMA26, signal = EMA9, histogramme = leur écart.",
      read: "<b>Flèche ↑</b> = la ligne repasse au-dessus du signal (momentum s'inverse à la hausse) · <b>↓</b> = l'inverse. Histogramme = force du mouvement.",
      example: "Applique-le aux <b>Mentions X</b> de CHOG : tu obtiens le momentum d'attention pur, avec des flèches quand le buzz s'accélère ou retombe.",
    },
  },
  macdap: {
    label: "MACD A/P", period: false, overlay: false, dash: 0,
    help: {
      what: "La mécanique du MACD appliquée à la <b>divergence attention−prix</b> de l'actif (z(mentions) − z(prix)) au lieu du prix.",
      read: "<b>Croisement ↑</b> = l'attention <b>commence</b> à devancer le prix → début potentiel d'accumulation · <b>Croisement ↓</b> = essoufflement de l'avance.",
      example: "Sur CHOG, un croisement ↑ en avril signale que le buzz repart avant le prix — le point d'entrée que la Divergence brute ne date pas précisément.",
      quality: "Basé sur la Divergence, notre seul signal validé (IC +0.10 à +0.13). Les croisements eux-mêmes ne sont pas encore backtestés.",
    },
  },
  regime: {
    label: "Régime A/P", period: true, overlay: false, dash: 0, defPeriod: 7,
    help: {
      what: "Barres = intensité des mentions (z-score), <b>colorées par la direction du prix</b> sur la période choisie.",
      read: "<b>Vert</b> = attention pendant que le prix monte (le buzz alimente la hausse) · <b>Rouge</b> = attention pendant que le prix baisse (pression/capitulation).",
      example: "CHOG en avril : grappe de barres rouges = beaucoup de bruit pendant la chute. En mai : barres vertes = le buzz accompagne le rebond.",
      quality: "⚠️ <b>Descriptif uniquement</b> — testé sur ~350j, son IC ≈ 0 : il aide à <i>comprendre</i> le contexte mais ne <b>prédit pas</b>. Ne base pas une décision dessus.",
    },
  },
  ichimoku: { label: "Ichimoku", period: false, overlay: true, dash: 0 },
};
const DASHES = [[0, "Plein"], [2, "Tirets"], [1, "Points"]];

const UP_A = "rgba(53, 208, 127, 0.65)";
const DOWN_A = "rgba(255, 107, 107, 0.65)";

// ---- indicator math on [{time, value}] ----------------------------------
function smaPts(pts, n) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    sum += pts[i].value;
    if (i >= n) sum -= pts[i - n].value;
    if (i >= n - 1) out.push({ time: pts[i].time, value: sum / n });
  }
  return out;
}
function emaPts(pts, n) {
  if (pts.length < n) return [];
  const k = 2 / (n + 1);
  let ema = pts.slice(0, n).reduce((a, p) => a + p.value, 0) / n;
  const out = [{ time: pts[n - 1].time, value: ema }];
  for (let i = n; i < pts.length; i++) {
    ema = pts[i].value * k + ema * (1 - k);
    out.push({ time: pts[i].time, value: ema });
  }
  return out;
}
function bollPts(pts, n) {
  const up = [], lo = [];
  for (let i = n - 1; i < pts.length; i++) {
    const win = pts.slice(i - n + 1, i + 1).map((p) => p.value);
    const m = win.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(win.reduce((a, b) => a + (b - m) ** 2, 0) / n);
    up.push({ time: pts[i].time, value: m + 2 * sd });
    lo.push({ time: pts[i].time, value: m - 2 * sd });
  }
  return { up, lo };
}
function rsiPts(pts, n) {
  if (pts.length <= n) return [];
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) {
    const d = pts[i].value - pts[i - 1].value;
    if (d >= 0) g += d; else l -= d;
  }
  let ag = g / n, al = l / n;
  const rsi = () => (al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  const out = [{ time: pts[n].time, value: rsi() }];
  for (let i = n + 1; i < pts.length; i++) {
    const d = pts[i].value - pts[i - 1].value;
    ag = (ag * (n - 1) + Math.max(d, 0)) / n;
    al = (al * (n - 1) + Math.max(-d, 0)) / n;
    out.push({ time: pts[i].time, value: rsi() });
  }
  return out;
}
const addDaysStr = (dateStr, k) => {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
};
// Ichimoku on line data (close-only), standard 9/26/52, displacement 26.
function ichimokuPts(pts) {
  const hl2 = (i, n) => {
    const win = pts.slice(i - n + 1, i + 1).map((p) => p.value);
    return (Math.max(...win) + Math.min(...win)) / 2;
  };
  const tenkan = [], kijun = [], senkouA = [], senkouB = [], chikou = [];
  for (let i = 0; i < pts.length; i++) {
    const t = i >= 8 ? hl2(i, 9) : null;
    const k = i >= 25 ? hl2(i, 26) : null;
    if (t != null) tenkan.push({ time: pts[i].time, value: t });
    if (k != null) kijun.push({ time: pts[i].time, value: k });
    if (t != null && k != null) senkouA.push({ time: addDaysStr(pts[i].time, 26), value: (t + k) / 2 });
    if (i >= 51) senkouB.push({ time: addDaysStr(pts[i].time, 26), value: hl2(i, 52) });
    if (i >= 26) chikou.push({ time: pts[i - 26].time, value: pts[i].value });
  }
  return { tenkan, kijun, senkouA, senkouB, chikou };
}
// Classic MACD (12/26/9): line = EMA12 − EMA26, signal = EMA9(line),
// histogram = line − signal, arrows where the histogram flips sign.
function macdCalc(pts, fast = 12, slow = 26, sig = 9) {
  if (pts.length < slow + sig + 2) return { macd: [], signal: [], hist: [], markers: [] };
  const f = emaPts(pts, fast), s = emaPts(pts, slow);
  const fBy = new Map(f.map((p) => [p.time, p.value]));
  const macd = [];
  for (const p of s) {
    const fv = fBy.get(p.time);
    if (fv != null) macd.push({ time: p.time, value: fv - p.value });
  }
  const signal = emaPts(macd, sig);
  const sBy = new Map(signal.map((p) => [p.time, p.value]));
  const hist = [], markers = [];
  let prev = null;
  for (const m of macd) {
    const sv = sBy.get(m.time);
    if (sv == null) continue;
    const d = m.value - sv;
    hist.push({ time: m.time, value: d, color: d >= 0 ? UP_A : DOWN_A });
    if (prev != null && (prev < 0) !== (d < 0)) {
      markers.push(d >= 0
        ? { time: m.time, position: "belowBar", color: "#35d07f", shape: "arrowUp" }
        : { time: m.time, position: "aboveBar", color: "#ff6b6b", shape: "arrowDown" });
    }
    prev = d;
  }
  return { macd, signal, hist, markers };
}
// Régime A/P: bars = mention z-score, colored by price direction over n days.
function regimeBars(asset, winDays, n) {
  const buzz = windowed(asset.buzz || [], winDays);
  const priceBy = new Map((asset.prices || []).map((p) => [p.date, p.price]));
  const out = [];
  for (const b of buzz) {
    const cur = priceBy.get(b.date);
    if (cur == null) continue;
    let ref = null;
    for (let k = 0; k <= 5 && ref == null; k++) ref = priceBy.get(addDaysStr(b.date, -n - k));
    if (ref == null) continue;
    out.push({ time: b.date, value: b.buzz, color: cur >= ref ? UP_A : DOWN_A });
  }
  return out;
}
// v5 markers API with a v4 fallback.
function setSeriesMarkers(series, markers) {
  if (!series || !markers.length) return;
  try {
    if (LightweightCharts.createSeriesMarkers) { LightweightCharts.createSeriesMarkers(series, markers); return; }
  } catch { /* fall through */ }
  try { series.setMarkers(markers); } catch { /* markers are cosmetic */ }
}

// ---- series data ---------------------------------------------------------
function seriesPts(asset, m, win, indexed) {
  const w = windowed(asset[m.series], win).filter((p) => p[m.vkey] != null);
  if (!w.length) return [];
  if (!indexed) return w.map((p) => ({ time: p.date, value: p[m.vkey] }));
  const base = indexBase(w.map((p) => p[m.vkey])); // robust vs launch dust (lib.js)
  if (!base) return [];
  return w.map((p) => ({ time: p.date, value: (p[m.vkey] / base) * 100 }));
}

/* Recommended dashboards. Built on the institutional playbook: judge an asset
   against a peer group (never in isolation), combine DE-correlated signals
   (attention × price × on-chain, not three momentum lines), and read top-down
   (market regime → peers → asset → entry signal). Ordered as that reading. */
const PRESETS = [
  {
    key: "regime",
    name: "🌡️ Régime marché",
    why: "Le contexte AVANT de juger CHOG : risk-on ou risk-off ? (BTC, SOL et la TVL Monad, base 100). Fenêtre 90j — un régime de marché se lit à court terme, et ça évite la période de lancement de Monad où la TVL partait de zéro.",
    cols: 2, h: "s",
    cfg: {
      w: 90, mode: "index",
      series: [{ sym: "BTC", metric: "price" }, { sym: "SOL", metric: "price" }, { sym: "MON", metric: "tvl" }],
      inds: [],
    },
  },
  {
    key: "peers",
    name: "⚖️ CHOG vs la meute",
    why: "Le mouvement est-il propre à CHOG, ou tout le secteur bouge ? Sépare l'alpha du bêta.",
    cols: 2, h: "m",
    cfg: {
      w: 90, mode: "index",
      series: [
        { sym: "CHOG", metric: "price" }, { sym: "PEPE", metric: "price" }, { sym: "BONK", metric: "price" },
        { sym: "WIF", metric: "price" }, { sym: "BRETT", metric: "price" },
      ],
      inds: [],
    },
  },
  {
    key: "alpha",
    name: "🎯 Alpha CHOG",
    why: "Notre seul signal validé (IC +0.13 à 30j) : CHOG est-il en accumulation silencieuse ? Divergence + ses croisements.",
    cols: 2, h: "l",
    cfg: {
      w: 365, mode: "index",
      series: [
        { sym: "CHOG", metric: "price" }, { sym: "CHOG", metric: "mentions" }, { sym: "CHOG", metric: "divergence" },
      ],
      inds: [{ type: "macdap", period: 14, target: 0, overlay: false, width: 1, dash: 0 }],
    },
  },
  {
    key: "triangul",
    name: "🔀 Triangulation CHOG",
    why: "Le buzz se traduit-il en adoption réelle ? Attention × communauté × on-chain — des signaux dé-corrélés. ⚠️ Holders et Discord n'ont que quelques jours d'historique (collecte démarrée récemment) : cette vue s'étoffera d'elle-même jour après jour.",
    cols: 2, h: "m",
    cfg: {
      w: 90, mode: "index",
      series: [
        { sym: "CHOG", metric: "price" }, { sym: "CHOG", metric: "mentions" },
        { sym: "CHOG", metric: "holders" }, { sym: "CHOG", metric: "discord" },
      ],
      inds: [],
    },
  },
];
const newWidgetId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const widgetFromPreset = (p) => ({
  id: newWidgetId(), name: p.name, cols: p.cols, h: p.h, preset: p.key, cfg: structuredClone(p.cfg),
});

// ---- chart options + shared URL serialisation ---------------------------
function studioChartOptions() {
  return {
    autoSize: true,
    layout: {
      background: { color: "transparent" },
      textColor: ink("--text-2"),
      fontFamily: ink("--font") || "system-ui",
      panes: { separatorColor: ink("--border-strong"), separatorHoverColor: ink("--brand-ring"), enableResize: true },
    },
    grid: { vertLines: { color: ink("--grid") }, horzLines: { color: ink("--grid") } },
    rightPriceScale: { borderColor: ink("--border") },
    leftPriceScale: { borderColor: ink("--border") },
    timeScale: { borderColor: ink("--border"), timeVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  };
}
function cfgToQuery(cfg) {
  const q = new URLSearchParams();
  q.set("s", cfg.series.map((e) => `${e.sym}:${e.metric}`).join(","));
  if (cfg.inds?.length) {
    q.set("i", cfg.inds.map((i) => [i.type, i.period, i.target, i.overlay ? "o" : "p"].join(":")).join(","));
  }
  q.set("w", cfg.w === Infinity ? "max" : cfg.w);
  if (cfg.mode === "raw") q.set("m", "raw");
  return q.toString();
}

/* Draws a full config onto a chart. cfg = { w, mode, series, inds }.
   ctx = { bySym, mById }. opts.paneHeight sizes sub-panes.
   Returns { created (all series, for removal), items (legend info),
   anchorSeries (first right-scale series, for drawing tools) }. */
function renderConfig(chart, cfg, ctx, opts = {}) {
  const { bySym, mById } = ctx;
  const isRawM = (id) => ["z", "signed"].includes(mById[id]?.format);
  const scaleOf = (idx) => {
    if (cfg.mode === "raw") return idx === 0 ? "right" : "s" + idx;
    return isRawM(cfg.series[idx]?.metric) ? "left" : "right";
  };
  const serieColor = (i) => cfg.series[i]?.color || PALETTE[i % PALETTE.length];
  const created = [], items = [];
  let anchorSeries = null;
  const add = (dataPts, o, paneIdx = 0, kind = LightweightCharts.LineSeries) => {
    if (!dataPts.length) return null;
    const s = chart.addSeries(kind, { priceLineVisible: false, lastValueVisible: false, ...o }, paneIdx);
    s.setData(dataPts);
    created.push(s);
    return s;
  };

  const hasRawScale = cfg.mode === "index" && cfg.series.some((e) => !e.hidden && isRawM(e.metric));
  chart.applyOptions({ leftPriceScale: { visible: hasRawScale } });

  const ptsBySeries = cfg.series.map((e, idx) => {
    const m = mById[e.metric];
    const indexed = cfg.mode === "index" && !isRawM(e.metric);
    const pts = seriesPts(bySym[e.sym], m, cfg.w, indexed);
    const fmt = indexed ? (v) => v.toFixed(1) : (v) => fmtBy(m.format, v);
    let s = null;
    if (!e.hidden) {
      s = add(pts, { color: serieColor(idx), lineWidth: 2, priceScaleId: scaleOf(idx) });
      if (!anchorSeries && s && scaleOf(idx) === "right") anchorSeries = s;
    }
    items.push({ series: s, color: serieColor(idx), label: `${e.sym} · ${m.label}`, value: pts.at(-1)?.value ?? null, struck: !!e.hidden, sub: false, fmt });
    return pts;
  });

  let nextPane = 1;
  for (const ind of cfg.inds || []) {
    const tgt = cfg.series[ind.target];
    if (!tgt || !INDS[ind.type]) continue;
    const label = `${INDS[ind.type].label}${INDS[ind.type].period ? ind.period : ""} → ${tgt.sym} ${mById[tgt.metric].label}${ind.overlay ? "" : " · panneau"}`;
    const color = ind.color || serieColor(ind.target);
    const indexedTgt = cfg.mode === "index" && !isRawM(tgt.metric);
    const fmt = ind.type === "rsi" ? (v) => v.toFixed(0)
      : ind.type === "regime" ? (v) => fmtBy("z", v)
      : (ind.type === "macd" || ind.type === "macdap") ? (v) => (v >= 0 ? "+" : "") + v.toFixed(2)
      : indexedTgt ? (v) => v.toFixed(1) : (v) => fmtBy(mById[tgt.metric].format, v);
    if (ind.hidden) { items.push({ series: null, color, label, struck: true, sub: true, fmt }); continue; }
    const pts = ptsBySeries[ind.target];
    const style = { color, lineWidth: ind.width || 1, lineStyle: ind.dash || 0 };
    const pane = ind.overlay ? 0 : nextPane++;
    const scale = ind.overlay ? scaleOf(ind.target) : "right";
    let main = null;

    if (ind.type === "sma" && pts.length >= 3) main = add(smaPts(pts, ind.period), { ...style, priceScaleId: scale }, pane);
    if (ind.type === "ema" && pts.length >= 3) main = add(emaPts(pts, ind.period), { ...style, priceScaleId: scale }, pane);
    if (ind.type === "boll" && pts.length >= 3) {
      const { up, lo } = bollPts(pts, ind.period);
      add(up, { ...style, priceScaleId: scale }, pane);
      add(lo, { ...style, priceScaleId: scale }, pane);
    }
    if (ind.type === "rsi" && pts.length >= 3) main = add(rsiPts(pts, ind.period), { ...style }, pane);
    if (ind.type === "ichimoku" && pts.length >= 3) {
      const ich = ichimokuPts(pts);
      const w = ind.width || 1, d = ind.dash || 0;
      add(ich.tenkan, { color: ind.color || "#e0a000", lineWidth: w, lineStyle: d, priceScaleId: scale }, pane);
      add(ich.kijun, { color: "#3987e5", lineWidth: w, lineStyle: d, priceScaleId: scale }, pane);
      add(ich.senkouA, { color: "#35d07f", lineWidth: w, lineStyle: 2, priceScaleId: scale }, pane);
      add(ich.senkouB, { color: "#ff6b6b", lineWidth: w, lineStyle: 2, priceScaleId: scale }, pane);
      add(ich.chikou, { color: "#a8a2c0", lineWidth: w, lineStyle: 1, priceScaleId: scale }, pane);
    }
    if (ind.type === "macd" || ind.type === "macdap") {
      // macd: on the displayed series; macdap: on the target asset's
      // attention−price divergence (z(mentions) − z(price)).
      const basePts = ind.type === "macd"
        ? pts
        : windowed(bySym[tgt.sym].divergence || [], cfg.w).map((p) => ({ time: p.date, value: p.div }));
      const { macd, signal, hist, markers } = macdCalc(basePts);
      add(hist, { priceScaleId: "right", base: 0 }, pane, LightweightCharts.HistogramSeries);
      main = add(macd, { color: ind.color || (ind.type === "macdap" ? "#9d8bff" : color), lineWidth: ind.width || 1, priceScaleId: "right" }, pane);
      add(signal, { color: "#ff9800", lineWidth: 1, lineStyle: 2, priceScaleId: "right" }, pane);
      setSeriesMarkers(main, markers);
    }
    if (ind.type === "regime") {
      main = add(regimeBars(bySym[tgt.sym], cfg.w, ind.period), { priceScaleId: "right" }, pane, LightweightCharts.HistogramSeries);
    }
    items.push({ series: main, color: ind.type === "regime" ? "#35d07f" : color, label, struck: false, sub: true, fmt });
  }
  try {
    chart.panes().forEach((p, i) => { if (i > 0) p.setHeight(opts.paneHeight || 130); });
  } catch { /* pane sizing is cosmetic */ }
  chart.timeScale().fitContent();
  return { created, items, anchorSeries };
}
