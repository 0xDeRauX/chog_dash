/* Chain Radar — full leaderboard (top 50 pools/chain) ranked by a rank-based
   composite built from our measured evidence (étude déclencheurs):
     buy pressure 35 · sustained activity 20 · slow momentum 15 · Δholders 15 ·
     liquidity 10 · maturity 5 — × post-pump malus, volatility-scaled (moves
     are judged against the token's OWN median daily move; fading fresh pumps
     measured −9% avg the week after on our config memes).
   Off-criteria tokens (liquidity under the chain floor, <50 holders) are kept
   but hidden by default — a toggle reveals them, greyed, with the reason.
   Clicking a row opens the token page (radar-token.html) with toggleable
   indicator charts and a "open in Studio" hand-off. */

const W = { pressure: 35, activity: 20, momentum: 15, holders: 15, liq: 10, age: 5 };
const SCORE_HELP = {
  what: "Classement composite <b>par rangs</b> (méthode AQR) : pression d'achat 35 · activité soutenue 20 · momentum lent 15 · Δholders 15 · liquidité 10 · maturité 5 — <b>× malus post-pompe ajusté à la volatilité</b> (÷2 si un jour récent dépasse 4× le mouvement médian du token, plancher +50%).",
  read: "Le Radar cherche ce qui <b>se met en place</b> (achat + activité qui montent, prix calme) et pénalise ce qui vient d'exploser — l'inverse des listes « trending ». Les hors-critères ne sont pas notés.",
  example: "Un token à 58% de pression d'achat, volume 7j en hausse et prix stable score haut ; un +2 400% d'hier score bas malgré son volume.",
  quality: "⏳ Score <b>descriptif</b> : son pouvoir prédictif (IC) sera mesurable après ~30 jours d'historique radar, comme nos autres signaux.",
};
const CRIT_LABEL = {
  liq: "liquidité sous le plancher de la chaîne",
  holders: "moins de 50 holders",
  "liq+holders": "liquidité sous le plancher + moins de 50 holders",
};

const median = (arr) => {
  const v = arr.filter((x) => x != null).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};
const lastN = (series, key, n) => series.slice(-n).map((p) => p[key]).filter((v) => v != null);

function tokenFeatures(t) {
  const s = t.series;
  const last = s.at(-1) || {};
  const ageDays = t.age ? Math.max(0, Math.round((Date.now() - new Date(t.age)) / 864e5)) : null;
  const r3 = median(lastN(s, "ratio", 3));
  const pressure = last.ratio != null ? (r3 != null ? (last.ratio + r3) / 2 : last.ratio) : null;
  const v7 = median(lastN(s, "vol", 7));
  const v30 = median(lastN(s, "vol", 30));
  const activity = v7 != null && v30 ? v7 / v30 : null;
  let momentum = null;
  if (s.length >= 4) {
    const past = s[Math.max(0, s.length - 9)]?.price;
    const ref = s[s.length - 3]?.price;
    if (past > 0 && ref != null) momentum = ref / past - 1;
  }
  let dHold = null;
  const h = lastN(s, "holders", 8);
  if (h.length >= 2 && h[0] > 0) dHold = h.at(-1) / h[0] - 1;
  // Post-pump malus, VOLATILITY-SCALED. A fixed +15% over-fires on micro-caps
  // whose normal day is ±30-100% (standard pro practice: flag moves in units
  // of the asset's own vol, like CTA/momentum desks and short-term-reversal
  // research — Jegadeesh 1990). Threshold = 4× the token's median |Δ24h|
  // (needs ≥5 days of history), floored at +50%/jour while history is short.
  const absMoves = s.map((p) => p.d24).filter((v) => v != null).map(Math.abs);
  const medMove = absMoves.length >= 5 ? median(absMoves) : null;
  const pumpThr = Math.max(50, medMove != null ? 4 * medMove : 0);
  const pumped = lastN(s, "d24", 3).some((v) => v >= pumpThr);
  const extreme = last.ratio != null && (last.ratio >= 85 || last.ratio <= 15);
  return { last, ageDays, pressure, activity, momentum, dHold, pumped, extreme, volToday: last.vol };
}
function rankScore(values) {
  const idx = values.map((v, i) => [v, i]).filter(([v]) => v != null).sort((a, b) => a[0] - b[0]);
  const out = values.map(() => null);
  idx.forEach(([, i], pos) => { out[i] = idx.length > 1 ? pos / (idx.length - 1) : 0.5; });
  return out;
}
// Score only tokens that meet the criteria — off-criteria rows would drag the
// rank distribution and get meaningless scores of their own.
function computeScores(tokens) {
  const withF = tokens.map((t) => ({ ...t, f: tokenFeatures(t), score: null }));
  const scored = withF.filter((t) => !t.crit);
  const F = scored.map((t) => t.f);
  const ranks = {
    pressure: rankScore(F.map((f) => f.pressure)),
    activity: rankScore(F.map((f) => f.activity ?? f.volToday)),
    momentum: rankScore(F.map((f) => f.momentum)),
    holders: rankScore(F.map((f) => f.dHold)),
    liq: rankScore(F.map((f) => f.last.liq)),
    age: rankScore(F.map((f) => f.ageDays)),
  };
  scored.forEach((t, i) => {
    let wsum = 0, score = 0;
    for (const [k, w] of Object.entries(W)) {
      if (ranks[k][i] != null) { score += ranks[k][i] * w; wsum += w; }
    }
    let s = wsum > 0 ? (score / wsum) * 100 : null;
    if (s != null && t.f.pumped) s *= 0.5;
    t.score = s == null ? null : Math.round(s);
  });
  return withF;
}

