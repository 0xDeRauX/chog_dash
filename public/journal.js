/* Journal de bord — dated milestones (global or chart-scoped) + measured
   impact. The general chart lets you click a date to prefill the form; the
   impact table computes each asset's change +1/+7/+30 days after the event
   (an event study, from data.json — no extra collection). */

const LS_WIDGETS_J = "chog-dash-widgets-v1";

async function boot() {
  buildTopbar("journal");
  const data = await loadData();
  const assets = data.assets;
  const bySym = Object.fromEntries(assets.map((a) => [a.symbol, a]));
  const metrics = METRICS.filter((m) => m.series);
  const mById = Object.fromEntries(metrics.map((m) => [m.id, m]));

  let chartSym = "BTC";
  let selectedId = null;

  // ---- general chart (click = prefill date) ----
  const chartEl = document.getElementById("journal-chart");
  const chart = LightweightCharts.createChart(chartEl, studioChartOptions());
  let drawn = [];
  function renderChart() {
    for (const s of drawn) chart.removeSeries(s);
    drawn = [];
    const pts = seriesPts(bySym[chartSym], mById.price, 365, false);
    const s = chart.addSeries(LightweightCharts.LineSeries,
      { color: colorOf(chartSym), lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    s.setData(pts);
    drawn.push(s);
    applyEventMarkers(s, pts, journalEvents());
    chart.timeScale().fitContent();
  }
  chart.subscribeClick((param) => {
    if (!param.time) return;
    const t = typeof param.time === "string"
      ? param.time
      : `${param.time.year}-${String(param.time.month).padStart(2, "0")}-${String(param.time.day).padStart(2, "0")}`;
    const inp = document.getElementById("j-date");
    if (inp) {
      inp.value = t;
      document.getElementById("j-label")?.focus();
    }
  });

  const controls = document.getElementById("journal-controls");
  const symSel = document.createElement("select");
  symSel.className = "studio-select";
  for (const a of assets) {
    const o = document.createElement("option");
    o.value = a.symbol;
    o.textContent = a.symbol;
    if (a.symbol === chartSym) o.selected = true;
    symSel.append(o);
  }
  symSel.addEventListener("change", () => { chartSym = symSel.value; renderChart(); });
  const lbl = document.createElement("span");
  lbl.className = "control-label";
  lbl.textContent = "Actif de référence";
  controls.append(lbl, symSel);

  // ---- scopes: global, Studio, each Mon Dash widget ----
  function scopeOptions() {
    const opts = [["global", "🌍 Global (tous les graphes)"], ["studio", "🎛 Studio uniquement"]];
    try {
      for (const w of JSON.parse(localStorage.getItem(LS_WIDGETS_J)) || []) {
        opts.push([w.id, `📊 Widget « ${w.name} »`]);
      }
    } catch { /* no widgets */ }
    return opts;
  }
  const scopeLabel = (scope) => (scopeOptions().find(([v]) => v === scope)?.[1] || "📊 " + scope).replace(/^[^\s]+\s/, "");

  // ---- form ----
  const form = document.getElementById("journal-form");
  function renderForm() {
    form.innerHTML = "";
    const date = document.createElement("input");
    date.type = "date";
    date.id = "j-date";
    date.className = "studio-select";
    date.value = new Date().toISOString().slice(0, 10);
    const label = document.createElement("input");
    label.type = "text";
    label.id = "j-label";
    label.className = "studio-select j-label";
    label.placeholder = "Libellé — ex. Fed +25bp, listing Binance…";
    label.maxLength = 60;
    const cat = document.createElement("select");
    cat.className = "studio-select";
    for (const [v, t, c] of JOURNAL_CATS) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = t;
      if (v === "crypto") o.selected = true;
      cat.append(o);
    }
    const scope = document.createElement("select");
    scope.className = "studio-select";
    for (const [v, t] of scopeOptions()) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = t;
      scope.append(o);
    }
    const add = document.createElement("button");
    add.className = "btn-ghost";
    add.textContent = "+ Ajouter le jalon";
    add.addEventListener("click", () => {
      if (!date.value || !label.value.trim()) { label.focus(); return; }
      journalAdd({ date: date.value, label: label.value.trim(), cat: cat.value, scope: scope.value });
      label.value = "";
      renderList();
      renderChart();
    });
    form.append(date, label, cat, scope, add);
  }

  // ---- list ----
  const list = document.getElementById("journal-list");
  function renderList() {
    const evts = journalAll().sort((a, b) => b.date.localeCompare(a.date));
    list.innerHTML = "";
    if (!evts.length) {
      list.innerHTML = '<p class="card-sub">Aucun jalon — ajoute le premier ci-dessus (ex. « Fed +25bp » en Macro/Global).</p>';
      document.getElementById("impact-card").hidden = true;
      return;
    }
    const table = document.createElement("table");
    table.innerHTML = "<thead><tr><th>Date</th><th style='text-align:left'>Jalon</th><th>Catégorie</th><th>Portée</th><th></th></tr></thead>";
    const tb = document.createElement("tbody");
    for (const e of evts) {
      const tr = document.createElement("tr");
      tr.className = "journal-row" + (e.id === selectedId ? " sel" : "");
      tr.innerHTML = `<td>${e.date}</td>
        <td style="text-align:left"><span class="j-dot" style="background:${journalCatColor(e.cat)}"></span>${e.label}</td>
        <td>${JOURNAL_CATS.find(([k]) => k === e.cat)?.[1] || e.cat}</td>
        <td class="j-scope">${e.scope === "global" ? "Global" : scopeLabel(e.scope)}</td>`;
      const td = document.createElement("td");
      const edit = document.createElement("button");
      edit.className = "btn-x";
      edit.textContent = "✎";
      edit.title = "Renommer";
      edit.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const l = prompt("Libellé :", e.label);
        if (l?.trim()) {
          const all = journalAll();
          const f = all.find((x) => x.id === e.id);
          if (f) { f.label = l.trim(); journalSave(all); renderList(); renderChart(); }
        }
      });
      const del = document.createElement("button");
      del.className = "btn-x";
      del.textContent = "✕";
      del.title = "Supprimer";
      del.addEventListener("click", (ev) => {
        ev.stopPropagation();
        journalSave(journalAll().filter((x) => x.id !== e.id));
        if (selectedId === e.id) selectedId = null;
        renderList();
        renderChart();
      });
      td.append(edit, del);
      tr.append(td);
      tr.addEventListener("click", () => { selectedId = e.id; renderList(); renderImpact(e); });
      tb.append(tr);
    }
    table.append(tb);
    list.append(table);
    if (!selectedId && evts.length) { selectedId = evts[0].id; renderImpact(evts[0]); renderList(); }
  }

  // ---- impact table (event study) ----
  const HOR = [1, 7, 30];
  const median = (arr) => {
    const v = arr.filter((x) => x != null).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  };
  function impactRow(a, date) {
    return {
      price: HOR.map((k) => pctFrom(a.prices, "price", date, k)),
      mentions: pctFrom(a.mentions, "count", date, 7),
      volume: pctFrom(a.prices, "volume", date, 7),
    };
  }
  function renderImpact(e) {
    const card = document.getElementById("impact-card");
    card.hidden = false;
    document.getElementById("impact-title").textContent =
      `Impact — ${e.label} (${e.date})`;
    const host = document.getElementById("impact-table");
    host.innerHTML = "";
    const table = document.createElement("table");
    table.innerHTML = `<thead><tr><th style="text-align:left">Actif</th>
      <th>Prix +1j</th><th>Prix +7j</th><th>Prix +30j</th><th>Mentions +7j</th><th>Volume +7j</th></tr></thead>`;
    const tb = document.createElement("tbody");
    const cell = (v, strong = false) => {
      const cls = v == null ? "" : v >= 0 ? "up" : "down";
      return `<td class="${cls}${strong ? " j-strong" : ""}">${v == null ? "—" : fmtDelta(v)}</td>`;
    };
    const groups = [["memes", "Memecoins"], ["majors", "Majors"]];
    for (const [g, gLabel] of groups) {
      const rows = assets.filter((a) => a.group === g).map((a) => ({ a, r: impactRow(a, e.date) }));
      const med = {
        price: HOR.map((_, i) => median(rows.map(({ r }) => r.price[i]))),
        mentions: median(rows.map(({ r }) => r.mentions)),
        volume: median(rows.map(({ r }) => r.volume)),
      };
      const trM = document.createElement("tr");
      trM.className = "j-median";
      trM.innerHTML = `<td style="text-align:left"><b>${gLabel} — médiane</b></td>`
        + med.price.map((v) => cell(v, true)).join("") + cell(med.mentions, true) + cell(med.volume, true);
      tb.append(trM);
      for (const { a, r } of rows) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td style="text-align:left"><span class="j-dot" style="background:${colorOf(a.symbol)}"></span>${a.symbol}</td>`
          + r.price.map((v) => cell(v)).join("") + cell(r.mentions) + cell(r.volume);
        tb.append(tr);
      }
    }
    table.append(tb);
    host.append(table);
  }

  renderForm();
  renderList();
  renderChart();
}
boot();
