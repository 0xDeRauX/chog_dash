/* Studio core — shared between the Studio workspace (studio.js) and the
   personal dashboard (dash.js): the indicator math, the series builder,
   config migration, and renderConfig(), which draws a full saved configuration
   (series + indicators, panes, markers) onto a Lightweight Charts v5 instance.

   Model (TradingView-like): a SERIES is an asset's price line. Everything else
   (volume, TVL, mentions, Discord, Telegram, holders, Buzz, Divergence) is an
   INDICATOR attached to a series — either the metric itself (type "met") or a
   computed study (SMA/EMA/RSI/MACD/…) whose `metric` field picks its source
   (default: price — but an EMA over mentions is one select away).
   Classic script; depends on lib.js (windowed, fmtBy, indexBase) + registry.js. */

const PALETTE = ["#836ef9", "#17b8a6", "#e0a000", "#e0559a", "#3987e5", "#35e0a5", "#ef5350", "#9ccc4a", "#2ec8e6", "#f07530"];

const INDS = {
  met: {
    label: "Métrique", period: false, overlay: true, dash: 0, needsMetric: true,
    help: {
      what: "Affiche une <b>métrique</b> de l'actif (mentions, TVL, holders, Buzz…) comme une courbe attachée à sa série de prix.",
      read: "<b>Superposé</b> = indexée base 100 pour être comparable au prix · <b>Sous-panneau</b> = valeurs brutes dans son propre panneau.",
      example: "« Métrique · Mentions X → CHOG » superposé montre si l'attention suit ou devance le prix de CHOG.",
    },
  },
  sma: { label: "SMA", period: true, overlay: true, dash: 2, hasSource: true },
  ema: { label: "EMA", period: true, overlay: true, dash: 1, hasSource: true },
  boll: { label: "Bollinger", period: true, overlay: true, dash: 2, hasSource: true },
  rsi: { label: "RSI", period: true, overlay: false, dash: 0, hasSource: true },
  macd: {
    label: "MACD", period: false, overlay: false, dash: 0, hasSource: true,
    help: {
      what: "MACD classique (12/26/9) applicable à <b>n'importe quelle source</b> — prix par défaut, ou une métrique (mentions, holders…). Ligne = EMA12 − EMA26, signal = EMA9, histogramme = leur écart.",
      read: "<b>Flèche ↑</b> = la ligne repasse au-dessus du signal (momentum s'inverse à la hausse) · <b>↓</b> = l'inverse. Histogramme = force du mouvement.",
      example: "Source « Mentions X » sur CHOG : le momentum d'attention pur, avec des flèches quand le buzz s'accélère ou retombe.",
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
  flow: {
    label: "Volume A/V", period: false, overlay: false, dash: 0,
    help: {
      what: "Volume <b>acheteur</b> (vert) vs <b>vendeur</b> (rouge) de l'actif, en sous-panneau.",
      read: "En $ réels (Binance) pour les actifs listés ; en nombre de transactions DEX pour les autres — l'échelle l'indique.",
      example: "Vente qui gonfle pendant que le prix stagne = distribution ; achat qui domine dans une baisse = accumulation.",
    },
  },
  tiers: {
    label: "Tranches holders", period: false, overlay: false, dash: 0,
    help: {
      what: "Nombre de holders par <b>valeur de solde</b> : <$50, $50–500, $500–5K, $5K–50K, >$50K — une ligne par tranche.",
      read: "Les <b>petites tranches</b> qui grossissent = adoption organique ; la tranche <b>>$50K</b> qui bouge = whales.",
      example: "Sur CHOG, +500 holders en $50–500 après un pic de mentions = le buzz a converti en porteurs réels.",
      quality: "Disponible pour CHOG + memes Solana uniquement (il faut voir chaque solde). L'historique démarre aujourd'hui.",
    },
  },
  vwap: {
    label: "VWAP", period: false, overlay: true, dash: 2,
    help: {
      what: "Prix moyen pondéré par le volume, <b>ancré au début de la fenêtre</b> : le prix « juste » payé par l'ensemble du marché depuis le début de la période.",
      read: "Prix <b>au-dessus</b> du VWAP = les acheteurs de la période sont en profit (support potentiel) · <b>en dessous</b> = en perte (résistance).",
      example: "CHOG repasse au-dessus de son VWAP 90j après un mois dessous = les porteurs récents repassent verts, la pression vendeuse s'allège.",
    },
  },
  vprofile: {
    label: "Volume Profile", period: false, overlay: true, canvas: true,
    help: {
      what: "Histogramme horizontal du <b>volume par niveau de prix</b> sur la fenêtre — où l'activité s'est réellement concentrée.",
      read: "Les <b>nœuds épais</b> = zones d'accord (support/résistance probables) · le niveau le plus épais (<b>POC</b>, surligné) = le prix le plus tradé.",
      example: "Un POC juste sous le prix actuel de CHOG = zone d'absorption si ça corrige.",
      quality: "Rendu dans le Studio uniquement (dessin sur canvas). Approximation quotidienne : volume du jour affecté au cours de clôture.",
    },
  },
  ichimoku: { label: "Ichimoku", period: false, overlay: true, dash: 0, hasSource: true },
};
const TIER_LINES = [
  ["lt50", "<$50", "#6f6a85"],
  ["t50_500", "$50–500", "#2ec8e6"],
  ["t500_5k", "$500–5K", "#35e0a5"],
  ["t5k_50k", "$5K–50K", "#e0a000"],
  ["gt50k", ">$50K", "#ef5350"],
];
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

// ---- config migration ----------------------------------------------------
// Older configs (Studio v2 first iterations, saved widgets, shared URLs) had
// series carrying any metric. Convert: series become price-only (one per
// asset), non-price series turn into "met" indicators keeping their color and
// visibility, and existing indicators are retargeted to the price series while
// inheriting the old series' metric as their source (an RSI that pointed at a
// mentions series is still an RSI over mentions).
function migrateCfg(cfg) {
  if (!cfg?.series?.length) return cfg;
  const needs = cfg.series.some((s) => (s.metric || "price") !== "price");
  if (!needs) {
    cfg.series.forEach((s) => { s.metric = "price"; });
    return cfg;
  }
  const idxBySym = new Map();
  const series = [];
  const remap = []; // old series idx -> { idx (new), metric }
  for (const old of cfg.series) {
    const metric = old.metric || "price";
    let idx = idxBySym.get(old.sym);
    if (idx == null) {
      idx = series.length;
      series.push({
        sym: old.sym, metric: "price",
        color: metric === "price" ? old.color || null : null,
        hidden: metric === "price" ? !!old.hidden : false,
      });
      idxBySym.set(old.sym, idx);
    } else if (metric === "price" && old.color && !series[idx].color) {
      series[idx].color = old.color;
    }
    remap.push({ idx, metric });
  }
  const inds = [];
  cfg.series.forEach((old, i) => {
    const metric = old.metric || "price";
    if (metric === "price") return;
    inds.push({
      type: "met", metric, target: remap[i].idx, overlay: true,
      color: old.color || null, width: 2, dash: 0, hidden: !!old.hidden,
    });
  });
  for (const ind of cfg.inds || []) {
    const m = remap[ind.target] || { idx: 0, metric: "price" };
    const keepSource = !["regime", "macdap", "met"].includes(ind.type);
    inds.push({ ...ind, target: m.idx, metric: ind.metric || (keepSource ? m.metric : ind.metric) });
  }
  cfg.series = series;
  cfg.inds = inds;
  return cfg;
}

/* Recommended dashboards (institutional playbook: peer groups, de-correlated
   signals, top-down reading: market regime → peers → signal → confirmation). */
const PRESETS = [
  {
    key: "regime",
    name: "🌡️ Régime marché",
    why: "Le contexte AVANT de juger CHOG : risk-on ou risk-off ? (BTC, SOL et la TVL Monad, base 100). Fenêtre 90j — un régime de marché se lit à court terme.",
    cols: 2, h: "s",
    cfg: {
      w: 90, mode: "index",
      series: [{ sym: "BTC", metric: "price" }, { sym: "SOL", metric: "price" }, { sym: "MON", metric: "price" }],
      inds: [{ type: "met", metric: "tvl", target: 2, overlay: true, width: 1, dash: 2 }],
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
      series: [{ sym: "CHOG", metric: "price" }],
      inds: [
        { type: "met", metric: "mentions", target: 0, overlay: true, width: 1, dash: 0 },
        { type: "met", metric: "divergence", target: 0, overlay: false, width: 1, dash: 0 },
        { type: "macdap", period: 14, target: 0, overlay: false, width: 1, dash: 0 },
      ],
    },
  },
  {
    key: "triangul",
    name: "🔀 Triangulation CHOG",
    why: "Le buzz se traduit-il en adoption réelle ? Attention × communauté × on-chain — des signaux dé-corrélés. ⚠️ Holders et Discord ont peu d'historique : cette vue s'étoffera d'elle-même jour après jour.",
    cols: 2, h: "m",
    cfg: {
      w: 90, mode: "index",
      series: [{ sym: "CHOG", metric: "price" }],
      inds: [
        { type: "met", metric: "mentions", target: 0, overlay: true, width: 1, dash: 0 },
        { type: "met", metric: "holders", target: 0, overlay: true, width: 1, dash: 0 },
        { type: "met", metric: "discord", target: 0, overlay: true, width: 1, dash: 0 },
      ],
    },
  },
];
const newWidgetId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const widgetFromPreset = (p) => ({
  id: newWidgetId(), name: p.name, cols: p.cols, h: p.h, preset: p.key, cfg: structuredClone(p.cfg),
});

// ---- chart options + shared URL serialisation ---------------------------
function studioChartOptions(fontSize) {
  return {
    autoSize: true,
    layout: {
      background: { color: "transparent" },
      textColor: ink("--text-2"),
      fontFamily: ink("--font") || "system-ui",
      fontSize: fontSize || 12,
      panes: { separatorColor: ink("--border-strong"), separatorHoverColor: ink("--brand-ring"), enableResize: true },
    },
    grid: { vertLines: { color: ink("--grid") }, horzLines: { color: ink("--grid") } },
    rightPriceScale: { borderColor: ink("--border") },
    leftPriceScale: { borderColor: ink("--border") },
    timeScale: { borderColor: ink("--border"), timeVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  };
}
// Indicator token: type:periodOrMetric:target:place[:metric]
// - "met" carries its metric in slot 2; classic types carry the period there
//   and an optional source metric in slot 5 (omitted when it's "price").
function cfgToQuery(cfg) {
  const q = new URLSearchParams();
  q.set("s", cfg.series.map((e) => `${e.sym}`).join(","));
  if (cfg.inds?.length) {
    q.set("i", cfg.inds.map((i) => {
      const p2 = i.type === "met" ? i.metric : (i.period ?? 0);
      const base = [i.type, p2, i.target, i.overlay ? "o" : "p"];
      if (i.type !== "met" && i.metric && i.metric !== "price") base.push(i.metric);
      return base.join(":");
    }).join(","));
  }
  q.set("w", cfg.w === Infinity ? "max" : cfg.w);
  if (cfg.mode === "raw") q.set("m", "raw");
  return q.toString();
}

/* Empirically measured overheating zones (thresholds where forward returns
   were meaningfully worse/better than the pooled median, computed on our own
   history across memes). Each line is drawn on the indicator's sub-pane.
   kind: "bear" (red, distribution/overheat) · "bull" (green, accumulation) ·
   "warn" (orange, elevated) · "mid" (faint reference). */
const OVERHEAT_ZONES = {
  rsi: [
    { v: 65, kind: "bear", title: "surchauffe ≥65 (−23pp/30j)" },
    { v: 50, kind: "mid", title: "50" },
    { v: 30, kind: "bull", title: "survente ≤30 (rebond)" },
  ],
  flowratio: [
    { v: 52, kind: "bull", title: "accumulation ≥52% (+5pp/30j)" },
    { v: 50, kind: "mid", title: "équilibre 50%" },
    { v: 48, kind: "bear", title: "distribution ≤48% (−4pp)" },
  ],
  divergence: [
    { v: 1, kind: "bull", title: "attention devance ≥1 (+3pp)" },
    { v: 0, kind: "mid", title: "0" },
    { v: -1.5, kind: "bear", title: "essoufflement ≤−1.5 (−14pp)" },
  ],
  inprofit: [
    { v: 50, kind: "bear", title: "distribution ≥50% (−33%/30j, 0% win)" },
    { v: 35, kind: "warn", title: "prudence ≥35%" },
    { v: 20, kind: "bull", title: "capitulation ≤20% (45% win)" },
  ],
  composite: [
    { v: 65, kind: "bull", title: "signaux alignés ≥65" },
    { v: 50, kind: "mid", title: "neutre 50" },
    { v: 35, kind: "bear", title: "signaux dégradés ≤35" },
  ],
  buzz: [
    { v: 2, kind: "warn", title: "pic d'attention ≥2σ" },
  ],
};
const ZONE_COLOR = { bear: "#ff5c6c", bull: "#2fbf71", warn: "#e0a000", mid: "#5a5570" };
function applyOverheatZones(series, key) {
  const zones = key && OVERHEAT_ZONES[key];
  if (!zones || !series.createPriceLine) return;
  for (const z of zones) {
    try {
      series.createPriceLine({
        price: z.v,
        color: ZONE_COLOR[z.kind],
        lineWidth: 1,
        lineStyle: z.kind === "mid" ? 3 : 2, // dotted mid, dashed zones
        axisLabelVisible: z.kind !== "mid",
        title: z.title,
      });
    } catch { /* price lines are cosmetic */ }
  }
}

/* Draws a full config onto a chart. cfg = { w, mode, series, inds } (already
   migrated). ctx = { bySym, mById }. opts.paneHeight sizes sub-panes.
   Returns { created, items (legend info), anchorSeries }. */
function renderConfig(chart, cfg, ctx, opts = {}) {
  const { bySym, mById } = ctx;
  const isRawFmt = (id) => ["z", "signed"].includes(mById[id]?.format);
  const serieColor = (i) => cfg.series[i]?.color || PALETTE[i % PALETTE.length];
  const created = [], items = [], vprofiles = [];
  const paneAnchors = []; // first series of each pane — drawing-tool anchors
  let anchorSeries = null;
  let ovScaleN = 0;
  // Track the REAL data extent (whitespace excluded) to frame the view after
  // fitContent — reading the range back right after fitContent is unreliable
  // (it applies on the next frame).
  let minTime = null, maxTime = null;
  const add = (dataPts, o, paneIdx = 0, kind = LightweightCharts.LineSeries) => {
    if (!dataPts.length) return null;
    const s = chart.addSeries(kind, { priceLineVisible: false, lastValueVisible: false, ...o }, paneIdx);
    s.setData(dataPts);
    created.push(s);
    if (!paneAnchors[paneIdx]) paneAnchors[paneIdx] = s;
    const t0 = dataPts[0].time;
    let t1 = null;
    for (let i = dataPts.length - 1; i >= 0; i--) {
      if (dataPts[i].value != null) { t1 = dataPts[i].time; break; }
    }
    if (t0 && (!minTime || t0 < minTime)) minTime = t0;
    if (t1 && (!maxTime || t1 > maxTime)) maxTime = t1;
    return s;
  };

  // Left scale hosts raw z-format overlays (divergence/buzz) in index mode.
  const hasLeft = cfg.mode === "index" && (cfg.inds || []).some(
    (i) => !i.hidden && i.overlay && (i.type === "met" || INDS[i.type]?.hasSource) && isRawFmt(i.metric)
  );
  chart.applyOptions({ leftPriceScale: { visible: hasLeft } });

  // --- series: one price line per asset ---
  // The first visible series carries FUTURE WHITESPACE (+120 empty days) so the
  // time scale extends past today — drawings, rays and milestones can then be
  // placed or stretched into the future, TradingView-style.
  const FUTURE_DAYS = opts.futureDays ?? 120;
  let whitespaceDone = false;
  const ptsBySeries = cfg.series.map((e, idx) => {
    const m = mById.price;
    const pts = seriesPts(bySym[e.sym], m, cfg.w, cfg.mode === "index");
    const scale = cfg.mode === "raw" ? (idx === 0 ? "right" : "s" + idx) : "right";
    const fmt = cfg.mode === "index" ? (v) => v.toFixed(1) : (v) => fmtBy("price", v);
    let s = null;
    if (!e.hidden) {
      let data = pts;
      if (!whitespaceDone && pts.length && FUTURE_DAYS > 0) {
        const ws = [];
        for (let k = 1; k <= FUTURE_DAYS; k++) ws.push({ time: addDaysStr(pts.at(-1).time, k) });
        data = [...pts, ...ws];
        whitespaceDone = true;
      }
      s = add(data, { color: serieColor(idx), lineWidth: 2, priceScaleId: scale });
      if (!anchorSeries && s && scale === "right") anchorSeries = s;
    }
    items.push({ series: s, color: serieColor(idx), label: `${e.sym} · Prix`, value: pts.at(-1)?.value ?? null, struck: !!e.hidden, sub: false, fmt });
    return pts;
  });

  // Source points for an indicator: its metric (default price) on its target
  // asset, placed per overlay/sub-pane and scale mode.
  const srcFor = (ind) => {
    const tgt = cfg.series[ind.target];
    const asset = bySym[tgt.sym];
    const mid = ind.metric || "price";
    const m = mById[mid] || mById.price;
    if (ind.overlay) {
      if (cfg.mode === "index" && !isRawFmt(mid)) {
        return { pts: seriesPts(asset, m, cfg.w, true), scale: cfg.mode === "raw" ? "right" : "right", raw: false, m };
      }
      if (cfg.mode === "index") return { pts: seriesPts(asset, m, cfg.w, false), scale: "left", raw: true, m };
      // raw mode overlay: price rides the target's scale, metrics get their own
      if (mid === "price") {
        const scale = ind.target === 0 ? "right" : "s" + ind.target;
        return { pts: seriesPts(asset, m, cfg.w, false), scale, raw: true, m };
      }
      return { pts: seriesPts(asset, m, cfg.w, false), scale: "ov" + (ovScaleN++), raw: true, m };
    }
    return { pts: seriesPts(asset, m, cfg.w, false), scale: "right", raw: true, m };
  };

  let nextPane = 1;
  for (const ind of cfg.inds || []) {
    const tgt = cfg.series[ind.target];
    const def = INDS[ind.type];
    if (!tgt || !def) continue;
    const mid = ind.metric || "price";
    const srcLabel = ind.type === "met"
      ? (ctx.mById[mid]?.label || mid)
      : def.label + (def.period ? ind.period : "") + (def.hasSource && mid !== "price" ? ` · ${ctx.mById[mid]?.label || mid}` : "");
    const label = `${srcLabel} → ${tgt.sym}${ind.overlay ? "" : " · panneau"}`;
    const color = ind.color || serieColor(ind.target);
    const fmtDefault = (raw, m) => raw ? (v) => fmtBy(m.format, v) : (v) => v.toFixed(1);
    if (ind.hidden) { items.push({ series: null, color, label, struck: true, sub: true, fmt: (v) => String(v) }); continue; }

    const style = { color, lineWidth: ind.width || 1, lineStyle: ind.dash || 0 };
    const pane = ind.overlay ? 0 : nextPane++;
    let main = null;
    let fmt;

    if (ind.type === "vwap") {
      // VWAP anchored at the window start, on the target's RAW price×volume;
      // in index mode it is rescaled by the SAME base as the price series so
      // both lines share the scale.
      const raw = windowed(bySym[tgt.sym].prices || [], cfg.w).filter((p) => p.price != null);
      let cumPV = 0, cumV = 0;
      const vpts = [];
      for (const p of raw) {
        const vol = p.volume || 0;
        cumPV += p.price * vol;
        cumV += vol;
        if (cumV > 0) vpts.push({ time: p.date, value: cumPV / cumV });
      }
      let out = vpts;
      if (cfg.mode === "index") {
        const base = indexBase(raw.map((p) => p.price));
        if (base) out = vpts.map((p) => ({ time: p.time, value: (p.value / base) * 100 }));
      }
      const vwapScale = !ind.overlay ? "right"
        : cfg.mode === "raw" ? (ind.target === 0 ? "right" : "s" + ind.target) : "right";
      main = add(out, { ...style, priceScaleId: vwapScale }, pane);
      fmt = cfg.mode === "index" ? (v) => v.toFixed(1) : (v) => fmtBy("price", v);
    } else if (ind.type === "vprofile") {
      // Computed here (data side), painted by the Studio canvas overlay.
      const dispPts = ptsBySeries[ind.target];
      const volBy = new Map((bySym[tgt.sym].prices || []).map((p) => [p.date, p.volume || 0]));
      if (dispPts.length >= 5) {
        const vals = dispPts.map((p) => p.value);
        const lo = Math.min(...vals), hi = Math.max(...vals);
        const N = 24, step = (hi - lo) / N || 1;
        const rows = Array.from({ length: N }, (_, i) => ({ v0: lo + i * step, v1: lo + (i + 1) * step, vol: 0 }));
        for (const p of dispPts) {
          const i = Math.min(N - 1, Math.floor((p.value - lo) / step));
          rows[i].vol += volBy.get(p.time) || 0;
        }
        const max = Math.max(...rows.map((r) => r.vol));
        if (max > 0) vprofiles.push({ rows, max, color: ind.color || serieColor(ind.target) });
      }
      fmt = (v) => fmtCompact(v);
    } else if (ind.type === "flow") {
      // buy (green) vs sell (red): USD when Binance-listed, tx counts otherwise
      const tf = windowed(bySym[tgt.sym].tradeflow || [], cfg.w);
      const usd = tf.some((p) => p.buyUsd != null);
      const pick = (kb, kt) => tf.filter((p) => p[usd ? kb : kt] != null).map((p) => ({ time: p.date, value: p[usd ? kb : kt] }));
      main = add(pick("buyUsd", "buyTx"), { color: "#35d07f", lineWidth: ind.width || 1, priceScaleId: "right" }, pane);
      add(pick("sellUsd", "sellTx"), { color: "#ff6b6b", lineWidth: ind.width || 1, priceScaleId: "right" }, pane);
      fmt = usd ? (v) => "$" + fmtCompact(v) : (v) => fmtCompact(v) + " tx";
    } else if (ind.type === "tiers") {
      const ht = windowed(bySym[tgt.sym].holderTiers || [], cfg.w);
      for (const [key, , color] of TIER_LINES) {
        const pts = ht.filter((p) => p[key] != null).map((p) => ({ time: p.date, value: p[key] }));
        const s = add(pts, { color, lineWidth: ind.width || 1, priceScaleId: "right" }, pane);
        if (s) main = main || s;
      }
      fmt = (v) => fmtCompact(v);
    } else if (ind.type === "regime") {
      main = add(regimeBars(bySym[tgt.sym], cfg.w, ind.period), { priceScaleId: "right" }, pane, LightweightCharts.HistogramSeries);
      fmt = (v) => fmtBy("z", v);
    } else if (ind.type === "macdap") {
      const basePts = windowed(bySym[tgt.sym].divergence || [], cfg.w).map((p) => ({ time: p.date, value: p.div }));
      const { macd, signal, hist, markers } = macdCalc(basePts);
      add(hist, { priceScaleId: "right" }, pane, LightweightCharts.HistogramSeries);
      main = add(macd, { color: ind.color || "#9d8bff", lineWidth: ind.width || 1, priceScaleId: "right" }, pane);
      add(signal, { color: "#ff9800", lineWidth: 1, lineStyle: 2, priceScaleId: "right" }, pane);
      setSeriesMarkers(main, markers);
      fmt = (v) => (v >= 0 ? "+" : "") + v.toFixed(2);
    } else {
      const src = srcFor(ind);
      fmt = fmtDefault(src.raw, src.m);
      if (ind.type === "met") {
        main = add(src.pts, { ...style, priceScaleId: src.scale }, pane);
      } else if (ind.type === "sma" && src.pts.length >= 3) {
        main = add(smaPts(src.pts, ind.period), { ...style, priceScaleId: src.scale }, pane);
      } else if (ind.type === "ema" && src.pts.length >= 3) {
        main = add(emaPts(src.pts, ind.period), { ...style, priceScaleId: src.scale }, pane);
      } else if (ind.type === "boll" && src.pts.length >= 3) {
        const { up, lo } = bollPts(src.pts, ind.period);
        add(up, { ...style, priceScaleId: src.scale }, pane);
        main = add(lo, { ...style, priceScaleId: src.scale }, pane);
      } else if (ind.type === "rsi" && src.pts.length >= 3) {
        main = add(rsiPts(src.pts, ind.period), { ...style, priceScaleId: ind.overlay ? src.scale : "right" }, pane);
        fmt = (v) => v.toFixed(0);
      } else if (ind.type === "macd") {
        const { macd, signal, hist, markers } = macdCalc(src.pts);
        add(hist, { priceScaleId: "right" }, pane, LightweightCharts.HistogramSeries);
        main = add(macd, { color, lineWidth: ind.width || 1, priceScaleId: "right" }, pane);
        add(signal, { color: "#ff9800", lineWidth: 1, lineStyle: 2, priceScaleId: "right" }, pane);
        setSeriesMarkers(main, markers);
        fmt = (v) => (v >= 0 ? "+" : "") + v.toFixed(2);
      } else if (ind.type === "ichimoku" && src.pts.length >= 3) {
        const ich = ichimokuPts(src.pts);
        const w = ind.width || 1, d = ind.dash || 0;
        add(ich.tenkan, { color: ind.color || "#e0a000", lineWidth: w, lineStyle: d, priceScaleId: src.scale }, pane);
        add(ich.kijun, { color: "#3987e5", lineWidth: w, lineStyle: d, priceScaleId: src.scale }, pane);
        add(ich.senkouA, { color: "#35d07f", lineWidth: w, lineStyle: 2, priceScaleId: src.scale }, pane);
        add(ich.senkouB, { color: "#ff6b6b", lineWidth: w, lineStyle: 2, priceScaleId: src.scale }, pane);
        main = add(ich.chikou, { color: "#a8a2c0", lineWidth: w, lineStyle: 1, priceScaleId: src.scale }, pane);
      }
    }
    // Overheating zones on sub-panes: horizontal threshold lines coloured by
    // the empirically measured forward-return edge of each zone (see
    // OVERHEAT_ZONES). Only on sub-panes (overlays share the price scale).
    if (main && !ind.overlay) {
      const zk = ind.type === "rsi" ? "rsi"
        : ind.type === "flow" ? "flowratio"
        : ind.type === "met" ? (ind.metric === "price" ? null : ind.metric)
        : null;
      applyOverheatZones(main, zk);
    }
    items.push({ series: main, color: ind.type === "regime" ? "#35d07f" : color, label, struck: false, sub: true, fmt });
  }
  try {
    chart.panes().forEach((p, i) => { if (i > 0) p.setHeight(opts.paneHeight || 130); });
  } catch { /* pane sizing is cosmetic */ }
  // Frame the REAL data (the future whitespace stays reachable by scrolling
  // right, so drawings and milestones can live ahead of today).
  chart.timeScale().fitContent();
  if (whitespaceDone && minTime && maxTime) {
    try {
      chart.timeScale().setVisibleRange({ from: minTime, to: addDaysStr(maxTime, 5) });
    } catch { /* keep fitContent framing */ }
  }
  return { created, items, anchorSeries, vprofiles, paneAnchors };
}
