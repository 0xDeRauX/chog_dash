/* Signals view — a self-validating analytics layer:
   ① Verdict     : does each indicator PREDICT (pooled IC 1/7/30j + badge)?
   ② IC per asset: predictive power of every signal, per asset, at one horizon.
   ③ Correlations: what moves TOGETHER (descriptive, daily changes) — the
                   contrast that shows correlation ≠ prediction.
   IC math lives in lib.js; the signal definitions live here. */

// The signals we test. Indicators come from the registry (with their ⓘ help);
// raw metrics are tested as their own z-score (deviation from their norm) so the
// IC isn't spurious on a trending level. Each build() → Map(date -> value).
function mapFromSeries(series, key) {
  const m = new Map();
  for (const p of series || []) if (p[key] != null) m.set(p.date, p[key]);
  return m;
}
function regimeSignal(a) {
  // Buzz signed by the price direction over the last 7 days (the Régime A/P idea).
  const buzz = mapFromSeries(a.buzz, "buzz");
  const priceBy = new Map((a.prices || []).map((p) => [p.date, p.price]));
  const out = new Map();
  for (const [d, z] of buzz) {
    const cur = priceBy.get(d);
    let ref = null;
    for (let k = 0; k <= 5 && ref == null; k++) ref = priceBy.get(addDaysISO(d, -7 - k));
    if (cur != null && ref != null) out.set(d, z * (cur >= ref ? 1 : -1));
  }
  return out;
}

let INDICATORS, RAW_SIGNALS, ALL_SIGNALS;
function defineSignals() {
  INDICATORS = [
    { id: "buzz", label: "Buzz", help: METRIC_BY_ID.buzz?.help, build: (a) => mapFromSeries(a.buzz, "buzz") },
    { id: "divergence", label: "Divergence", help: METRIC_BY_ID.divergence?.help, build: (a) => mapFromSeries(a.divergence, "div") },
    {
      id: "regime", label: "Régime A/P", build: regimeSignal,
      help: { what: "Intensité des mentions signée par la direction du prix.", quality: "Testé ici même — voir son IC ci-dessous." },
    },
  ];
  RAW_SIGNALS = [
    { id: "volume", label: "Volume (z)", build: (a) => zScoreByDate(a.prices, "volume") },
    { id: "tvl", label: "TVL (z)", build: (a) => zScoreByDate(a.tvl, "tvl") },
    { id: "holders", label: "Holders (z)", build: (a) => zScoreByDate(a.holders, "holders") },
    { id: "discord", label: "Discord (z)", build: (a) => zScoreByDate(a.discord, "members") },
    { id: "telegram", label: "Telegram (z)", build: (a) => zScoreByDate(a.telegram, "members") },
  ];
  ALL_SIGNALS = [...INDICATORS, ...RAW_SIGNALS];
}

const HORIZONS = [1, 7, 30];
const IC_MEANINGFUL = 0.05;

function icCellColor(ic) {
  if (ic == null) return "transparent";
  if (Math.abs(ic) < IC_MEANINGFUL) return "rgba(255,255,255,0.03)"; // below threshold = noise
  const a = Math.min(Math.abs(ic) / 0.25, 1) * 0.55;
  return ic >= 0 ? `rgba(53,208,127,${a})` : `rgba(255,107,107,${a})`;
}
function corrCellColor(r) {
  if (r == null) return "transparent";
  const a = Math.min(Math.abs(r), 1) * 0.5;
  return r >= 0 ? `rgba(53,208,127,${a})` : `rgba(255,107,107,${a})`;
}
const fmtIC = (ic) => (ic == null ? "—" : (ic >= 0 ? "+" : "") + ic.toFixed(2));

