/* Radar token view — same template as the asset view (fiche actif): stat
   header, one chart with toggleable base-100 indexed indicators, plus a
   hand-off to the Studio where the token behaves like any config asset.
   Works on the pseudo-asset lib.js builds from radar history (symbol
   "SYM@chain"); depth grows daily as the radar accumulates. */

const METRIC_COLOR = {
  price: "#836ef9", volume: "#e0a000", liquidity: "#3987e5", flowratio: "#35d07f",
  mentions: "#17b8a6", discord: "#e0559a", telegram: "#29a9eb", holders: "#35e0a5",
  divergence: "#9d8bff",
};

// Radar-specific metric (not in the shared registry: config assets have TVL
// instead) + the registry ones that make sense for a discovered token.
const LIQ_METRIC = {
  id: "liquidity", label: "Liquidité", series: "liquidity", vkey: "liq", format: "usd",
  latest: (a) => a.liquidity?.at(-1)?.liq ?? null,
};
const TOKEN_METRICS = [
  METRIC_BY_ID.price, METRIC_BY_ID.volume, LIQ_METRIC, METRIC_BY_ID.flowratio,
  METRIC_BY_ID.holders, METRIC_BY_ID.telegram, METRIC_BY_ID.discord,
  METRIC_BY_ID.mentions, METRIC_BY_ID.divergence,
];

function metricPts(a, m, win) {
  const w = windowed(a[m.series] || [], win).filter((p) => p[m.vkey] != null);
  if (!w.length) return [];
  if (m.format === "signed" || m.format === "z") {
    // z-based series can be negative — plotted raw on the left scale
    return w.map((p) => ({ time: p.date, value: p[m.vkey] }));
  }
  const base = indexBase(w.map((p) => p[m.vkey]));
  if (!base) return [];
  return w.map((p) => ({ time: p.date, value: (p[m.vkey] / base) * 100 }));
}

