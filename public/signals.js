/* Signals view: a cross-asset correlation heatmap — which assets have price
   coupled to attention / TVL / community, and which diverge. */

const CORR_PAIRS = [
  ["Prix ↔ Mentions", "prices", "price", "mentions", "count"],
  ["Prix ↔ TVL", "prices", "price", "tvl", "tvl"],
  ["Prix ↔ Discord", "prices", "price", "discord", "members"],
  ["Prix ↔ Volume", "prices", "price", "prices", "volume"],
  ["Mentions ↔ TVL", "mentions", "count", "tvl", "tvl"],
  ["Mentions ↔ Discord", "mentions", "count", "discord", "members"],
];

function corrCellColor(r) {
  if (r == null) return "transparent";
  const a = Math.min(Math.abs(r), 1) * 0.5;
  return r >= 0 ? `rgba(53,208,127,${a})` : `rgba(255,107,107,${a})`;
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
  document.getElementById("meta").textContent =
    "Dernière collecte : " + new Date(data.generatedAt).toLocaleString("fr-FR");

  const state = { window: 90, group: "all" };

  const filters = document.getElementById("filters");
  filters.append(
    segmentedControl(
      [["all", "Tous"], ["memes", "Memecoins"], ["majors", "Big caps"]],
      () => state.group,
      (v) => { state.group = v; render(); }
    ),
    segmentedControl(
      [[30, "30j"], [90, "90j"], [Infinity, "Max"]],
      () => state.window,
      (v) => { state.window = v; render(); }
    )
  );

  const container = document.getElementById("heatmap");

  function render() {
    const assets = data.assets.filter((a) => state.group === "all" || a.group === state.group);
    const table = document.createElement("table");
    table.className = "heatmap-table";
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    const th0 = document.createElement("th");
    th0.textContent = "Actif";
    hr.append(th0);
    for (const [label] of CORR_PAIRS) {
      const th = document.createElement("th");
      th.textContent = label;
      hr.append(th);
    }
    thead.append(hr);
    const tbody = document.createElement("tbody");

    for (const a of assets) {
      const tr = document.createElement("tr");
      const td0 = document.createElement("td");
      const cell = document.createElement("span");
      cell.className = "asset-cell";
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = colorOf(a.symbol);
      const sym = document.createElement("span");
      sym.className = "asset-sym";
      sym.textContent = a.symbol;
      cell.append(dot, sym);
      td0.append(cell);
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
    container.innerHTML = "";
    container.append(table);
  }

  render();
}

boot();
