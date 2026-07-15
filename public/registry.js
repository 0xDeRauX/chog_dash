/* Indicator / metric registry — the single source of truth. The screener
   columns, the asset-view chart toggles and the asset stat header are all
   generated from this. Adding a metric or a future proprietary indicator
   (Buzz Score, composite…) is one entry here, not a new page/card.

   Fields:
     id        unique key
     label     display name
     category  market | social | community | onchain | signal
     series    asset field holding the daily series (for charts/deltas)
     vkey      value key inside a series point
     format    usd | price | pct | num | score   (see fmtBy in lib.js)
     latest(a) current value (screener cell + asset stat)
     deltas    which %-change columns to derive (via pctOverDays)
     chart     present => togglable as an indexed overlay on the asset chart
     spark     present => draw a mini price sparkline in the screener
*/
const METRICS = [
  {
    id: "price", label: "Prix", category: "market",
    series: "prices", vkey: "price", format: "price",
    latest: (a) => a.prices?.at(-1)?.price ?? null,
    deltas: [1, 7, 30, 90], chart: true, spark: true, chartDefault: true,
  },
  {
    id: "volume", label: "Volume", category: "market",
    series: "prices", vkey: "volume", format: "usd",
    latest: (a) => a.prices?.at(-1)?.volume ?? null,
    deltas: [7, 30, 90], chart: true,
  },
  {
    id: "mcap", label: "Market cap", category: "market", format: "usd",
    latest: (a) => a.marketCap ?? null,
  },
  {
    id: "tvl", label: "TVL", category: "onchain",
    series: "tvl", vkey: "tvl", format: "usd",
    latest: (a) => a.tvl?.at(-1)?.tvl ?? null,
    deltas: [7, 30, 90], chart: true,
  },
  {
    id: "mentions", label: "Mentions X", category: "social",
    series: "mentions", vkey: "count", format: "num",
    latest: (a) => a.mentions?.at(-1)?.count ?? null,
    deltas: [7, 30, 90], chart: true,
  },
  {
    id: "discord", label: "Membres DC", category: "community",
    series: "discord", vkey: "members", format: "num",
    latest: (a) => a.discord?.at(-1)?.members ?? null,
    deltas: [7, 30, 90], chart: true,
  },
  {
    id: "telegram", label: "Telegram", category: "community",
    series: "telegram", vkey: "members", format: "num",
    latest: (a) => a.telegram?.at(-1)?.members ?? null,
    deltas: [7, 30, 90], chart: true,
  },
  {
    id: "holders", label: "Holders", category: "onchain",
    series: "holders", vkey: "holders", format: "num",
    latest: (a) => a.holders?.at(-1)?.holders ?? null,
    deltas: [7, 30, 90], chart: true,
  },
  {
    // Proprietary indicator (M4). Computed client-side from the mention series
    // in lib.js (attached as a.buzz) — plugs into the registry like any metric.
    id: "buzz", label: "Buzz Score", category: "signal",
    series: "buzz", vkey: "buzz", format: "z",
    latest: (a) => lastValue(a.buzz, "buzz"),
    help: {
      what: "Intensité des mentions X <b>par rapport à la norme de l'actif lui-même</b> (z-score vs sa moyenne 30j). Rend BTC et CHOG comparables malgré des volumes 100× différents.",
      read: "<b>+2σ</b> = pic d'attention rare (le buzz est 2 écarts-types au-dessus de sa normale) · <b>0</b> = journée ordinaire · <b>−1σ</b> = attention en berne.",
      example: "CHOG passe de 400 à 900 mentions/jour : en absolu c'est peu face aux 90 000 de BTC, mais son Buzz monte à +3σ → il se passe quelque chose <i>chez CHOG</i>.",
      quality: "IC ≈ +0.06 à +0.08 — signal faible mais réel, surtout pour <b>classer les memes entre eux</b>.",
    },
  },
  {
    // Proprietary indicator (M5-lite): normalized attention − normalized price.
    // High positive = attention leading price (silent accumulation).
    id: "divergence", label: "Divergence", category: "signal",
    series: "divergence", vkey: "div", format: "signed",
    latest: (a) => lastValue(a.divergence, "div"),
    help: {
      what: "Écart entre l'attention normalisée et le prix normalisé : <b>z(mentions) − z(prix)</b>. Mesure si le buzz devance le prix, ou l'inverse.",
      read: "<b>Positif</b> = l'attention monte plus que le prix → <b>accumulation silencieuse potentielle</b> · <b>Négatif</b> = le prix a déjà décollé sans le buzz (essoufflement possible).",
      example: "Les mentions CHOG grimpent à +2σ mais le prix reste plat (0σ) → Divergence ≈ +2 : la foule s'intéresse avant que le prix ne bouge.",
      quality: "✅ <b>Notre meilleur signal</b>, validé sur ~350j : IC +0.10 (7j) à +0.13 (30j) — au-dessus du seuil 0.05 de l'industrie, positif sur 7 memes/9.",
    },
  },
];

