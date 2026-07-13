/* CHOG 360 — the command-center landing view. Synthesises the four data pillars
   (market / attention / community / on-chain) for CHOG, its proprietary signals,
   its rank vs the memecoin pack, and an on-chain deep-dive powered by the balance
   ledger aggregates (data.assets[CHOG].onchain). Reuses lib.js + the registry. */

const M_COLOR = {
  price: "#836ef9", volume: "#e0a000", tvl: "#3987e5",
  mentions: "#17b8a6", discord: "#e0559a", telegram: "#29a9eb", holders: "#35e0a5",
};
const CHOG_SYM = "CHOG";

// --- small helpers -------------------------------------------------------
function sparkSvg(values, color, w = 96, h = 28) {
  const pts = values.filter((v) => v != null);
  if (pts.length < 2) return "";
  const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
  const step = w / (pts.length - 1);
  const d = pts.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * (h - 4) - 2).toFixed(1)}`).join(" ");
  return `<svg class="spark-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<polyline fill="none" stroke="${color}" stroke-width="1.6" points="${d}" /></svg>`;
}
function seriesValues(a, m) {
  if (!m.series || !a[m.series]) return [];
  return a[m.series].map((p) => p[m.vkey]);
}
function memeValues(assets, m) {
  return assets.filter((a) => a.group === "memes")
    .map((a) => m.latest(a)).filter((v) => v != null);
}
function rankAmongMemes(assets, m, chog) {
  const v = m.latest(chog);
  if (v == null) return null;
  const vals = memeValues(assets, m).sort((x, y) => y - x);
  return { rank: vals.indexOf(v) + 1, total: vals.length };
}
function pctlAmongMemes(value, vals) {
  if (value == null || !vals.length) return null;
  return Math.round((vals.filter((v) => v <= value).length / vals.length) * 100);
}

// --- hero ---------------------------------------------------------------
function verbalRead(buzz, div, hold7) {
  const bits = [];
  if (buzz != null) {
    if (buzz >= 1.5) bits.push("attention en forte hausse");
    else if (buzz <= -1) bits.push("attention sous sa norme");
    else bits.push("attention proche de la normale");
  }
  if (div != null && buzz != null && buzz >= 1) {
    if (div >= 0.5) bits.push("devançant le prix → accumulation silencieuse potentielle");
    else if (div <= -0.5) bits.push("mais le prix a déjà décollé");
  }
  if (hold7 != null && Math.abs(hold7) >= 1) bits.push(`holders ${hold7 >= 0 ? "+" : ""}${hold7.toFixed(1)}% / 7j`);
  return bits.length ? bits.join(", ") + "." : "Données en constitution.";
}

function renderHero(el, a, assets) {
  const price = a.prices?.at(-1)?.price;
  const d24 = a.latestChange24h;
  const buzz = lastValue(a.buzz, "buzz");
  const div = lastValue(a.divergence, "div");
  const hold7 = pctOverDays(a.holders, "holders", 7);
  const dcls = d24 == null ? "" : d24 >= 0 ? "up" : "down";
  const bcls = buzz == null ? "" : buzz >= 1 ? "up" : buzz <= -1 ? "down" : "";
  const vcls = div == null ? "" : div >= 0.5 ? "up" : div <= -0.5 ? "down" : "";
  el.innerHTML = `
    <div class="hero-main">
      <div class="hero-id">
        <span class="hero-dot" style="background:${colorOf(CHOG_SYM)}"></span>
        <div>
          <h1>CHOG <span class="hero-chain">Monad · memecoin</span></h1>
          <div class="hero-read">${verbalRead(buzz, div, hold7)}</div>
        </div>
      </div>
      <div class="hero-price">
        <div class="hero-price-val">${fmtPrice(price)}</div>
        <div class="hero-price-chip ${dcls}">${fmtDelta(d24)} <span>24h</span></div>
      </div>
    </div>
    <div class="hero-signals">
      <div class="hero-sig">
        <div class="hero-sig-lbl">Market cap</div>
        <div class="hero-sig-val">${fmtUsdCompact(a.marketCap)}</div>
      </div>
      <div class="hero-sig">
        <div class="hero-sig-lbl">Holders</div>
        <div class="hero-sig-val">${fmtCompact(a.onchain?.holders ?? lastValue(a.holders, "holders"))}</div>
      </div>
      <div class="hero-sig">
        <div class="hero-sig-lbl">Buzz Score</div>
        <div class="hero-sig-val ${bcls}">${fmtBy("z", buzz)}</div>
      </div>
      <div class="hero-sig">
        <div class="hero-sig-lbl">Divergence</div>
        <div class="hero-sig-val ${vcls}">${fmtBy("signed", div)}</div>
      </div>
    </div>`;
}

