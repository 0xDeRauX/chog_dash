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
// Share of holders in a PnL tranche = tranche count / total holders — a bounded
// 0-1 oscillator, so it's tested raw (not z-scored like a trending count).
function shareFromPnl(series, key) {
  const m = new Map();
  for (const p of series || []) if (p[key] != null && p.holders > 0) m.set(p.date, p[key] / p.holders);
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
    {
      id: "flow", label: "Pression achat",
      help: {
        what: "Part du volume <b>acheteur</b> (taker) dans le volume total du jour — le facteur le plus prédictif de notre étude déclencheurs (+0.34 pour le lendemain).",
        read: "Son IC est suivi ici en continu : s'il se dégrade, l'edge s'est évaporé — ne pas trader un chiffre d'étude périmé.",
        quality: "Mesuré sur les flux $ Binance (et tx DEX ailleurs). Historique 365j.",
      },
      build: (a) => mapFromSeries(a.tradeflow, "ratio"),
    },
    {
      id: "inprofit", label: "% en gain", help: METRIC_BY_ID.inprofit?.help,
      build: (a) => mapFromSeries(a.pnl, "pctInProfit"),
    },
    {
      id: "x10share", label: "% ×10+ (euphorie)",
      help: {
        what: "Part des holders en gain de <b>plus de ×10</b> vs leur coût d'entrée — euphorie tardive, risque de distribution.",
        read: "Un IC négatif est attendu : trop d'euphorie (beaucoup de gros gagnants) précède souvent une correction.",
        quality: "Reconstruit du coût d'entrée (grand livre CHOG, transferts Solana/EVM/TON).",
      },
      build: (a) => shareFromPnl(a.pnl, "x10"),
    },
    {
      id: "capitul", label: "% capitulation (−50%)",
      help: {
        what: "Part des holders sous <b>−50%</b> (fortement dans le rouge) — capitulation ; plancher potentiel (contrarian).",
        read: "Un IC positif est attendu : quand presque tout le monde est sous l'eau, les vendeurs s'épuisent.",
        quality: "Reconstruit du coût d'entrée (grand livre / transferts).",
      },
      build: (a) => shareFromPnl(a.pnl, "l50"),
    },
  ];
  RAW_SIGNALS = [
    { id: "volume", label: "Volume (z)", build: (a) => zScoreByDate(a.prices, "volume") },
    { id: "holders50", label: "Holders≥$50 (z)", build: (a) => zScoreByDate(a.holderTiers, "h50") },
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

  // ---- ④ Divergence confirmée (A statut · B harnais · D heatmap) ----
  state.divconf = { ...DIVCONF_DEFAULT };
  const pct = (v) => (v == null ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%");
  const pctW = (v) => (v == null ? "—" : (v * 100).toFixed(0) + "%");
  function retCellColor(med) {
    if (med == null) return "rgba(255,255,255,0.03)";
    const a = Math.min(Math.abs(med) / 0.3, 1) * 0.55;
    return med >= 0 ? `rgba(53,208,127,${a})` : `rgba(255,107,107,${a})`;
  }

  // A · per-asset current status
  const statusEl = document.getElementById("divconf-status");
  function renderStatus() {
    const assets = groupAssets();
    const table = document.createElement("table");
    table.className = "heatmap-table";
    table.innerHTML = "<thead><tr><th>Actif</th><th>SMA7(div)</th><th>RSI 14</th><th>Statut</th><th>Dernier signal</th></tr></thead>";
    const tb = document.createElement("tbody");
    for (const a of assets) {
      const { status } = divConfSignal(a, state.divconf);
      const tr = document.createElement("tr");
      let badge = '<span class="dc-badge dc-off">—</span>';
      if (status.firingToday) badge = '<span class="dc-badge dc-fire">🎯 signal actif</span>';
      else if (status.inSetup) badge = '<span class="dc-badge dc-setup">👀 en zone</span>';
      const smaTxt = status.curSma == null ? "—" : (status.curSma >= 0 ? "+" : "") + status.curSma.toFixed(2);
      const rsiTxt = status.curRsi == null ? "—" : status.curRsi.toFixed(0);
      tr.innerHTML =
        `<td><span class="asset-cell"><span class="dot" style="background:${colorOf(a.symbol)}"></span><span class="asset-sym">${a.symbol}</span></span></td>` +
        `<td class="heat-cell" style="background:${status.curSma != null && status.curSma >= state.divconf.thr ? "rgba(53,208,127,0.18)" : "transparent"}">${smaTxt}</td>` +
        `<td class="heat-cell" style="background:${status.curRsi != null && status.curRsi > state.divconf.rsiFloor ? "rgba(53,208,127,0.12)" : "transparent"}">${rsiTxt}</td>` +
        `<td>${badge}</td><td class="dc-last">${status.lastFire || "—"}</td>`;
      tb.append(tr);
    }
    table.append(tb);
    statusEl.innerHTML = "";
    statusEl.append(table);
  }

  // B · backtest harness
  const controlsEl = document.getElementById("divconf-controls");
  const backtestEl = document.getElementById("divconf-backtest");
  function ctrl(label, options, key, cast = Number, toOpt = (x) => x) {
    const g = document.createElement("div");
    g.className = "control-group";
    const l = document.createElement("span");
    l.className = "control-label";
    l.textContent = label;
    g.append(l, segmentedControl(options, () => toOpt(state.divconf[key]), (v) => { state.divconf[key] = cast(v); renderStatus(); renderBacktest(); renderHeatmap(); renderByAsset(); }));
    return g;
  }
  controlsEl.append(
    ctrl("Déclencheur", [["cross", "Franchissement"], ["level", "Niveau"]], "cross", (v) => v === "cross", (b) => (b ? "cross" : "level")),
    ctrl("Seuil divergence", [[1, "+1"], [1.5, "+1.5"], [2, "+2"], [2.5, "+2.5"], [3, "+3"]], "thr"),
    ctrl("Plancher RSI", [[0, "aucun"], [45, "45"], [50, "50"], [55, "55"]], "rsiFloor"),
    ctrl("Plafond RSI", [[65, "65 (anti-surchauffe)"], [100, "aucun"]], "rsiCeil"),
    ctrl("Lissage", [[5, "5j"], [7, "7j"], [10, "10j"], [14, "14j"]], "sma"),
  );
  // segmentedControl compares val to current() with ===; cross uses booleans, so
  // seed the "on" class right after building (the option values are strings).
  function renderBacktest() {
    const bt = backtestEntry(groupAssets(), state.divconf);
    const H = [7, 14, 30];
    const table = document.createElement("table");
    table.className = "heatmap-table";
    table.innerHTML = "<thead><tr><th></th><th>n</th>" + H.map((h) => `<th>${h}j · médiane / win</th>`).join("") + "</tr></thead>";
    const tb = document.createElement("tbody");
    const rowFor = (label, src, hl) => {
      const tr = document.createElement("tr");
      let cells = `<td class="verdict-name">${label}</td><td>${src[H[0]].n}</td>`;
      for (const h of H) {
        const s = src[h];
        cells += `<td class="heat-cell" style="background:${hl ? retCellColor(s.med) : "transparent"}">${pct(s.med)} <span class="dc-win">/ ${pctW(s.win)}</span></td>`;
      }
      tr.innerHTML = cells;
      return tr;
    };
    tb.append(rowFor("Règle", bt.rule, true), rowFor("Base (tous les jours)", bt.base, false));
    table.append(tb);
    const note = document.createElement("p");
    note.className = "card-sub dc-btnote";
    const conc = bt.byAsset.slice(0, 6).map((x) => `${x.symbol}×${x.n}`).join(", ");
    note.innerHTML = bt.rule[7].n
      ? `<b>${bt.rule[7].n} événements</b> sur <b>${bt.assets} actifs</b> ${conc ? "(" + conc + (bt.byAsset.length > 6 ? "…" : "") + ")" : ""}. Une règle qui bat la base sur peu d'événements reste fragile — vise la <b>cohérence sur les 3 horizons</b> plutôt qu'un seul chiffre flatteur.`
      : "Aucun événement sur ce groupe/ces réglages — élargis le seuil ou change de groupe.";
    backtestEl.innerHTML = "";
    backtestEl.append(table, note);
  }

  // D · div × RSI heatmap
  const heatmapEl = document.getElementById("divconf-heatmap");
  function renderHeatmap() {
    const { dbins, rbins, grid } = divRsiGrid(groupAssets(), { sma: state.divconf.sma, horizon: 30 });
    const rlab = ["RSI<40", "40-50", "50-65", "≥65"];
    const dlab = ["div<−1", "−1..0", "0..+1", "+1..+2", "≥+2"];
    const table = document.createElement("table");
    table.className = "heatmap-table";
    table.innerHTML = "<thead><tr><th>SMA" + state.divconf.sma + "(div) ＼ RSI</th>" + rlab.map((s) => `<th>${s}</th>`).join("") + "</tr></thead>";
    const tb = document.createElement("tbody");
    grid.forEach((row, di) => {
      const tr = document.createElement("tr");
      let cells = `<td class="verdict-name">${dlab[di]}</td>`;
      row.forEach((c) => {
        cells += `<td class="heat-cell" style="background:${retCellColor(c.med)}" title="n=${c.n}">${c.med == null ? (c.n ? "·" : "") : (c.med >= 0 ? "+" : "") + (c.med * 100).toFixed(0) + "%"}<span class="dc-n">${c.n >= 8 ? " n=" + c.n : ""}</span></td>`;
      });
      tr.innerHTML = cells;
      tb.append(tr);
    });
    table.append(tb);
    heatmapEl.innerHTML = "";
    heatmapEl.append(table);
  }
  // E · per-asset backtest (where the rule actually works)
  const byAssetEl = document.getElementById("divconf-byasset");
  function renderByAsset() {
    const params = { sma: state.divconf.sma, thr: state.divconf.thr, cross: state.divconf.cross, buyLo: state.divconf.rsiFloor, buyHi: state.divconf.rsiCeil };
    const rows = backtestByAsset(groupAssets(), params);
    const H = [7, 14, 30];
    const table = document.createElement("table");
    table.className = "heatmap-table";
    table.innerHTML = "<thead><tr><th>Actif</th><th>Signaux</th>" + H.map((h) => `<th>${h}j · médiane / win</th>`).join("") + "</tr></thead>";
    const tb = document.createElement("tbody");
    for (const r of rows) {
      const tr = document.createElement("tr");
      let cells = `<td><span class="asset-cell"><span class="dot" style="background:${colorOf(r.symbol)}"></span><span class="asset-sym">${r.symbol}</span></span></td><td>${r.buys || "—"}</td>`;
      for (const h of H) {
        const s = r.h[h];
        cells += `<td class="heat-cell" style="background:${s.n ? retCellColor(s.med) : "transparent"}">${s.n ? pct(s.med) + ' <span class="dc-win">/ ' + pctW(s.win) + "</span>" : "—"}</td>`;
      }
      tr.innerHTML = cells;
      tb.append(tr);
    }
    table.append(tb);
    byAssetEl.innerHTML = "";
    byAssetEl.append(table);
  }
  function renderDivconf() { renderStatus(); renderBacktest(); renderHeatmap(); renderByAsset(); }

  function renderAll() { renderVerdict(); renderICTable(); renderCorr(); renderDivconf(); }
  renderAll();
}

boot();
