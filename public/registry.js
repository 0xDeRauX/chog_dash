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
    deltas: [1, 7, 30], chart: true, spark: true, chartDefault: true,
  },
  {
    id: "volume", label: "Volume", category: "market",
    series: "prices", vkey: "volume", format: "usd",
    latest: (a) => a.prices?.at(-1)?.volume ?? null,
    chart: true,
  },
  {
    id: "mcap", label: "Market cap", category: "market", format: "usd",
    latest: (a) => a.marketCap ?? null,
  },
  {
    id: "tvl", label: "TVL", category: "onchain",
    series: "tvl", vkey: "tvl", format: "usd",
    latest: (a) => a.tvl?.at(-1)?.tvl ?? null,
    deltas: [7], chart: true,
  },
  {
    id: "mentions", label: "Mentions X", category: "social",
    series: "mentions", vkey: "count", format: "num",
    latest: (a) => a.mentions?.at(-1)?.count ?? null,
    deltas: [7], chart: true,
  },
  {
    id: "discord", label: "Membres DC", category: "community",
    series: "discord", vkey: "members", format: "num",
    latest: (a) => a.discord?.at(-1)?.members ?? null,
    chart: true,
  },
];

const METRIC_BY_ID = Object.fromEntries(METRICS.map((m) => [m.id, m]));
const CHART_METRICS = METRICS.filter((m) => m.chart);

const DELTA_LABEL = { 1: "24h", 7: "7j", 30: "30j" };

// Screener columns derived from the registry: each metric's latest value,
// then its delta columns.
function screenerColumns() {
  const cols = [];
  for (const m of METRICS) {
    cols.push({ key: m.id, label: m.label, kind: "value", metric: m });
    for (const d of m.deltas || []) {
      cols.push({
        key: `${m.id}_${d}`,
        label: `${m.label.split(" ")[0]} ${DELTA_LABEL[d]}`,
        kind: "delta",
        metric: m,
        days: d,
      });
    }
  }
  return cols;
}

// Value of a screener column for an asset (number, for sorting + display).
function columnValue(col, a) {
  if (col.kind === "value") return col.metric.latest(a);
  return pctOverDays(a[col.metric.series], col.metric.vkey, col.days);
}