// sortable column definitions: [key, label, value(tok), format(v), align?]
const COLS = [
  ["score", "Score", (t) => t.score, (v) => `<b>${v ?? "—"}</b>`],
  ["price", "Prix", (t) => t.series.at(-1)?.price, (v) => fmtPrice(v)],
  ["d24", "Δ24h", (t) => t.f.last.d24, (v) => v == null ? "—" : fmtDelta(v), (v) => v == null ? "" : v >= 0 ? "up" : "down"],
  ["mcap", "Market cap", (t) => t.f.last.fdv, (v) => fmtUsdCompact(v)],
  ["vol", "Volume 24h", (t) => t.f.last.vol, (v) => fmtUsdCompact(v)],
  ["ratio", "Pression achat", (t) => t.f.last.ratio, (v) => v == null ? "—" : v.toFixed(0) + "%", (v) => v == null ? "" : v >= 55 ? "up" : v <= 45 ? "down" : ""],
  ["liq", "Liquidité", (t) => t.f.last.liq, (v) => fmtUsdCompact(v)],
  ["holders", "Holders", (t) => t.f.last.holders, (v) => v == null ? "—" : fmtCompact(v)],
  ["tg", "Telegram", (t) => t.series.at(-1)?.tg, (v) => v == null ? "—" : fmtCompact(v)],
  ["dc", "Discord", (t) => t.series.at(-1)?.dc, (v) => v == null ? "—" : fmtCompact(v)],
  ["mentions", "Mentions X", (t) => t.mentions?.at(-1)?.count, (v) => v == null ? "—" : fmtCompact(v)],
  ["div", "Divergence", (t) => t.divLast, (v) => v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2), (v) => v == null ? "" : v >= 1 ? "up" : v <= -1 ? "down" : ""],
  ["age", "Âge", (t) => t.f.ageDays, (v) => v == null ? "—" : v + "j"],
];

