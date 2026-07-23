/* Trader view — the "what do I do today" home for an investor. One card per
   asset: price, live verdict badge (assetVerdict), the firing signals, and a
   gauge per signal showing where it sits vs its overheating zones. Cards sort
   by conviction (accumulation setups first). Click → asset detail. */

const GROUP_ORDER = { memes: 0, majors: 1 };
const VERDICT_ORDER = { accumulation: 0, neutre: 1, distribution: 2 };
const GAUGE_KEYS = ["flowratio", "divergence", "rsi", "inprofit", "composite"];

async function boot() {
  buildTopbar("trader");
  const data = await loadData();
  document.getElementById("trader-meta").textContent =
    "Dernière collecte : " + new Date(data.generatedAt).toLocaleString("fr-FR");

  const state = { group: "all", sort: "conviction" };

  // filter bar
  const fb = document.getElementById("trader-filters");
  const seg = (options, cur, on) => {
    const s = document.createElement("div");
    s.className = "segmented";
    for (const [val, txt] of options) {
      const b = document.createElement("button");
      b.textContent = txt; b.className = val === cur() ? "on" : "";
      b.addEventListener("click", () => { on(val); render(); });
      s.append(b);
    }
    return s;
  };
  const g1 = document.createElement("div"); g1.className = "control-group";
  g1.innerHTML = '<span class="control-label">Univers</span>';
  g1.append(seg([["all", "Tous"], ["memes", "Memecoins"], ["majors", "Big caps"]], () => state.group, (v) => state.group = v));
  const g2 = document.createElement("div"); g2.className = "control-group";
  g2.innerHTML = '<span class="control-label">Tri</span>';
  g2.append(seg([["conviction", "Conviction"], ["mcap", "Market cap"]], () => state.sort, (v) => state.sort = v));
  fb.append(g1, g2);

  const grid = document.getElementById("trader-grid");

  function render() {
    let assets = data.assets.filter((a) => state.group === "all" || a.group === state.group);
    const withV = assets.map((a) => ({ a, v: assetVerdict(a) }));
    withV.sort((x, y) => {
      if (state.sort === "mcap") return (y.a.marketCap || 0) - (x.a.marketCap || 0);
      // conviction: accumulation first, then by score desc, memes before majors
      const vo = VERDICT_ORDER[x.v.verdict] - VERDICT_ORDER[y.v.verdict];
      if (vo) return vo;
      if (y.v.score !== x.v.score) return y.v.score - x.v.score;
      return (GROUP_ORDER[x.a.group] ?? 9) - (GROUP_ORDER[y.a.group] ?? 9);
    });

    grid.innerHTML = "";
    for (const { a, v } of withV) {
      const meta = VERDICT_META[v.verdict];
      const price = a.prices?.at(-1)?.price;
      const d24 = a.latestChange24h;
      const card = document.createElement("a");
      card.className = "tcard " + meta.cls;
      card.href = `asset.html?sym=${a.symbol}`;

      // header: symbol, price, verdict badge
      const head = document.createElement("div");
      head.className = "tcard-head";
      head.innerHTML = `
        <div class="tcard-id">
          <span class="tcard-dot" style="background:${colorOf(a.symbol)}"></span>
          <span class="tcard-sym">${a.symbol}</span>
          <span class="tcard-sub">${GROUP_LABEL[a.group] || a.group}</span>
        </div>
        <div class="tcard-price">
          <div class="tcard-px">${fmtPrice(price)}</div>
          <div class="tcard-d24 ${d24 == null ? "" : d24 >= 0 ? "up" : "down"}">${fmtDelta(d24)}</div>
        </div>`;
      const badge = document.createElement("div");
      badge.className = "tcard-verdict " + meta.cls;
      badge.innerHTML = `${meta.emoji} <b>${meta.label}</b>${v.score ? `<span class="tcard-score">${v.score > 0 ? "+" : ""}${v.score}</span>` : ""}`;

      // gauges for the signals that have data
      const gauges = document.createElement("div");
      gauges.className = "tcard-gauges";
      let any = false;
      for (const key of GAUGE_KEYS) {
        const sig = v.signals.find((s) => s.key === key);
        if (!sig) continue;
        any = true;
        gauges.append(signalGauge(key, sig.value));
      }
      if (!any) gauges.innerHTML = '<p class="tcard-empty">Signaux en constitution — pas encore assez de données on-chain/flux.</p>';

      // firing signals summary (bull/bear chips)
      const chips = document.createElement("div");
      chips.className = "tcard-chips";
      for (const s of v.signals.filter((s) => s.zone !== "neutral")) {
        const chip = document.createElement("span");
        chip.className = "tchip " + (s.zone === "bull" ? "up" : "down");
        chip.textContent = `${s.zone === "bull" ? "▲" : "▼"} ${s.label}`;
        chips.append(chip);
      }
      if (v.verdict === "distribution" && v.signals.some((s) => s.key === "inprofit" && s.value >= 50)) {
        const warn = document.createElement("span");
        warn.className = "tchip down strong";
        warn.textContent = "⚠ zone de distribution on-chain";
        chips.append(warn);
      }

      card.append(head, badge, gauges, chips);
      grid.append(card);
    }
  }
  render();
}
boot();
