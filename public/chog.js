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
  const comp = lastValue(a.composite, "score");
  const vel = lastValue(a.velocity, "vel");
  const hold7 = pctOverDays(a.holders, "holders", 7);
  const dcls = d24 == null ? "" : d24 >= 0 ? "up" : "down";
  const bcls = buzz == null ? "" : buzz >= 1 ? "up" : buzz <= -1 ? "down" : "";
  const vcls = div == null ? "" : div >= 0.5 ? "up" : div <= -0.5 ? "down" : "";
  const ccls = comp == null ? "" : comp >= 65 ? "up" : comp <= 35 ? "down" : "";
  const velcls = vel == null ? "" : vel >= 1 ? "up" : vel <= -1 ? "down" : "";
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
      <div class="hero-sig hero-sig-comp">
        <div class="hero-sig-lbl" id="hero-comp-lbl">Score composite</div>
        <div class="hero-sig-val ${ccls}">${comp ?? "—"}<span class="hero-sig-sub">/100</span></div>
      </div>
      <div class="hero-sig">
        <div class="hero-sig-lbl" id="hero-vel-lbl">Vélocité comm.</div>
        <div class="hero-sig-val ${velcls}">${fmtBy("signed", vel)}</div>
      </div>
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
  // ⓘ help cards on the proprietary tiles (same registry help as everywhere)
  for (const [sel, mid] of [["#hero-comp-lbl", "composite"], ["#hero-vel-lbl", "velocity"]]) {
    const lbl = el.querySelector(sel);
    const m = METRIC_BY_ID[mid];
    if (lbl && m?.help) { const ico = helpIcon(m.help, m.label); if (ico) lbl.append(ico); }
  }
}

