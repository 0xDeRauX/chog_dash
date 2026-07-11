/* Screener view: one sortable/filterable table of every asset, columns driven
   by the registry, a price sparkline per row, row -> asset page. */

// Tiny inline SVG sparkline from a price series (last ~30 points), coloured by trend.
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

  const columns = screenerColumns();
  const state = { group: "all", search: "", sortKey: "mcap", sortDir: "desc" };

  // --- filter bar
  const filters = document.getElementById("filters");
  const groupCtl = segmentedControl(
    [["all", "Tous"], ["memes", "Memecoins"], ["majors", "Big caps"]],
    () => state.group,
    (v) => { state.group = v; render(); }
  );
  const search = document.createElement("input");
  search.className = "search-input";
  search.placeholder = "Rechercher un actif…";
  search.addEventListener("input", () => { state.search = search.value.trim().toUpperCase(); render(); });
  filters.append(groupCtl, search);

  // --- table shell
  const table = document.createElement("table");
  table.className = "screener-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const thRank = document.createElement("th");
  thRank.textContent = "#";
  const thAsset = document.createElement("th");
  thAsset.textContent = "Actif";
  headRow.append(thRank, thAsset);
  for (const c of columns) {
    const th = document.createElement("th");
    th.textContent = c.label;
    th.className = "sortable" + (c.key === state.sortKey ? " active" : "");
    th.dataset.key = c.key;
    const arrow = document.createElement("span");
    arrow.className = "sort-arrow";
    th.append(arrow);
    th.addEventListener("click", () => {
      if (state.sortKey === c.key) state.sortDir = state.sortDir === "desc" ? "asc" : "desc";
      else { state.sortKey = c.key; state.sortDir = "desc"; }
      render();
    });
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement("tbody");
  table.append(thead, tbody);
  document.getElementById("screener").append(table);

  function render() {
    // header state
    headRow.querySelectorAll("th.sortable").forEach((th) => {
      const on = th.dataset.key === state.sortKey;
      th.classList.toggle("active", on);
      th.querySelector(".sort-arrow").textContent = on ? (state.sortDir === "desc" ? " ↓" : " ↑") : "";
    });

    let rows = data.assets.filter((a) => state.group === "all" || a.group === state.group);
    if (state.search) rows = rows.filter((a) => a.symbol.includes(state.search));

    const col = columns.find((c) => c.key === state.sortKey);
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
          td.className = v == null ? "" : v >= 0 ? "up" : "down";
        } else {
          td.textContent = fmtBy(c.metric.format, v);
        }
        tr.append(td);
      }
      tbody.append(tr);
    });
  }

  render();
}

boot();
