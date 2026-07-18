/* Admin — data-supervision view. For every asset × metric family, shows how
   stale the latest point is (lag in days). Normal operation = lag ≤ 1 (daily
   collectors write yesterday's completed day). A whole column going orange/red
   means a collector or a source broke — catch it here, not weeks later in a
   distorted chart. Empty series are split from stale ones: most are structural
   (no free source / no channel), the rest are flagged for investigation. */

const FAMS = [
  { id: "prices", label: "Prix/Vol", last: (a) => a.prices?.at(-1)?.date },
  { id: "mentions", label: "Mentions", last: (a) => a.mentions?.at(-1)?.date },
  { id: "tvl", label: "TVL", last: (a, d) => (d.tvlByChain[a.chain] || []).at(-1)?.date },
  { id: "discord", label: "Discord", last: (a) => a.discord?.at(-1)?.date },
  { id: "telegram", label: "Telegram", last: (a) => a.telegram?.at(-1)?.date },
  { id: "holders", label: "Holders", last: (a) => a.holders?.at(-1)?.date },
  { id: "tiers", label: "Tranches $", last: (a) => a.holderTiers?.at(-1)?.date },
  { id: "tradeflow", label: "Achat/Vente", last: (a) => a.tradeflow?.at(-1)?.date },
  { id: "flows", label: "Flux ledger", last: (a) => a.holderFlows?.at(-1)?.date },
];

// Known structural absences — an empty series here is EXPECTED, not a bug.
function structuralReason(a, famId) {
  const sym = a.symbol;
  const TIER_OK = ["CHOG", "WIF", "BONK", "PENGU", "FARTCOIN", "ANSEM"];
  if (famId === "tvl" && a.chain === "akash") return "réseau DePIN — pas de TVL DeFi";
  if (famId === "holders" && ["SOL", "MON", "STRK"].includes(sym)) return "pas de source gratuite (SOL flou · MON trop récent · STRK payant)";
  if (famId === "tiers" && !TIER_OK.includes(sym)) return "nécessite le scan complet des soldes (CHOG + memes Solana uniquement)";
  if (famId === "flows" && sym !== "CHOG") return "grand livre CHOG uniquement";
  if (famId === "discord") return "pas de serveur Discord officiel connu";
  if (famId === "telegram") return "pas de canal Telegram référencé (CoinGecko)";
  return null;
}

