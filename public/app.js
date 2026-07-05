function seriesColor(root, slot) {
  return getComputedStyle(root).getPropertyValue(`--series-${slot}`).trim();
}

function formatCompact(n) {
  if (n === null || n === undefined) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString("en-US");
}

function formatPrice(p) {
  if (p === null || p === undefined) return "—";
  if (p >= 1) return "$" + p.toFixed(2);
  return "$" + p.toPrecision(3);
}

function formatDelta(pct) {
  if (pct === null || pct === undefined) return "—";
  const sign = pct >= 0 ? "↑" : "↓";
  return `${sign} ${Math.abs(pct).toFixed(1)}%`;
}

// index = value / first-known-value * 100, so series of very different scales
// (mentions in the thousands, prices in fractions of a cent) plot on one axis.
function indexSeries(points, key) {
  const base = points.find((p) => p[key] !== null && p[key] !== undefined && p[key] !== 0);
  if (!base) return points.map((p) => null);
  return points.map((p) =>
    p[key] === null || p[key] === undefined ? null : (p[key] / base[key]) * 100
  );
}

function renderStatTiles(container, root, assets) {
  container.innerHTML = "";
  assets.forEach((asset, i) => {
    const latestMention = asset.mentions.at(-1);
    const latestPrice = asset.prices.at(-1);
    const change = latestPrice?.change24h ?? null;

    const tile = document.createElement("div");
    tile.className = "stat-tile";

    const label = document.createElement("div");
    label.className = "tile-label";
    const swatch = document.createElement("span");
    swatch.className = "tile-swatch";
    swatch.style.background = seriesColor(root, i + 1);
    label.appendChild(swatch);
    const labelText = document.createElement("span");
    labelText.textContent = `${asset.symbol} · ${asset.chain}`;
    label.appendChild(labelText);
    tile.appendChild(label);

    const value = document.createElement("div");
    value.className = "tile-value";
    value.textContent = formatPrice(latestPrice?.price ?? null);
    tile.appendChild(value);

    const delta = document.createElement("div");
    delta.className = "tile-delta " + (change >= 0 ? "good" : "bad");
    delta.textContent = formatDelta(change) + " (24h)";
    tile.appendChild(delta);

    const secondary = document.createElement("div");
    secondary.className = "tile-secondary";
    secondary.textContent = `${formatCompact(latestMention?.count ?? null)} mentions X / 24h`;
    tile.appendChild(secondary);

    container.appendChild(tile);
  });
}

function unionDates(assets, key) {
  const set = new Set();
  for (const asset of assets) {
    for (const p of asset[key]) set.add(p.date);
  }
  return [...set].sort();
}

function buildDataset(asset, slot, root, dates, key, valueKey) {
  const byDate = new Map(asset[key].map((p) => [p.date, p]));
  const points = dates.map((d) => byDate.get(d) ?? { date: d, [valueKey]: null });
  const indexed = indexSeries(points, valueKey);
  return {
    label: asset.symbol,
    data: indexed,
    borderColor: seriesColor(root, slot),
    backgroundColor: seriesColor(root, slot),
    borderWidth: 2,
    pointRadius: 4,
    pointHoverRadius: 6,
    pointBorderColor: getComputedStyle(root).getPropertyValue("--surface-1").trim(),
    pointBorderWidth: 2,
    tension: 0,
    spanGaps: true,
  };
}

function chartOptions(root) {
  const textSecondary = getComputedStyle(root).getPropertyValue("--text-secondary").trim();
  const gridline = getComputedStyle(root).getPropertyValue("--gridline").trim();
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        position: "top",
        align: "start",
        labels: { color: textSecondary, boxWidth: 16, boxHeight: 2 },
      },
      tooltip: {
        mode: "index",
        intersect: false,
        callbacks: {
          label: (ctx) =>
            `${ctx.dataset.label}: ${ctx.parsed.y === null ? "—" : ctx.parsed.y.toFixed(1)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: gridline },
        ticks: { color: textSecondary },
      },
      y: {
        grid: { color: gridline },
        ticks: { color: textSecondary },
        title: { display: true, text: "Indice (jour 1 = 100)", color: textSecondary },
      },
    },
  };
}

function renderTable(tbody, assets) {
  tbody.innerHTML = "";
  for (const asset of assets) {
    const priceByDate = new Map(asset.prices.map((p) => [p.date, p]));
    for (const m of asset.mentions) {
      const price = priceByDate.get(m.date);
      const tr = document.createElement("tr");

      const cells = [
        asset.symbol,
        asset.chain,
        m.date,
        formatCompact(m.count),
        formatPrice(price?.price ?? null),
      ];
      for (const text of cells) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      }

      const deltaTd = document.createElement("td");
      const change = price?.change24h ?? null;
      deltaTd.textContent = formatDelta(change);
      deltaTd.className = "delta " + (change >= 0 ? "good" : "bad");
      tr.appendChild(deltaTd);

      tbody.appendChild(tr);
    }
  }
}

let mentionsChart = null;
let pricesChart = null;

function renderCharts(root, data) {
  const mentionDates = unionDates(data.assets, "mentions");
  const priceDates = unionDates(data.assets, "prices");

  mentionsChart?.destroy();
  pricesChart?.destroy();

  mentionsChart = new Chart(document.getElementById("chart-mentions"), {
    type: "line",
    data: {
      labels: mentionDates,
      datasets: data.assets.map((a, i) =>
        buildDataset(a, i + 1, root, mentionDates, "mentions", "count")
      ),
    },
    options: chartOptions(root),
  });

  pricesChart = new Chart(document.getElementById("chart-prices"), {
    type: "line",
    data: {
      labels: priceDates,
      datasets: data.assets.map((a, i) =>
        buildDataset(a, i + 1, root, priceDates, "prices", "price")
      ),
    },
    options: chartOptions(root),
  });
}

async function main() {
  const root = document.body;
  const res = await fetch("./data.json");
  const data = await res.json();

  document.getElementById("generated-at").textContent =
    "Dernière collecte : " + new Date(data.generatedAt).toLocaleString("fr-FR");

  renderStatTiles(document.getElementById("stat-tiles"), root, data.assets);
  renderTable(document.querySelector("#raw-table tbody"), data.assets);
  renderCharts(root, data);

  // Dark/light mode is a selected variant, not an automatic filter — re-read
  // the CSS custom properties and rebuild colors when the OS theme flips.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    renderStatTiles(document.getElementById("stat-tiles"), root, data.assets);
    renderCharts(root, data);
  });
}

main();