// --- holder PnL (replayed ledger): today's tranches + the tops study ------
function renderPnl(el, a) {
  if (!el) return;
  const pnl = a.pnl || [];
  if (!pnl.length) {
    el.innerHTML = '<p class="card-sub">Le grand livre PnL n\'est pas encore construit — première collecte à venir.</p>';
    return;
  }
  const last = pnl.at(-1);
  const lagDays = Math.round((Date.now() - new Date(last.date + "T00:00:00Z")) / 864e5);
  const lagBanner = lagDays > 2
    ? `<p class="pnl-lag">⚠️ L'indexeur on-chain (thirdweb Insight) est en retard de <b>${lagDays} jours</b> sur la chaîne Monad : le grand livre s'arrête au <b>${last.date}</b>. Tranches, % en gain et compte de holders reflètent cette date — rien n'est extrapolé. (Le même retard affecte la série Holders CHOG.)</p>`
    : "";
  const inProfitHelp = METRIC_BY_ID.inprofit?.help;
  const tranches = [
    ["≥ ×10", last.x10, "up"],
    ["×2 – ×10", last.x2_10, "up"],
    ["0 à +100%", last.x1_2, "up"],
    ["0 à −50%", last.l0_50, "down"],
    ["≤ −50%", last.l50, "down"],
  ];
  const pctBar = (n) => last.holders ? ((n / last.holders) * 100).toFixed(1) + "%" : "—";
  const realized7 = pnl.slice(-7).reduce((s2, r) => s2 + (r.realizedUsd || 0), 0);

  // Tops study: local maxima (price = max over ±10j) followed by a ≥20% drop
  // within 15j → what did the PnL table look like THAT day?
  const prices = (a.prices || []).filter((p) => p.price != null);
  const pnlBy = new Map(pnl.map((r) => [r.date, r]));
  const tops = [];
  for (let i = 10; i < prices.length - 10; i++) {
    const p = prices[i];
    const win = prices.slice(i - 10, i + 11);
    if (p.price < Math.max(...win.map((x) => x.price))) continue;
    const after = prices.slice(i + 1, i + 16).map((x) => x.price);
    if (!after.length || Math.min(...after) > p.price * 0.8) continue;
    const row = pnlBy.get(p.date);
    if (!row) continue;
    const prev3 = pnl.filter((r) => r.date < p.date).slice(-3);
    tops.push({
      date: p.date, price: p.price,
      pct: row.pctInProfit,
      realized3: prev3.reduce((s2, r) => s2 + (r.realizedUsd || 0), 0) + (row.realizedUsd || 0),
      big3: prev3.reduce((s2, r) => s2 + (r.realizedBigUsd || 0), 0) + (row.realizedBigUsd || 0),
    });
    i += 10; // one top per window
  }

  el.innerHTML = `${lagBanner}
    <div class="pnl-grid">
      <div class="pnl-col">
        <div class="pnl-head">
          <div><div class="stat-mini-label">% de holders en gain <span id="pnl-help"></span></div>
          <div class="pnl-big">${last.pctInProfit != null ? last.pctInProfit.toFixed(1) + "%" : "—"}</div></div>
          <div><div class="stat-mini-label">PnL réalisé (7j)</div>
          <div class="pnl-big ${realized7 >= 0 ? "up" : "down"}">${fmtUsdCompact(Math.abs(realized7))}${realized7 < 0 ? " de pertes" : ""}</div></div>
        </div>
        <table class="pnl-table">
          <thead><tr><th style="text-align:left">Tranche (multiple du coût d'entrée)</th><th># holders</th><th>part</th></tr></thead>
          <tbody>${tranches.map(([lbl, n, cls]) =>
            `<tr><td style="text-align:left" class="${cls}">${lbl}</td><td>${fmtCompact(n)}</td><td>${pctBar(n || 0)}</td></tr>`).join("")}
          </tbody>
        </table>
        <p class="card-sub">Au ${last.date} · ${fmtCompact(last.holders)} holders valorisés (poussière <$0.01 et pools exclus). Coût d'entrée estimé au prix du jour de chaque transfert.</p>
      </div>
      <div class="pnl-col">
        <h4 class="pnl-sub">Les tops passés — dans quel contexte la montée s'est arrêtée</h4>
        ${tops.length ? `<table class="pnl-table">
          <thead><tr><th style="text-align:left">Top</th><th>Prix</th><th>% en gain ce jour</th><th>Réalisé (top ±3j)</th><th>dont gros (≥$5K)</th></tr></thead>
          <tbody>${tops.slice(-6).reverse().map((t) =>
            `<tr><td style="text-align:left">${t.date}</td><td>${fmtPrice(t.price)}</td>
             <td class="${t.pct >= 80 ? "down" : ""}">${t.pct != null ? t.pct.toFixed(1) + "%" : "—"}</td>
             <td>${fmtUsdCompact(t.realized3)}</td><td>${fmtUsdCompact(t.big3)}</td></tr>`).join("")}
          </tbody>
        </table>
        <p class="card-sub">Un « top » = plus haut sur ±10j suivi d'une baisse ≥20% sous 15j. Si les tops arrivent systématiquement à % en gain élevé + accélération du réalisé, c'est un signal de distribution mesuré — vérifiable ici, pas supposé.</p>`
        : '<p class="card-sub">Aucun top détecté encore (plus haut ±10j suivi d\'une baisse ≥20%) — la table se remplira avec l\'historique.</p>'}
      </div>
    </div>`;
  if (inProfitHelp) {
    const slot = el.querySelector("#pnl-help");
    const ico = helpIcon(inProfitHelp, "% en gain");
    if (slot && ico) slot.append(ico);
  }
}

// --- chart (price + indexed overlays) -----------------------------------
function metricIndexed(a, m, win) {
  const w = windowed(a[m.series], win).filter((p) => p[m.vkey] != null);
  if (!w.length) return [];
  const base = indexBase(w.map((p) => p[m.vkey])); // robust vs launch dust (lib.js)
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
    let priceSeries = null, pricePts = null;
    for (const m of CHART_METRICS) {
      if (!state.active.has(m.id)) continue;
      const pts = metricIndexed(a, m, state.window);
      if (!pts.length) continue;
      const s = chart.addLineSeries({ color: M_COLOR[m.id] || "#836ef9", lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
      s.setData(pts);
      seriesList.push(s);
      if (m.id === "price") { priceSeries = s; pricePts = pts; }
    }
    applyEventMarkers(priceSeries, pricePts, journalEvents()); // global milestones
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
        <div class="pillar-metric" data-help="${m.help ? m.id : ""}">
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
    // Attach the ⓘ hover cards for the custom indicators in this pillar.
    for (const slot of card.querySelectorAll(".pillar-metric[data-help]")) {
      const m = METRIC_BY_ID[slot.dataset.help];
      if (!m?.help) continue;
      const ico = helpIcon(m.help, m.label);
      if (ico) slot.querySelector(".pm-label").after(ico);
    }
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
  renderPnl(document.getElementById("pnl-body"), a);
  renderSignals(document.getElementById("signals-feed"), a);
}
boot();