async function boot() {
  buildTopbar("radar");
  const data = await loadData();
  const q = new URLSearchParams(location.search);
  const chain = q.get("chain"), addr = (q.get("addr") || "").toLowerCase();
  const a = (data.radarAssets || []).find((x) => x.chain === chain && x.address === addr)
    || (data.radarAssets || [])[0];
  if (!a) {
    document.getElementById("asset-head").innerHTML = "<h1>Token introuvable</h1>";
    return;
  }
  const t = a.radar;
  const sym = t.symbol;
  document.title = `CHOG Intel — $${sym}`;

  // --- header: symbol, chain, badges, social links
  const links = t.socials
    ? ["tw", "tg", "dc"].filter((k) => t.socials[k])
      .map((k) => `<a href="${t.socials[k]}" target="_blank" rel="noopener">${{ tw: "𝕏", tg: "Telegram", dc: "Discord" }[k]}</a>`).join(" · ")
    : "";
  const critNote = t.crit
    ? `<span class="radar-crit-badge" title="Hors critères">🚷 ${t.crit.includes("liq") ? "liquidité sous plancher" : ""}${t.crit.includes("holders") ? " · <50 holders" : ""}</span>`
    : "";
  document.getElementById("asset-head").innerHTML =
    `<div class="asset-title"><span class="head-dot" style="background:#836ef9"></span><h1>$${sym}</h1>
     <span class="asset-sub">${chain} · ${t.address.slice(0, 10)}… ${t.pinned ? "📌" : ""} ${critNote}</span>
     <span class="radar-links">${links}</span></div>
     ${t.mentionsShared ? '<p class="card-sub">Mentions X mutualisées avec le suivi principal (série complète, déjà payée).</p>' : ""}`;

  // --- stat tiles
  const stats = document.getElementById("stats");
  const tiles = [
    ["Prix", fmtPrice(a.prices.at(-1)?.price), a.latestChange24h],
    ["Market cap (FDV)", fmtUsdCompact(a.marketCap), null],
    ["Volume 24h", fmtUsdCompact(a.prices.at(-1)?.volume), null],
    ["Liquidité", fmtUsdCompact(a.liquidity.at(-1)?.liq), null],
    ["Pression achat", a.tradeflow.at(-1)?.ratio != null ? a.tradeflow.at(-1).ratio.toFixed(0) + "%" : "—", null],
    ["Holders", a.holders.length ? fmtCompact(a.holders.at(-1).holders) : "—", null],
    ["Telegram", a.telegram.length ? fmtCompact(a.telegram.at(-1).members) : "—", null],
    ["Discord", a.discord.length ? fmtCompact(a.discord.at(-1).members) : "—", null],
    ["Mentions X (dernier j)", a.mentions.length ? fmtCompact(a.mentions.at(-1).count) : "—", null],
    ["Âge du pool", t.age ? Math.max(0, Math.round((Date.now() - new Date(t.age)) / 864e5)) + "j" : "—", null],
  ];
  for (const [label, val, delta] of tiles) {
    const tile = document.createElement("div");
    tile.className = "stat-mini";
    tile.innerHTML = `<div class="stat-mini-label">${label}</div><div class="stat-mini-value">${val}</div>`;
    if (delta != null) {
      const chip = document.createElement("span");
      chip.className = "stat-mini-delta " + (delta >= 0 ? "up" : "down");
      chip.textContent = fmtDelta(delta);
      tile.append(chip);
    }
    stats.append(tile);
  }

  // --- Studio hand-off: the token exists in the Studio as SYM@chain
  document.getElementById("open-studio").href =
    `studio.html?s=${encodeURIComponent(a.symbol)}&i=${encodeURIComponent("met:mentions:0:p,met:flowratio:0:p")}&w=max`;

  // --- chart (LWC v5)
  const state = { window: Infinity, active: new Set(["price", "mentions"]) };
  const chartEl = document.getElementById("chart");
  const chart = LightweightCharts.createChart(chartEl, {
    height: 400, autoSize: true,
    layout: { background: { color: "transparent" }, textColor: ink("--text-2"), fontFamily: ink("--font") || "system-ui", attributionLogo: false },
    grid: { vertLines: { color: ink("--grid") }, horzLines: { color: ink("--grid") } },
    rightPriceScale: { borderColor: ink("--border") },
    leftPriceScale: { visible: false, borderColor: ink("--border") },
    timeScale: { borderColor: ink("--border"), timeVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  });

  let seriesList = [];
  function renderChart() {
    for (const s of seriesList) chart.removeSeries(s);
    seriesList = [];
    let priceSeries = null, pricePts = null, hasLeft = false, plotted = 0;
    for (const m of TOKEN_METRICS) {
      if (!state.active.has(m.id)) continue;
      const pts = metricPts(a, m, state.window);
      if (pts.length < 2) continue;
      const raw = m.format === "signed" || m.format === "z";
      const s = chart.addSeries(LightweightCharts.LineSeries, {
        color: METRIC_COLOR[m.id] || "#836ef9", lineWidth: 2,
        priceLineVisible: false, lastValueVisible: false,
        priceScaleId: raw ? "left" : "right",
      });
      if (raw) hasLeft = true;
      s.setData(pts);
      seriesList.push(s);
      plotted++;
      if (m.id === "price") { priceSeries = s; pricePts = pts; }
    }
    chart.applyOptions({ leftPriceScale: { visible: hasLeft } });
    applyEventMarkers(priceSeries, pricePts, journalEvents());
    chart.timeScale().fitContent();
    document.getElementById("chart-note").innerHTML = plotted
      ? "Tout indexé base 100 sur la fenêtre (Divergence : valeur brute, échelle de gauche). L'historique radar s'approfondit chaque jour de collecte."
      : "Pas encore assez d'historique (2 points minimum par série) — les graphes se remplissent dès les prochaines collectes quotidiennes.";
  }

  // --- controls: window + indicator toggles (same UX as the asset view)
  const controls = document.getElementById("chart-controls");
  const winGroup = document.createElement("div");
  winGroup.className = "control-group";
  winGroup.innerHTML = '<span class="control-label">Fenêtre</span>';
  const seg = document.createElement("div");
  seg.className = "segmented";
  for (const [val, text] of [[7, "7j"], [30, "30j"], [Infinity, "Max"]]) {
    const b = document.createElement("button");
    b.textContent = text;
    b.className = val === state.window ? "on" : "";
    b.addEventListener("click", () => {
      state.window = val;
      seg.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      renderChart();
    });
    seg.append(b);
  }
  winGroup.append(seg);

  const indGroup = document.createElement("div");
  indGroup.className = "control-group";
  indGroup.innerHTML = '<span class="control-label">Indicateurs</span>';
  for (const m of TOKEN_METRICS) {
    const hasData = (a[m.series] || []).filter((p) => p[m.vkey] != null).length >= 2;
    const b = document.createElement("button");
    b.className = "asset-toggle" + (state.active.has(m.id) ? " on" : "");
    b.disabled = !hasData;
    if (!hasData) b.title = "Pas encore assez d'historique";
    b.innerHTML = `<span class="dot" style="color:${METRIC_COLOR[m.id]};background:${METRIC_COLOR[m.id]}"></span><span>${m.label}</span>`;
    if (m.help) {
      const ico = helpIcon(m.help, m.label);
      if (ico) { ico.addEventListener("click", (ev) => ev.stopPropagation()); b.append(ico); }
    }
    b.addEventListener("click", () => {
      if (state.active.has(m.id)) state.active.delete(m.id);
      else state.active.add(m.id);
      b.classList.toggle("on");
      renderChart();
    });
    indGroup.append(b);
  }
  controls.append(winGroup, indGroup);
  renderChart();
}
boot();