// --- chart (price + indexed overlays) -----------------------------------
function metricIndexed(a, m, win) {
  const w = windowed(a[m.series], win).filter((p) => p[m.vkey] != null);
  if (!w.length) return [];
  const base = w.find((p) => p[m.vkey] !== 0)?.[m.vkey];
  if (!base) return [];
  return w.map((p) => ({ time: p.date, value: (p[m.vkey] / base) * 100 }));
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
function renderChart(a) {
  const state = { window: 90, active: new Set(["price", "mentions", "holders"]) };
  const chartEl = document.getElementById("chart");
  const chart = LightweightCharts.createChart(chartEl, {
    height: 380,
    layout: { background: { color: "transparent" }, textColor: ink("--text-2"), fontFamily: ink("--font") || "system-ui" },
    grid: { vertLines: { color: ink("--grid") }, horzLines: { color: ink("--grid") } },
    rightPriceScale: { borderColor: ink("--border") },
    timeScale: { borderColor: ink("--border"), timeVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  });
  new ResizeObserver(() => chart.applyOptions({ width: chartEl.clientWidth })).observe(chartEl);
  chart.applyOptions({ width: chartEl.clientWidth });
  let seriesList = [];
  function draw() {
    for (const s of seriesList) chart.removeSeries(s);
    seriesList = [];
    for (const m of CHART_METRICS) {
      if (!state.active.has(m.id)) continue;
      const pts = metricIndexed(a, m, state.window);
      if (!pts.length) continue;
      const s = chart.addLineSeries({ color: M_COLOR[m.id] || "#836ef9", lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
      s.setData(pts);
      seriesList.push(s);
    }
    chart.timeScale().fitContent();
  }
  const controls = document.getElementById("chart-controls");
  const winG = document.createElement("div");
  winG.className = "control-group";
  winG.innerHTML = '<span class="control-label">Fenêtre</span>';
  winG.append(segmented([[30, "30j"], [90, "90j"], [Infinity, "Max"]], () => state.window, (v) => { state.window = v; draw(); }));
  const indG = document.createElement("div");
  indG.className = "control-group";
  indG.innerHTML = '<span class="control-label">Indicateurs</span>';
  for (const m of CHART_METRICS) {
    const t = document.createElement("button");
    t.className = "asset-toggle" + (state.active.has(m.id) ? " on" : "");
    t.innerHTML = `<span class="dot" style="color:${M_COLOR[m.id]};background:${M_COLOR[m.id]}"></span><span>${m.label}</span>`;
    t.addEventListener("click", () => {
      state.active.has(m.id) ? state.active.delete(m.id) : state.active.add(m.id);
      t.classList.toggle("on");
      draw();
    });
    indG.append(t);
  }
  controls.append(winG, indG);
  document.getElementById("chart-note").innerHTML = "Tout indexé base 100 sur la fenêtre. Molette/glisser pour naviguer.";
  draw();
}

// --- pillars ------------------------------------------------------------
const PILLARS = [
  { title: "Marché", cls: "market", ids: ["price", "volume", "mcap", "tvl"] },
  { title: "Attention", cls: "social", ids: ["mentions", "buzz"] },
  { title: "Communauté", cls: "community", ids: ["discord", "telegram"] },
  { title: "On-chain", cls: "onchain", ids: ["holders"] },
];
function renderPillars(el, a, assets) {
  for (const p of PILLARS) {
    const card = document.createElement("div");
    card.className = "pillar pillar-" + p.cls;
    let rows = "";
    for (const id of p.ids) {
      const m = METRIC_BY_ID[id];
      if (!m) continue;
      const v = m.latest(a);
      const rk = rankAmongMemes(assets, m, a);
      const spark = m.series ? sparkSvg(seriesValues(a, m), M_COLOR[m.id] || "#836ef9") : "";
      let chips = "";
      for (const d of (m.deltas || []).slice(0, 3)) {
        const dv = pctOverDays(a[m.series], m.vkey, d);
        const c = dv == null ? "" : dv >= 0 ? "up" : "down";
        chips += `<span class="mini-chip ${c}">${DELTA_LABEL[d]} ${fmtDelta(dv)}</span>`;
      }
      rows += `
        <div class="pillar-metric">
          <div class="pm-top">
            <span class="pm-label">${m.label}</span>
            ${rk ? `<span class="pm-rank">#${rk.rank}<span>/${rk.total}</span></span>` : ""}
          </div>
          <div class="pm-mid">
            <span class="pm-value">${fmtBy(m.format, v)}</span>
            ${spark}
          </div>
          ${chips ? `<div class="pm-chips">${chips}</div>` : ""}
        </div>`;
    }
    card.innerHTML = `<div class="pillar-head">${p.title}</div>${rows}`;
    el.append(card);
  }
}

// --- positioning (percentile vs memes) ----------------------------------
function renderPositioning(el, a, assets) {
  const measures = [
    ["Prix 30j", (x) => pctOverDays(x.prices, "price", 30)],
    ["Volume", (x) => METRIC_BY_ID.volume.latest(x)],
    ["Mentions X", (x) => METRIC_BY_ID.mentions.latest(x)],
    ["Buzz Score", (x) => lastValue(x.buzz, "buzz")],
    ["Membres Discord", (x) => METRIC_BY_ID.discord.latest(x)],
    ["Holders", (x) => METRIC_BY_ID.holders.latest(x)],
  ];
  const memes = assets.filter((x) => x.group === "memes");
  for (const [label, fn] of measures) {
    const vals = memes.map(fn).filter((v) => v != null);
    const pctl = pctlAmongMemes(fn(a), vals);
    const cls = pctl == null ? "" : pctl >= 66 ? "up" : pctl <= 33 ? "down" : "mid";
    const row = document.createElement("div");
    row.className = "pos-row";
    row.innerHTML = `
      <span class="pos-label">${label}</span>
      <span class="pos-bar"><span class="pos-fill ${cls}" style="width:${pctl ?? 0}%"></span></span>
      <span class="pos-pctl">${pctl == null ? "—" : "P" + pctl}</span>`;
    el.append(row);
  }
}

// --- on-chain deep-dive -------------------------------------------------
function renderOnchain(el, a) {
  const o = a.onchain;
  if (!o) {
    el.innerHTML = `<div class="card"><p class="card-sub">Grand livre on-chain indisponible (l'index se construit au prochain run CI).</p></div>`;
    return;
  }
  // 1) concentration
  const gPct = o.gini == null ? "—" : Math.round(o.gini * 100);
  const conc = document.createElement("div");
  conc.className = "card onchain-card";
  conc.innerHTML = `
    <div class="card-head"><h2>Concentration</h2></div>
    <div class="conc-metrics">
      <div class="conc-big"><span>${o.top10}%</span><label>détenus par le top 10</label></div>
      <div class="conc-sub">
        <div><b>${o.top1}%</b> top 1</div>
        <div><b>${o.top100}%</b> top 100</div>
        <div><b>${o.whales}</b> whales <span class="dim">(≥1% supply)</span></div>
      </div>
    </div>
    <div class="gini-row"><span>Indice de Gini</span>
      <span class="gini-bar"><span class="gini-fill" style="width:${gPct === "—" ? 0 : gPct}%"></span></span>
      <b>${o.gini ?? "—"}</b></div>
    <p class="card-sub dim">Inclut pools de liquidité / trésorerie. Gini proche de 1 = très concentré.</p>`;
  el.append(conc);

  // 2) distribution histogram
  const maxC = Math.max(...o.buckets.map((b) => b.count));
  const dist = document.createElement("div");
  dist.className = "card onchain-card";
  dist.innerHTML = `<div class="card-head"><h2>Distribution des holders</h2></div>
    <p class="card-sub">Nombre de holders par tranche de solde (tokens CHOG).</p>
    <div class="hist">${o.buckets.map((b) => `
      <div class="hist-row">
        <span class="hist-label">${b.label}</span>
        <span class="hist-track"><span class="hist-fill" style="width:${maxC ? Math.max(2, (b.count / maxC) * 100) : 0}%"></span></span>
        <span class="hist-count">${fmtCompact(b.count)}</span>
      </div>`).join("")}</div>`;
  el.append(dist);

  // 3) flows (accumulation / distribution) — fills once history exists
  const flows = a.holderFlows || [];
  const last = flows.at(-1);
  const flowCard = document.createElement("div");
  flowCard.className = "card onchain-card";
  if (last && (last.accumulating || last.distributing || last.newHolders || last.churned)) {
    flowCard.innerHTML = `<div class="card-head"><h2>Flux du jour</h2></div>
      <p class="card-sub">Variation des soldes sur la dernière période (${last.date}).</p>
      <div class="flow-grid">
        <div class="flow-cell up"><span>${fmtCompact(last.accumulating)}</span><label>accumulent</label></div>
        <div class="flow-cell down"><span>${fmtCompact(last.distributing)}</span><label>distribuent</label></div>
        <div class="flow-cell up"><span>${fmtCompact(last.newHolders)}</span><label>nouveaux</label></div>
        <div class="flow-cell down"><span>${fmtCompact(last.churned)}</span><label>sortis</label></div>
      </div>`;
  } else {
    flowCard.innerHTML = `<div class="card-head"><h2>Flux accumulation / distribution</h2></div>
      <p class="card-sub">Combien de soldes montent vs descendent chaque jour, nouveaux vs sortants.</p>
      <div class="flow-empty">📈 Historique en constitution — se remplit dès le prochain jour avec des transferts CHOG. Le collecteur compare le grand livre avant/après chaque run.</div>`;
  }
  el.append(flowCard);
}

// --- signals feed -------------------------------------------------------
function renderSignals(el, a) {
  const date = a.prices?.at(-1)?.date || "";
  const buzz = lastValue(a.buzz, "buzz");
  const div = lastValue(a.divergence, "div");
  const h7 = pctOverDays(a.holders, "holders", 7);
  const p7 = pctOverDays(a.prices, "price", 7);
  const m7 = pctOverDays(a.mentions, "count", 7);
  const items = [];
  if (buzz != null) items.push([buzz >= 1.5 ? "up" : buzz <= -1 ? "down" : "mid", `Buzz Score ${fmtBy("z", buzz)}`, buzz >= 1.5 ? "Pic d'attention vs la norme 30j" : buzz <= -1 ? "Attention en berne" : "Attention normale"]);
  if (div != null) items.push([div >= 0.5 ? "up" : div <= -0.5 ? "down" : "mid", `Divergence ${fmtBy("signed", div)}`, div >= 0.5 ? "Attention devance le prix (accumulation ?)" : div <= -0.5 ? "Prix devance l'attention" : "Attention et prix alignés"]);
  if (h7 != null) items.push([h7 >= 0 ? "up" : "down", `Holders ${fmtDelta(h7)} / 7j`, "Croissance de la base de holders"]);
  if (m7 != null) items.push([m7 >= 0 ? "up" : "down", `Mentions ${fmtDelta(m7)} / 7j`, "Volume de mentions X"]);
  if (p7 != null) items.push([p7 >= 0 ? "up" : "down", `Prix ${fmtDelta(p7)} / 7j`, "Performance hebdomadaire"]);
  el.innerHTML = `<p class="card-sub">Signaux évalués au ${date}.</p>` + items.map(([c, t, s]) => `
    <div class="sig-item">
      <span class="sig-dot ${c}"></span>
      <span class="sig-title">${t}</span>
      <span class="sig-desc">${s}</span>
    </div>`).join("");
}

// --- boot ---------------------------------------------------------------
async function boot() {
  buildTopbar("chog");
  const data = await loadData();
  const a = data.assets.find((x) => x.symbol === CHOG_SYM) || data.assets[0];
  renderHero(document.getElementById("hero"), a, data.assets);
  renderChart(a);
  renderPillars(document.getElementById("pillars"), a, data.assets);
  renderPositioning(document.getElementById("positioning"), a, data.assets);
  renderOnchain(document.getElementById("onchain"), a);
  renderSignals(document.getElementById("signals-feed"), a);
}
boot();
