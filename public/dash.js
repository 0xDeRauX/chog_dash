/* Mon Dash — the personal dashboard built from Studio views saved with the
   "💾 Enregistrer la vue" button. Each widget renders its saved config through
   the shared studio-core renderConfig on its own Lightweight Charts instance.
   Per-widget controls: width (half/full row), height (S/M/L), drag-to-reorder,
   rename, open-in-Studio, delete. Everything persists in localStorage. */

const LS_WIDGETS = "chog-dash-widgets-v1";
const HEIGHTS = ["s", "m", "l"];

function loadWidgets() {
  try { return JSON.parse(localStorage.getItem(LS_WIDGETS)) || []; } catch { return []; }
}
function saveWidgets(widgets) {
  localStorage.setItem(LS_WIDGETS, JSON.stringify(widgets));
}
// Saved widgets may predate the price-only-series model — migrate on read.
const cfgOf = (w) =>
  migrateCfg(structuredClone({ ...w.cfg, w: w.cfg.w === "max" ? Infinity : Number(w.cfg.w) || 365 }));

async function boot() {
  buildTopbar("mon dash");
  const data = await loadData();
  const bySym = Object.fromEntries(data.assets.map((a) => [a.symbol, a]));
  const metrics = METRICS.filter((m) => m.series);
  const mById = Object.fromEntries(metrics.map((m) => [m.id, m]));
  const ctx = { bySym, mById };

  const grid = document.getElementById("dash-grid");
  const panel = document.getElementById("preset-panel");
  const actions = document.getElementById("dash-actions");
  let widgets = loadWidgets();
  let charts = [];
  let dragIdx = null;

  const mkIco = (text, title, onClick, cls = "wg-btn") => {
    const b = document.createElement("button");
    b.className = cls;
    b.textContent = text;
    b.title = title;
    b.addEventListener("click", (ev) => { ev.stopPropagation(); onClick(ev); });
    return b;
  };
  const persistAnd = (fn) => { fn(); saveWidgets(widgets); render(); };
  const addPresets = (keys) => persistAnd(() => {
    for (const p of PRESETS) if (keys.includes(p.key)) widgets.push(widgetFromPreset(p));
    panel.hidden = true;
  });

  // ---- recommended-views panel ----
  function renderPanel() {
    panel.innerHTML = "";
    const head = document.createElement("div");
    head.className = "preset-head";
    head.innerHTML = "<b>Vues recommandées</b><span>Construites sur la méthode institutionnelle : contexte → pairs → signal → confirmation. Lis-les dans cet ordre.</span>";
    panel.append(head);
    const list = document.createElement("div");
    list.className = "preset-list";
    for (const p of PRESETS) {
      const card = document.createElement("div");
      card.className = "preset-card";
      const already = widgets.some((w) => w.preset === p.key);
      card.innerHTML = `<div class="preset-name">${p.name}</div><div class="preset-why">${p.why}</div>`;
      const btn = document.createElement("button");
      btn.className = "btn-ghost preset-add";
      btn.textContent = already ? "Déjà ajoutée — ajouter quand même" : "+ Ajouter";
      btn.addEventListener("click", () => addPresets([p.key]));
      card.append(btn);
      list.append(card);
    }
    panel.append(list);
    const all = document.createElement("button");
    all.className = "btn-ghost preset-all";
    all.textContent = "Tout ajouter (4 vues)";
    all.addEventListener("click", () => addPresets(PRESETS.map((p) => p.key)));
    panel.append(all);
  }
  function renderActions() {
    actions.innerHTML = "";
    const b = document.createElement("button");
    b.className = "btn-ghost";
    b.textContent = panel.hidden ? "✨ Vues recommandées" : "Fermer";
    b.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) renderPanel();
      renderActions();
    });
    actions.append(b);
    const ev = document.createElement("button");
    const showE = localStorage.getItem("chog-dash-showevents") !== "0";
    ev.className = "btn-ghost" + (showE ? " on" : "");
    ev.textContent = showE ? "🚩 Jalons ✓" : "🚩 Jalons";
    ev.title = "Afficher/masquer les jalons du Journal sur les widgets";
    ev.addEventListener("click", () => {
      localStorage.setItem("chog-dash-showevents", showE ? "0" : "1");
      renderActions();
      render();
    });
    actions.append(ev);
    const s = document.createElement("a");
    s.className = "btn-ghost";
    s.href = "studio.html";
    s.textContent = "Ouvrir le Studio →";
    s.style.textDecoration = "none";
    actions.append(s);
  }

  function render() {
    for (const c of charts) { try { c.remove(); } catch {} }
    charts = [];
    grid.innerHTML = "";

    if (!widgets.length) {
      const empty = document.createElement("div");
      empty.className = "dash-empty";
      empty.innerHTML = `<div class="dash-empty-ico">📊</div>
        <h2>Démarre avec les 4 vues recommandées</h2>
        <p>Contexte marché → CHOG vs ses pairs → le signal validé → confirmation on-chain.
        Ou compose la tienne dans le <b>Studio</b> et clique <span class="kbd-like">💾 Enregistrer la vue</span>.</p>`;
      const cta = document.createElement("button");
      cta.className = "btn-ghost dash-cta";
      cta.textContent = "✨ Ajouter les 4 vues recommandées";
      cta.addEventListener("click", () => addPresets(PRESETS.map((p) => p.key)));
      empty.append(cta);
      const alt = document.createElement("a");
      alt.className = "dash-alt";
      alt.href = "studio.html";
      alt.textContent = "ou ouvrir le Studio →";
      empty.append(alt);
      grid.append(empty);
      return;
    }

    widgets.forEach((w, i) => {
      const el = document.createElement("section");
      el.className = "widget" + (w.cols === 2 ? " w2" : "");

      // header: drag handle · name · summary · controls
      const head = document.createElement("div");
      head.className = "widget-head";
      head.draggable = true;
      head.addEventListener("dragstart", (ev) => {
        dragIdx = i;
        ev.dataTransfer.effectAllowed = "move";
        el.classList.add("dragging");
      });
      head.addEventListener("dragend", () => { dragIdx = null; el.classList.remove("dragging"); });
      el.addEventListener("dragover", (ev) => { ev.preventDefault(); el.classList.add("drop-target"); });
      el.addEventListener("dragleave", () => el.classList.remove("drop-target"));
      el.addEventListener("drop", (ev) => {
        ev.preventDefault();
        el.classList.remove("drop-target");
        if (dragIdx == null || dragIdx === i) return;
        persistAnd(() => {
          const [moved] = widgets.splice(dragIdx, 1);
          widgets.splice(i, 0, moved);
        });
      });

      const handle = document.createElement("span");
      handle.className = "drag-handle";
      handle.textContent = "⋮⋮";
      handle.title = "Glisser pour réordonner";
      const name = document.createElement("span");
      name.className = "widget-name";
      name.textContent = w.name;
      const meta = document.createElement("span");
      meta.className = "widget-meta";
      const cfg = cfgOf(w);
      meta.textContent = `${cfg.w === Infinity ? "Max" : cfg.w + "j"} · ${cfg.mode === "raw" ? "brut" : "base 100"}`;
      // Preset widgets carry their rationale as a ⓘ so the "why" survives.
      const pre = PRESETS.find((p) => p.key === w.preset);
      const why = pre ? helpIcon({ what: pre.why }, pre.name) : null;

      const tools = document.createElement("span");
      tools.className = "widget-tools";
      tools.append(mkIco(w.cols === 2 ? "◧" : "⬜", w.cols === 2 ? "Demi-largeur" : "Pleine largeur",
        () => persistAnd(() => { w.cols = w.cols === 2 ? 1 : 2; })));
      tools.append(mkIco((w.h || "m").toUpperCase(), "Hauteur : S → M → L",
        () => persistAnd(() => { w.h = HEIGHTS[(HEIGHTS.indexOf(w.h || "m") + 1) % HEIGHTS.length]; })));
      tools.append(mkIco("🚩", "Jalon propre à ce widget (date + libellé)", () => {
        const date = prompt("Date du jalon (YYYY-MM-DD) :", new Date().toISOString().slice(0, 10));
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
        const label = prompt("Libellé :");
        if (!label?.trim()) return;
        journalAdd({ date, label: label.trim(), cat: "projet", scope: w.id });
        render();
      }));
      tools.append(mkIco("✎", "Renommer", () => {
        const n = prompt("Nouveau nom :", w.name);
        if (n?.trim()) persistAnd(() => { w.name = n.trim().slice(0, 60); });
      }));
      tools.append(mkIco("⧉", "Ouvrir dans le Studio", () => {
        location.href = "studio.html?" + cfgToQuery(cfg);
      }));
      tools.append(mkIco("✕", "Supprimer le widget", () => {
        persistAnd(() => widgets.splice(i, 1));
      }, "wg-btn wg-del"));

      head.append(handle, name, meta);
      if (why) head.append(why);
      head.append(tools);
      el.append(head);

      // chart
      const body = document.createElement("div");
      body.className = "widget-chart h-" + (w.h || "m");
      el.append(body);

      // compact legend chips
      const chips = document.createElement("div");
      chips.className = "widget-chips";
      el.append(chips);

      grid.append(el);

      const chart = LightweightCharts.createChart(body, studioChartOptions());
      charts.push(chart);
      const res = renderConfig(chart, cfg, ctx, { paneHeight: 80 });
      // journal milestones: global ones + those scoped to this widget
      if (localStorage.getItem("chog-dash-showevents") !== "0" && res.anchorSeries && cfg.series[0]) {
        const evts = journalEvents(w.id);
        if (evts.length) {
          const pts0 = seriesPts(bySym[cfg.series[0].sym], mById.price, cfg.w, cfg.mode === "index");
          applyEventMarkers(res.anchorSeries, pts0, evts);
        }
      }
      for (const it of res.items.slice(0, 6)) {
        const chip = document.createElement("span");
        chip.className = "wchip" + (it.struck ? " off" : "");
        chip.innerHTML = `<span class="fl-dot" style="background:${it.color}"></span>${it.label}`;
        chips.append(chip);
      }
      if (res.items.length > 6) {
        const more = document.createElement("span");
        more.className = "wchip";
        more.textContent = "+" + (res.items.length - 6);
        chips.append(more);
      }
    });
  }

  renderActions();
  render();
}
boot();