// Verdict from the best-horizon IC + sign consistency across horizons.
function verdictOf(ics) {
  const vals = ics.filter((v) => v != null);
  if (!vals.length) return { cls: "", txt: "—", note: "pas assez d'historique" };
  const best = vals.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
  const consistent = vals.every((v) => (v >= 0) === (best >= 0));
  if (Math.abs(best) >= IC_MEANINGFUL && consistent) return { cls: "up", txt: "✅ prédictif", note: "au-dessus du seuil 0.05" };
  if (Math.abs(best) >= IC_MEANINGFUL) return { cls: "mid", txt: "🟡 mitigé", note: "significatif mais change de signe" };
  if (Math.abs(best) >= 0.03) return { cls: "mid", txt: "🟡 faible", note: "sous le seuil" };
  return { cls: "down", txt: "❌ bruit", note: "aucun pouvoir prédictif" };
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
  buildTopbar("signaux");
  const data = await loadData();
  defineSignals();
  document.getElementById("meta").textContent =
    "Dernière collecte : " + new Date(data.generatedAt).toLocaleString("fr-FR");

  const state = { window: 90, group: "memes", horizon: 7 };

  const filters = document.getElementById("filters");
  filters.append(
    segmentedControl(
      [["memes", "Memecoins"], ["majors", "Big caps"], ["all", "Tous"]],
      () => state.group,
      (v) => { state.group = v; renderAll(); }
    ),
    (() => {
      const g = document.createElement("div");
      g.className = "control-group";
      const l = document.createElement("span");
      l.className = "control-label";
      l.textContent = "Fenêtre corrél.";
      g.append(l, segmentedControl(
        [[30, "30j"], [90, "90j"], [Infinity, "Max"]],
        () => state.window,
        (v) => { state.window = v; renderCorr(); }
      ));
      return g;
    })()
  );

  const groupAssets = () => data.assets.filter((a) => state.group === "all" || a.group === state.group);

  // ---- ① verdict ----
  const verdictEl = document.getElementById("verdict");
  function renderVerdict() {
    const assets = groupAssets();
    const table = document.createElement("table");
    table.className = "heatmap-table verdict-table";
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    hr.innerHTML = "<th>Indicateur</th>" + HORIZONS.map((h) => `<th>IC ${h}j</th>`).join("") + "<th>Verdict</th>";
    thead.append(hr);
    const tbody = document.createElement("tbody");
    for (const sig of INDICATORS) {
      const ics = HORIZONS.map((h) => icPooled(assets, sig.build, h).ic);
      const v = verdictOf(ics);
      const tr = document.createElement("tr");
      const name = document.createElement("td");
      name.className = "verdict-name";
      name.textContent = sig.label;
      if (sig.help) { const ico = helpIcon(sig.help, sig.label); if (ico) name.append(ico); }
      tr.append(name);
      for (const ic of ics) {
        const td = document.createElement("td");
        td.className = "heat-cell";
        td.style.background = icCellColor(ic);
        td.textContent = fmtIC(ic);
        tr.append(td);
      }
      const vt = document.createElement("td");
      vt.className = "verdict-badge " + v.cls;
      vt.innerHTML = `${v.txt}<span class="verdict-note">${v.note}</span>`;
      tr.append(vt);
      tbody.append(tr);
    }
    table.append(thead, tbody);
    verdictEl.innerHTML = "";
    verdictEl.append(table);
  }

  // ---- ② IC per asset ----
  const horizonEl = document.getElementById("ic-horizon");
  horizonEl.append((() => {
    const g = document.createElement("div");
    g.className = "control-group";
    const l = document.createElement("span");
    l.className = "control-label";
    l.textContent = "Horizon prédictif";
    g.append(l, segmentedControl(
      HORIZONS.map((h) => [h, h + "j"]),
      () => state.horizon,
      (v) => { state.horizon = Number(v); renderICTable(); }
    ));
    return g;
  })());
  const icTableEl = document.getElementById("ic-table");
  function renderICTable() {
    const assets = groupAssets();
    const table = document.createElement("table");
    table.className = "heatmap-table ic-table";
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    const th0 = document.createElement("th");
    th0.textContent = "Actif";
    hr.append(th0);
    for (const sig of ALL_SIGNALS) {
      const th = document.createElement("th");
      th.textContent = sig.label;
      if (sig.id === "regime" || sig.id === "buzz") th.classList.add("col-sep");
      hr.append(th);
    }
    thead.append(hr);
    const tbody = document.createElement("tbody");
    for (const a of assets) {
      const tr = document.createElement("tr");
      const td0 = document.createElement("td");
      td0.innerHTML = `<span class="asset-cell"><span class="dot" style="background:${colorOf(a.symbol)}"></span><span class="asset-sym">${a.symbol}</span></span>`;
      tr.append(td0);
      for (const sig of ALL_SIGNALS) {
        const { ic } = icTimeSeries(sig.build(a), a.prices, state.horizon);
        const td = document.createElement("td");
        td.className = "heat-cell";
        if (sig.id === "regime" || sig.id === "buzz") td.classList.add("col-sep");
        td.style.background = icCellColor(ic);
        td.textContent = fmtIC(ic);
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(thead, tbody);
    icTableEl.innerHTML = "";
    icTableEl.append(table);
  }

  // ---- ③ correlations (descriptive) ----
  const CORR_PAIRS = [
    ["Prix ↔ Mentions", "prices", "price", "mentions", "count"],
    ["Prix ↔ TVL", "prices", "price", "tvl", "tvl"],
    ["Prix ↔ Volume", "prices", "price", "prices", "volume"],
    ["Prix ↔ Discord", "prices", "price", "discord", "members"],
    ["Mentions ↔ TVL", "mentions", "count", "tvl", "tvl"],
    ["Mentions ↔ Discord", "mentions", "count", "discord", "members"],
  ];
  const heatEl = document.getElementById("heatmap");
  function renderCorr() {
    const assets = groupAssets();
    const table = document.createElement("table");
    table.className = "heatmap-table";
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    hr.innerHTML = "<th>Actif</th>" + CORR_PAIRS.map(([l]) => `<th>${l}</th>`).join("");
    thead.append(hr);
    const tbody = document.createElement("tbody");
    for (const a of assets) {
      const tr = document.createElement("tr");
      const td0 = document.createElement("td");
      td0.innerHTML = `<span class="asset-cell"><span class="dot" style="background:${colorOf(a.symbol)}"></span><span class="asset-sym">${a.symbol}</span></span>`;
      tr.append(td0);
      for (const [, sA, kA, sB, kB] of CORR_PAIRS) {
        const { r } = corrReturns(a[sA], kA, a[sB], kB, state.window);
        const td = document.createElement("td");
        td.className = "heat-cell";
        td.style.background = corrCellColor(r);
        td.textContent = r == null ? "—" : (r >= 0 ? "+" : "") + r.toFixed(2);
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(thead, tbody);
    heatEl.innerHTML = "";
    heatEl.append(table);
  }

  function renderAll() { renderVerdict(); renderICTable(); renderCorr(); }
  renderAll();
}

boot();