const METRIC_BY_ID = Object.fromEntries(METRICS.map((m) => [m.id, m]));
const CHART_METRICS = METRICS.filter((m) => m.chart);

const DELTA_LABEL = { 1: "24h", 7: "7j", 30: "30j", 90: "90j" };

// Measures the screener can focus on. "overview" = compact glance across all
// metrics; each other id = one metric with its value + every delta period.
const MEASURES = [
  ["overview", "Vue d'ensemble"],
  ["buzz", "Buzz"],
  ["divergence", "Divergence"],
  ["price", "Prix"],
  ["volume", "Volume"],
  ["tvl", "TVL"],
  ["mentions", "Mentions"],
  ["discord", "Discord"],
  ["telegram", "Telegram"],
  ["holders", "Holders"],
];

// Columns for a given measure. Overview = one value column per metric (+ price
// 24h). Focus = the metric's value then each of its delta periods.
function columnsForMeasure(measure) {
  if (measure === "overview") {
    const cols = [];
    for (const m of METRICS) {
      cols.push({ key: m.id, label: m.label, kind: "value", metric: m });
      if (m.id === "price") cols.push({ key: "price_1", label: "24h", kind: "delta", metric: m, days: 1 });
    }
    return cols;
  }
  // Buzz focus: the score + the mention context behind it.
  if (measure === "buzz") {
    const buzz = METRIC_BY_ID.buzz, ment = METRIC_BY_ID.mentions;
    return [
      { key: "buzz", label: "Buzz Score", kind: "value", metric: buzz },
      { key: "mentions", label: "Mentions", kind: "value", metric: ment },
      { key: "mentions_7", label: "Ment. 7j", kind: "delta", metric: ment, days: 7 },
      { key: "mentions_30", label: "Ment. 30j", kind: "delta", metric: ment, days: 30 },
    ];
  }
  // Divergence focus: the signal + the attention & price it's built from.
  if (measure === "divergence") {
    const div = METRIC_BY_ID.divergence, buzz = METRIC_BY_ID.buzz, price = METRIC_BY_ID.price;
    return [
      { key: "divergence", label: "Divergence", kind: "value", metric: div },
      { key: "buzz", label: "Buzz Score", kind: "value", metric: buzz },
      { key: "price_7", label: "Prix 7j", kind: "delta", metric: price, days: 7 },
      { key: "price_30", label: "Prix 30j", kind: "delta", metric: price, days: 30 },
    ];
  }
  const m = METRIC_BY_ID[measure];
  const cols = [{ key: m.id, label: m.label, kind: "value", metric: m }];
  for (const d of m.deltas || []) {
    cols.push({ key: `${m.id}_${d}`, label: DELTA_LABEL[d], kind: "delta", metric: m, days: d });
  }
  return cols;
}

// Default sort column key for a measure.
function defaultSortKey(measure) {
  if (measure === "overview") return "mcap";
  return measure; // buzz -> "buzz", price -> "price", etc.
}

// Value of a screener column for an asset (number, for sorting + display).
function columnValue(col, a) {
  if (col.kind === "value") return col.metric.latest(a);
  return pctOverDays(a[col.metric.series], col.metric.vkey, col.days);
}