async function boot() {
  buildTopbar("admin");
  const data = await loadData();
  const today = new Date().toISOString().slice(0, 10);
  const lagOf = (dateStr) => dateStr
    ? Math.round((new Date(today + "T00:00:00Z") - new Date(dateStr + "T00:00:00Z")) / 864e5)
    : null;

  // meta line: freshness of the build itself
  const genAge = Math.round((Date.now() - new Date(data.generatedAt).getTime()) / 36e5);
  document.getElementById("admin-meta").textContent =
    `data.json généré le ${data.generatedAt.slice(0, 16).replace("T", " à ")} (il y a ${genAge}h)` +
    (genAge > 30 ? " ⚠️ build vieux de plus de 30h — le CI a-t-il tourné ?" : " ✓");

  // ---- scan every asset × family ----
  const cells = []; // { sym, fam, lag|null, reason|null }
  for (const a of data.assets) {
    for (const fam of FAMS) {
      const last = fam.last(a, data);
      cells.push({
        sym: a.symbol, fam: fam.id,
        lag: last ? lagOf(last) : null,
        last,
        reason: last ? null : structuralReason(a, fam.id),
      });
    }
  }
  const active = cells.filter((c) => c.lag != null);
  const fresh = active.filter((c) => c.lag <= 1).length;
  const warn = active.filter((c) => c.lag === 2).length;
  const late = active.filter((c) => c.lag >= 3).length;
  const structural = cells.filter((c) => c.lag == null && c.reason).length;
  const unknown = cells.filter((c) => c.lag == null && !c.reason);

  // ---- tiles ----
  const tiles = document.getElementById("admin-tiles");
  const tile = (label, value, cls = "", sub = "") => {
    const el = document.createElement("div");
    el.className = "tile";
    el.innerHTML = `<div class="tile-top"><span class="tile-sym">${label}</span></div>
      <div class="tile-value ${cls}">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ""}`;
    tiles.append(el);
  };
  const pct = active.length ? Math.round((fresh / active.length) * 100) : 0;
  tile("Séries à jour (≤1j)", pct + "%", pct >= 95 ? "up" : pct >= 80 ? "" : "down", `${fresh}/${active.length} séries actives`);
  tile("En retard de 2j", String(warn), warn ? "down" : "up");
  tile("En retard ≥3j", String(late), late ? "down" : "up");
  tile("Vides structurelles", String(structural), "", "absences documentées");
  tile("⚠️ À investiguer", String(unknown.length), unknown.length ? "down" : "up", unknown.length ? "séries vides inexpliquées" : "rien d'anormal");

  // ---- matrix ----
  const host = document.getElementById("admin-matrix");
  const table = document.createElement("table");
  table.innerHTML = `<thead><tr><th style="text-align:left">Actif</th>${FAMS.map((f) => `<th>${f.label}</th>`).join("")}</tr></thead>`;
  const tb = document.createElement("tbody");
  // per-family median lag row first (a whole broken collector jumps out here)
  const medRow = document.createElement("tr");
  medRow.className = "j-median";
  const med = (famId) => {
    const v = active.filter((c) => c.fam === famId).map((c) => c.lag).sort((x, y) => x - y);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  };
  medRow.innerHTML = `<td style="text-align:left"><b>Médiane (collecteur)</b></td>` + FAMS.map((f) => {
    const m = med(f.id);
    const cls = m == null ? "" : m <= 1 ? "up" : m === 2 ? "adm-warn" : "down";
    return `<td class="${cls}"><b>${m == null ? "—" : m + "j"}</b></td>`;
  }).join("");
  tb.append(medRow);
  for (const a of data.assets) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td style="text-align:left"><span class="j-dot" style="background:${colorOf(a.symbol)}"></span>${a.symbol}</td>`
      + FAMS.map((f) => {
        const c = cells.find((x) => x.sym === a.symbol && x.fam === f.id);
        if (c.lag == null) {
          return `<td class="adm-empty" title="${c.reason || "série vide — à investiguer"}">${c.reason ? "∅" : "⚠️"}</td>`;
        }
        const cls = c.lag <= 1 ? "up" : c.lag === 2 ? "adm-warn" : "down";
        return `<td class="${cls}" title="dernier point : ${c.last}">${c.lag}j</td>`;
      }).join("");
    tb.append(tr);
  }
  table.append(tb);
  host.append(table);

  // ---- gaps section ----
  const gaps = document.getElementById("admin-gaps");
  const mk = (title, list, cls) => {
    if (!list.length) return;
    const el = document.createElement("div");
    el.className = "adm-gap-block";
    el.innerHTML = `<b class="${cls}">${title}</b>` +
      `<ul>${list.map((c) => `<li><b>${c.sym}</b> · ${FAMS.find((f) => f.id === c.fam).label}${c.reason ? ` — <span class="dim">${c.reason}</span>` : ""}</li>`).join("")}</ul>`;
    gaps.append(el);
  };
  mk("⚠️ Séries vides inexpliquées — à investiguer en priorité", unknown, "down");
  mk("∅ Absences structurelles (documentées)", cells.filter((c) => c.lag == null && c.reason), "dim");
  if (!unknown.length && !structural) gaps.innerHTML = '<p class="card-sub">Aucune série vide.</p>';

  buildCollectPanel(data);
}

/* ---- manual collection: dispatches the collect-manual GitHub workflow ----
   The static site can't run collectors itself (no runtime, secret API keys) —
   the professional pattern is remote-triggering CI: a fine-grained GitHub
   token (stored ONLY in this browser's localStorage) calls the REST API to
   dispatch the workflow, then polls the run status live. */
const GH_REPO = "0xDeRauX/chog_dash";
const GH_WORKFLOW = "collect-manual.yml";
const PAT_KEY = "chog-gh-pat";
const COLLECTORS = [
  ["radar", "Radar (découverte)"], ["mentions", "Mentions X (3 derniers j) 💰"],
  ["prices", "Prix"], ["tvl", "TVL"], ["discord", "Discord"],
  ["telegram", "Telegram"], ["holders", "Holders"], ["tradeflow", "Achat/Vente"],
];
// User rule: no mention backfill where mentions predate the token's creation
// (the cashtag existed before the coin → old counts are unrelated noise).
const NO_BACKFILL = new Set(["CHOG", "ANSEM"]);

function ghHeaders() {
  return {
    Authorization: `Bearer ${localStorage.getItem(PAT_KEY) || ""}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function buildCollectPanel(data) {
  const host = document.getElementById("admin-collect");
  if (!host) return;
  host.innerHTML = `
    <div class="adm-collect-token">
      <label>Token GitHub <span class="dim">(fine-grained, repo ${GH_REPO}, permission « Actions : Read and write » — stocké uniquement dans ce navigateur)</span></label>
      <div class="adm-token-row">
        <input type="password" id="gh-pat" placeholder="github_pat_…" autocomplete="off" />
        <button class="btn-ghost" id="gh-pat-save">Enregistrer</button>
      </div>
    </div>
    <div class="adm-collect-grid">
      <div class="adm-collect-block">
        <h3>Relancer des collecteurs</h3>
        <p class="card-sub">Coche ce qui a raté la veille (matrice ci-dessus) — l'ingestion upserte, donc relancer répare sans dupliquer.</p>
        <div id="adm-colls" class="adm-chips"></div>
        <p class="card-sub" id="adm-colls-cost"></p>
        <button class="btn-primary" id="adm-run-colls">Lancer la collecte</button>
      </div>
      <div class="adm-collect-block">
        <h3>Suivi mentions X — tokens radar</h3>
        <p class="card-sub">Active/désactive le comptage quotidien du cashtag d'un token radar (~$0.15/mois par token, ~$0.005/jour). Rien n'est automatique : cette liste est la seule source du suivi. Le backfill de <b>prix</b> (GeckoTerminal) est gratuit et rend la Divergence calculable dès que les mentions existent.</p>
        <div id="adm-tracked" class="adm-chips"></div>
        <div class="adm-backfill-row">
          <label>Ajouter <select id="adm-track-add" multiple size="5"></select></label>
        </div>
        <p class="card-sub" id="adm-track-cost"></p>
        <button class="btn-primary" id="adm-run-track">Activer le suivi</button>
        <button class="btn-ghost" id="adm-run-phist">Backfill prix (gratuit)</button>
        <p class="card-sub">« Backfill prix » ne modifie <b>pas</b> la liste de suivi : il ne récupère que l'historique de prix (gratuit) des tokens sélectionnés — utile pour explorer leurs graphes avant de décider de payer le suivi des mentions. « Activer le suivi » lance les deux.</p>
      </div>
      <div class="adm-collect-block">
        <h3>Backfill mentions X <span class="dim">💰 payant</span></h3>
        <p class="card-sub">Récupère l'historique des mentions sur N jours (X counts/all : $0.01 par tranche de 31j par actif). CHOG et ANSEM sont exclus — leurs cashtags existaient avant le token (règle d'intégrité).</p>
        <div class="adm-backfill-row">
          <label>Jours <input type="number" id="adm-bf-days" value="30" min="1" max="1500" /></label>
          <label>Actifs <select id="adm-bf-syms" multiple size="6"></select></label>
        </div>
        <p class="card-sub" id="adm-bf-cost"></p>
        <button class="btn-primary" id="adm-run-bf">Lancer le backfill</button>
      </div>
    </div>
    <div id="adm-run-status"></div>`;

  // token field
  const patInput = host.querySelector("#gh-pat");
  if (localStorage.getItem(PAT_KEY)) patInput.placeholder = "•••••••• (token enregistré)";
  host.querySelector("#gh-pat-save").addEventListener("click", () => {
    if (patInput.value.trim()) {
      localStorage.setItem(PAT_KEY, patInput.value.trim());
      patInput.value = "";
      patInput.placeholder = "•••••••• (token enregistré)";
      status("Token enregistré dans ce navigateur.", "");
    }
  });

  // collector chips + live cost (only X mentions cost money: 1 requête
  // $0.005 par actif config + par token radar suivi, à chaque exécution)
  const colls = host.querySelector("#adm-colls");
  const collsCost = host.querySelector("#adm-colls-cost");
  const nTracked = (data.radarTracked || []).length;
  const selected = new Set();
  const updateCollsCost = () => {
    if (!selected.size) { collsCost.textContent = "Coût : — (rien de coché)"; return; }
    if (selected.has("mentions")) {
      const n = data.assets.length + nTracked;
      collsCost.textContent = `Coût de cette exécution : mentions ${data.assets.length} actifs config + ${nTracked} radar suivis × $0.005 = ~$${(n * 0.005).toFixed(2)} — le reste est gratuit.`;
    } else {
      collsCost.textContent = "Coût de cette exécution : $0 — collecteurs 100% gratuits.";
    }
  };
  for (const [id, label] of COLLECTORS) {
    const b = document.createElement("button");
    b.className = "wchip off";
    b.textContent = label;
    b.addEventListener("click", () => {
      selected.has(id) ? selected.delete(id) : selected.add(id);
      b.classList.toggle("off");
      updateCollsCost();
    });
    colls.append(b);
  }
  updateCollsCost();

  // ---- mention-tracking management (the ONLY path that changes the list) --
  const trackedEl = host.querySelector("#adm-tracked");
  const tracked = data.radarTracked || [];
  const untrackSel = new Set();
  if (!tracked.length) {
    trackedEl.innerHTML = '<span class="dim" style="font-size:12px">Aucun token suivi.</span>';
  }
  for (const t of tracked) {
    const b = document.createElement("button");
    b.className = "wchip";
    b.title = "Cliquer pour marquer à désactiver";
    b.textContent = `$${t.symbol} · ${t.chain}`;
    b.addEventListener("click", () => {
      const key = `${t.chain}:${t.address}`;
      untrackSel.has(key) ? untrackSel.delete(key) : untrackSel.add(key);
      b.classList.toggle("off");
      b.textContent = (untrackSel.has(key) ? "✕ " : "") + `$${t.symbol} · ${t.chain}`;
      updateTrackCost();
    });
    trackedEl.append(b);
  }
  const trackAddSel = host.querySelector("#adm-track-add");
  const trackedKeys = new Set(tracked.map((t) => `${t.chain}:${t.address}`));
  for (const [chain, toks] of Object.entries(data.radar || {})) {
    const og = document.createElement("optgroup");
    og.label = "Radar · " + chain;
    for (const t of toks) {
      const key = `${chain}:${t.address}`;
      if (trackedKeys.has(key) || t.mentionsShared || !/^[A-Z0-9]{3,12}$/.test(t.symbol)) continue;
      og.append(new Option(`$${t.symbol}${t.crit ? " 🚷" : ""}`, key));
    }
    if (og.children.length) trackAddSel.append(og);
  }
  const trackCostEl = host.querySelector("#adm-track-cost");
  const updateTrackCost = () => {
    const nAdd = [...trackAddSel.selectedOptions].length;
    const parts = [];
    if (nAdd) parts.push(`+${nAdd} suivi(s) = ~$${(nAdd * 0.15).toFixed(2)}/mois de plus`);
    if (untrackSel.size) parts.push(`−${untrackSel.size} désactivation(s)`);
    const total = (tracked.length + nAdd - untrackSel.size) * 0.15;
    trackCostEl.textContent = (parts.length ? parts.join(" · ") + " → " : "")
      + `coût récurrent après application : ~$${Math.max(0, total).toFixed(2)}/mois (${Math.max(0, tracked.length + nAdd - untrackSel.size)} token(s)).`;
  };
  trackAddSel.addEventListener("change", updateTrackCost);
  updateTrackCost();

  // backfill asset select: config assets + eligible radar tokens (chain:addr)
  const sel = host.querySelector("#adm-bf-syms");
  const ogC = document.createElement("optgroup");
  ogC.label = "Actifs suivis";
  for (const a of data.assets) {
    if (NO_BACKFILL.has(a.symbol)) continue;
    ogC.append(new Option(a.symbol, a.symbol));
  }
  sel.append(ogC);
  for (const [chain, toks] of Object.entries(data.radar || {})) {
    const og = document.createElement("optgroup");
    og.label = "Radar · " + chain;
    for (const t of toks.filter((x) => !x.crit && !x.mentionsShared)) {
      og.append(new Option(`$${t.symbol}`, `${chain}:${t.address}`));
    }
    if (og.children.length) sel.append(og);
  }
  const daysEl = host.querySelector("#adm-bf-days");
  const costEl = host.querySelector("#adm-bf-cost");
  const updateCost = () => {
    const n = [...sel.selectedOptions].length;
    const days = Number(daysEl.value) || 0;
    const cost = n * Math.ceil(days / 31) * 0.01;
    costEl.textContent = n
      ? `Coût estimé : ${n} actif(s) × ${Math.ceil(days / 31)} req = ~$${cost.toFixed(2)}`
      : "Sélectionne au moins un actif (Ctrl+clic pour multi-sélection).";
  };
  sel.addEventListener("change", updateCost);
  daysEl.addEventListener("input", updateCost);
  updateCost();

  const statusEl = host.querySelector("#adm-run-status");
  function status(msg, cls) {
    statusEl.innerHTML = `<p class="adm-run-msg ${cls}">${msg}</p>`;
  }

  async function dispatch(inputs, what) {
    if (!localStorage.getItem(PAT_KEY)) return status("⚠️ Enregistre d'abord un token GitHub.", "down");
    status(`Déclenchement (${what})…`, "");
    const res = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/dispatches`, {
      method: "POST", headers: ghHeaders(),
      body: JSON.stringify({ ref: "main", inputs }),
    });
    if (res.status !== 204) {
      const body = await res.text();
      return status(`❌ Échec du déclenchement (HTTP ${res.status}) — token invalide/expiré, ou le workflow n'est pas encore poussé sur main. ${body.slice(0, 140)}`, "down");
    }
    status("✅ Workflow déclenché — démarrage…", "up");
    setTimeout(poll, 6000);
  }

  let pollTimer = null;
  async function poll() {
    clearTimeout(pollTimer);
    try {
      const res = await fetch(
        `https://api.github.com/repos/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/runs?per_page=1`,
        { headers: ghHeaders() });
      const run = (await res.json()).workflow_runs?.[0];
      if (!run) return status("Run introuvable — vérifie l'onglet Actions du repo.", "down");
      const link = `<a href="${run.html_url}" target="_blank" rel="noopener">voir le run ↗</a>`;
      if (run.status !== "completed") {
        status(`⏳ Run en cours (${run.status}) — ${link}`, "");
        pollTimer = setTimeout(poll, 10000);
      } else if (run.conclusion === "success") {
        status(`✅ Terminé avec succès — data.json déployé. <button class="btn-ghost" onclick="location.reload()">Recharger les données</button> · ${link}`, "up");
      } else {
        status(`❌ Run terminé en « ${run.conclusion} » — ${link}`, "down");
      }
    } catch (e) {
      status("❌ Erreur de suivi : " + e.message, "down");
    }
  }

  host.querySelector("#adm-run-colls").addEventListener("click", () => {
    if (!selected.size) return status("⚠️ Coche au moins un collecteur.", "down");
    dispatch({ collectors: [...selected].join(","), mentions_days: "0", mentions_symbols: "" },
      "collecteurs : " + [...selected].join(", "));
  });
  host.querySelector("#adm-run-track").addEventListener("click", () => {
    const add = [...trackAddSel.selectedOptions].map((o) => o.value);
    if (!add.length && !untrackSel.size) return status("⚠️ Sélectionne des tokens à activer et/ou à désactiver.", "down");
    if (add.length && !confirm(`Activer le suivi de ${add.length} token(s) ≈ +$${(add.length * 0.15).toFixed(2)}/mois. Confirmer ?`)) return;
    dispatch({ collectors: "none", track: add.join(","), untrack: [...untrackSel].join(","), price_history: add.join(",") },
      "suivi mentions : " + (add.length ? "+" + add.length : "") + (untrackSel.size ? " −" + untrackSel.size : ""));
  });
  host.querySelector("#adm-run-phist").addEventListener("click", () => {
    const sel2 = [...trackAddSel.selectedOptions].map((o) => o.value);
    const target = sel2.length ? sel2.join(",") : "tracked";
    dispatch({ collectors: "none", price_history: target },
      "backfill prix (gratuit) : " + (sel2.length ? sel2.length + " token(s)" : "tous les suivis"));
  });
  host.querySelector("#adm-run-bf").addEventListener("click", () => {
    const syms = [...sel.selectedOptions].map((o) => o.value);
    const days = Number(daysEl.value) || 0;
    if (!syms.length || !days) return status("⚠️ Choisis des actifs et un nombre de jours.", "down");
    const cost = (syms.length * Math.ceil(days / 31) * 0.01).toFixed(2);
    if (!confirm(`Backfill ${days}j × ${syms.length} actif(s) ≈ $${cost} (facturé sur l'API X). Confirmer ?`)) return;
    dispatch({ collectors: "none", mentions_days: String(days), mentions_symbols: syms.join(",") },
      `backfill mentions ${days}j`);
  });
}
boot();
