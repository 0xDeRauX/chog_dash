/* Screener view: sortable/filterable table with a "measure focus" selector.
   Overview = compact glance across all metrics; focus a measure to compare it
   across all periods (24h/7j/30j/90j), heatmap-coloured. Row -> asset page. */

function sparkline(series) {
  const pts = windowed(series || [], 30).filter((p) => p.price != null);
  const wrap = document.createElement("span");
  wrap.className = "spark";
  if (pts.length < 2) return wrap;
  const vals = pts.map((p) => p.price);
  const min = Math.min(...vals), max = Math.max(...vals);
  const W = 80, H = 24, span = max - min || 1;
  const step = W / (pts.length - 1);
  const d = vals
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(H - ((v - min) / span) * H).toFixed(1)}`)
    .join(" ");
  const up = vals.at(-1) >= vals[0];
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", up ? ink("--up") : ink("--down"));
  path.setAttribute("stroke-width", "1.5");
  svg.append(path);
  wrap.append(svg);
  return wrap;
}

// Heatmap background for a delta %: green up / red down, alpha by magnitude.
function deltaHeat(v) {
  if (v == null) return "transparent";
  const a = Math.min(Math.abs(v) / 50, 0.42);
  return v >= 0 ? `rgba(53,208,127,${a})` : `rgba(255,107,107,${a})`;
}
// Heatmap for a Buzz z-score: full intensity around ±3σ.
function buzzHeat(z) {
  if (z == null) return "transparent";
  const a = Math.min(Math.abs(z) / 3, 0.5);
  return z >= 0 ? `rgba(53,208,127,${a})` : `rgba(255,107,107,${a})`;
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
  buildTopbar("screener");
  const data = await loadData();
  document.getElementById("meta").textContent =
    "Dernière collecte : " + new Date(data.generatedAt).toLocaleString("fr-FR");

  const state = { measure: "overview", group: "all", search: "", sortKey: "mcap", sortDir: "desc" };
  let columns = columnsForMeasure(state.measure);

  // --- filter bar: measure selector + group + search
  const filters = document.getElementById("filters");
  const measureGroup = document.createElement("div");
  measureGroup.className = "control-group";
  const measureLbl = document.createElement("span");
  measureLbl.className = "control-label";
  measureLbl.textContent = "Mesure";
  measureGroup.append(measureLbl, segmentedControl(
    MEASURES, () => state.measure,
    (v) => { state.measure = v; state.sortKey = defaultSortKey(v); state.sortDir = "desc"; rebuild(); }
  ));
  const groupCtl = segmentedControl(
    [["all", "Tous"], ["memes", "Memecoins"], ["majors", "Big caps"]],
    () => state.group, (v) => { state.group = v; renderRows(); }
  );
  const search = document.createElement("input");
  search.className = "search-input";
  search.placeholder = "Rechercher…";
  search.addEventListener("input", () => { state.search = search.value.trim().toUpperCase(); renderRows(); });
  filters.append(measureGroup, groupCtl, search);

  const host = document.getElementById("screener");
  let tbody;

  function rebuild() {
    columns = columnsForMeasure(state.measure);
    host.innerHTML = "";
    const table = document.createElement("table");
    table.className = "screener-table";
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    const thRank = document.createElement("th");
    thRank.textContent = "#";
    const thAsset = document.createElement("th");
    thAsset.textContent = "Actif";
    hr.append(thRank, thAsset);
    for (const c of columns) {
      const th = document.createElement("th");
      th.textContent = c.label;
      th.className = "sortable";
      th.dataset.key = c.key;
      const arrow = document.createElement("span");
      arrow.className = "sort-arrow";
      th.append(arrow);
      th.addEventListener("click", () => {
        if (state.sortKey === c.key) state.sortDir = state.sortDir === "desc" ? "asc" : "desc";
        else { state.sortKey = c.key; state.sortDir = "desc"; }
        renderRows();
      });
      hr.append(th);
    }
    thead.append(hr);
    tbody = document.createElement("tbody");
    table.append(thead, tbody);
    host.append(table);
    renderRows();
  }

  function renderRows() {
    // header sort indicators
    host.querySelectorAll("th.sortable").forEach((th) => {
      const on = th.dataset.key === state.sortKey;
      th.classList.toggle("active", on);
      th.querySelector(".sort-arrow").textContent = on ? (state.sortDir === "desc" ? " ↓" : " ↑") : "";
    });

    let rows = data.assets.filter((a) => state.group === "all" || a.group === state.group);
    if (state.search) rows = rows.filter((a) => a.symbol.includes(state.search));

    const col = columns.find((c) => c.key === state.sortKey) || columns[0];
    rows = [...rows].sort((a, b) => {
      const va = columnValue(col, a), vb = columnValue(col, b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return state.sortDir === "asc" ? va - vb : vb - va;
    });

    tbody.innerHTML = "";
    rows.forEach((a, i) => {
      const tr = document.createElement("tr");
      tr.className = "screener-row";
      tr.addEventListener("click", () => { location.href = `asset.html?sym=${a.symbol}`; });

      const rank = document.createElement("td");
      rank.className = "rank";
      rank.textContent = i + 1;
      const asset = document.createElement("td");
      const cell = document.createElement("span");
      cell.className = "asset-cell";
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = colorOf(a.symbol);
      const sym = document.createElement("span");
      sym.className = "asset-sym";
      sym.textContent = a.symbol;
      const chain = document.createElement("span");
      chain.className = "asset-chain";
      chain.textContent = a.chain;
      cell.append(dot, sym, chain, sparkline(a.prices));
      asset.append(cell);
      tr.append(rank, asset);

      for (const c of columns) {
        const td = document.createElement("td");
        const v = columnValue(c, a);
        if (c.kind === "delta") {
          td.textContent = fmtDelta(v);
          td.className = "heat";
          td.style.background = deltaHeat(v);
        } else if (c.metric.id === "buzz") {
          td.textContent = fmtBy("z", v);
          td.className = "heat";
          td.style.background = buzzHeat(v);
        } else {
          td.textContent = fmtBy(c.metric.format, v);
        }
        tr.append(td);
      }
      tbody.append(tr);
    });
  }

  rebuild();
}

boot();
