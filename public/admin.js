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
}
boot();
