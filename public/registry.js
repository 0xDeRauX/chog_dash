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
    // Proprietary indicator (M4). Computed client-side from the mention series
    // in lib.js (attached as a.buzz) — plugs into the registry like any metric.
    id: "buzz", label: "Buzz Score", category: "signal",
    series: "buzz", vkey: "buzz", format: "z",
    latest: (a) => lastValue(a.buzz, "buzz"),
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
  ["price", "Prix"],
  ["volume", "Volume"],
  ["tvl", "TVL"],
  ["mentions", "Mentions"],
  ["discord", "Discord"],
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