async function boot() {
  buildTopbar("radar");
  const data = await loadData();
  const radar = data.radar || {};
  const chains = Object.keys(radar);
  document.getElementById("radar-meta").textContent =
    "Dernière découverte : " + new Date(data.generatedAt).toLocaleString("fr-FR") +
    " · " + chains.map((c) => `${c} (${radar[c].length})`).join(" · ");

  // Divergence attention/prix par token, calculée ici même dès que le token a
  // ~11 jours communs de mentions + prix (backfills compris).
  for (const c of chains) {
    for (const t of radar[c] || []) {
      if ((t.mentions || []).length < 11 || t.series.length < 11) continue;
      const mz = zScoreByDate(t.mentions, "count");
      const pz = zScoreByDate(t.series.filter((p) => p.price != null).map((p) => ({ date: p.date, price: p.price })), "price");
      let lastDate = null, lastVal = null;
      for (const [d, m] of mz) {
        if (pz.has(d) && (lastDate == null || d > lastDate)) { lastDate = d; lastVal = m - pz.get(d); }
      }
      t.divLast = lastVal;
    }
  }

  let current = chains.includes("robinhood") ? "robinhood" : chains[0];
  let sortKey = "score", sortDir = -1;
  let showAll = false;
  let expanded = false;

  const tabs = document.getElementById("radar-tabs");
  function renderTabs() {
    tabs.innerHTML = "";
    const seg = document.createElement("div");
    seg.className = "segmented";
    for (const c of chains) {
      const b = document.createElement("button");
      b.textContent = c.charAt(0).toUpperCase() + c.slice(1);
      b.className = c === current ? "on" : "";
      b.addEventListener("click", () => { current = c; renderTabs(); renderTable(); });
      seg.append(b);
    }
    tabs.append(seg);
    const exp = document.createElement("button");
    exp.className = "wchip" + (expanded ? "" : " off");
    exp.textContent = expanded ? "⛶ Réduire le tableau" : "⛶ Étendre le tableau";
    exp.addEventListener("click", () => {
      expanded = !expanded;
      host.classList.toggle("expanded", expanded);
      renderTabs();
    });
    tabs.append(exp);
    // off-criteria visibility toggle
    const all = computeScores(radar[current] || []);
    const nOff = all.filter((t) => t.crit).length;
    if (nOff) {
      const tog = document.createElement("button");
      tog.className = "wchip" + (showAll ? "" : " off");
      tog.textContent = (showAll ? "Masquer" : "Afficher") + ` les hors-critères (${nOff})`;
      tog.addEventListener("click", () => { showAll = !showAll; renderTabs(); renderTable(); });
      tabs.append(tog);
    }
  }

  const host = document.getElementById("radar-table");
  function renderTable() {
    let toks = computeScores(radar[current] || []);
    if (!showAll) toks = toks.filter((t) => !t.crit);
    const sortCol = COLS.find(([k]) => k === sortKey);
    toks.sort((a, b) => {
      const pin = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      if (pin) return pin;
      const off = (a.crit ? 1 : 0) - (b.crit ? 1 : 0); // off-criteria sink to the bottom
      if (off) return off;
      const va = sortCol[2](a), vb = sortCol[2](b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * sortDir;
    });
    const table = document.createElement("table");
    table.className = "screener-table";
    const head = document.createElement("thead");
    const hr = document.createElement("tr");
    const th0 = document.createElement("th");
    th0.textContent = "#";
    const th1 = document.createElement("th");
    th1.style.textAlign = "left";
    th1.textContent = "Token";
    hr.append(th0, th1);
    for (const [key, label] of COLS) {
      const th = document.createElement("th");
      th.className = "sortable" + (key === sortKey ? " active" : "");
      th.innerHTML = label + (key === sortKey ? `<span class="sort-arrow">${sortDir < 0 ? " ↓" : " ↑"}</span>` : "");
      if (key === "score") {
        const ico = helpIcon(SCORE_HELP, "Score Radar");
        if (ico) { ico.addEventListener("click", (ev) => ev.stopPropagation()); th.append(ico); }
      }
      th.addEventListener("click", () => {
        if (sortKey === key) sortDir = -sortDir; else { sortKey = key; sortDir = -1; }
        renderTable();
      });
      hr.append(th);
    }
    head.append(hr);
    const tb = document.createElement("tbody");
    toks.forEach((t, i) => {
      const f = t.f;
      const tr = document.createElement("tr");
      tr.className = "screener-row" + (t.crit ? " radar-off" : "");
      const badges = [
        t.pinned ? "📌" : "",
        t.crit ? `<span title='Hors critères : ${CRIT_LABEL[t.crit] || t.crit}'>🚷</span>` : "",
        f.pumped ? "<span title='Pompe récente au-delà de 4× sa volatilité normale — malus appliqué'>🚫</span>" : "",
        f.extreme ? "<span title='Ratio achats/ventes extrême — manipulation possible'>⚠️</span>" : "",
        (f.ageDays != null && f.ageDays <= 3) ? "<span title='Pool de moins de 3 jours'>🐣</span>" : "",
      ].filter(Boolean).join(" ");
      let cells = `<td class="rank">${t.crit ? "·" : i + 1}</td>
        <td style="text-align:left"><span class="asset-cell"><span class="asset-sym">${t.symbol}</span> ${badges}</span></td>`;
      for (const [, , val, fmt, cls] of COLS) {
        const v = val(t);
        cells += `<td class="${cls ? cls(v) : ""}">${fmt(v)}</td>`;
      }
      tr.innerHTML = cells;
      tr.addEventListener("click", () =>
        location.assign(`radar-token.html?chain=${current}&addr=${t.address}`));
      tb.append(tr);
    });
    table.append(head, tb);
    host.innerHTML = "";
    host.append(table);
  }

  const promoEl = document.getElementById("radar-promoted");
  const trackedKeys = new Set((data.radarTracked || []).map((t) => t.chain + ":" + t.address));
  const trackedToks = chains.flatMap((c) => (radar[c] || [])
    .filter((t) => trackedKeys.has(c + ":" + t.address)).map((t) => ({ ...t, chain: c })));
  const shared = chains.flatMap((c) => (radar[c] || []).filter((t) => t.mentionsShared).map((t) => t.symbol));
  promoEl.innerHTML =
    (shared.length ? `<p class="card-sub">Mentions <b>mutualisées</b> avec le suivi principal (déjà payées) : ${shared.map((s) => "$" + s).join(", ")}.</p>` : "") +
    (trackedToks.length
      ? trackedToks.map((t) => `<span class="wchip">$${t.symbol} · ${t.chain} · ${(t.mentions || []).length}j de mentions</span>`).join(" ")
      : '<p class="card-sub">Aucun token suivi pour l\'instant — activation manuelle depuis la page <a href="admin.html">Admin</a> (~$0.15/mois par token).</p>');

  renderTabs();
  renderTable();
}
boot();
