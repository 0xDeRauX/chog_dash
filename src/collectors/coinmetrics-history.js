// Full on-chain history for the assets Coin Metrics covers (BTC, ETH…) via its
// FREE community API — no key, no pagination for a daily series: one call
// returns the whole life of the asset (BTC = 5875 days back to 2009).
//
// What the community tier actually gives (verified against the catalog):
//   PriceUSD                     since 2010-07-18   → price
//   volume_reported_spot_usd_1d  since 2010-07-18   → volume
//   CapMrktCurUSD                since 2010-07-18   → market cap
//   AdrBalCnt                    since 2009-01-03   → holders (non-zero addresses)
//   CapMVRVCur                   since 2010-07-18   → MVRV (aggregate profitability)
// The USD balance tiers (AdrBalUSD*Cnt → « holders ≥ $50 ») and the supply-in
// -profit metrics are PAID (HTTP 403 on this tier) — see collectPnlProxy below
// for the free approximation we compute ourselves instead.
import fs from "fs";
import path from "path";

const API = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics";
const METRICS = ["PriceUSD", "volume_reported_spot_usd_1d", "CapMrktCurUSD", "AdrBalCnt", "CapMVRVCur"];
const num = (v) => (v == null ? null : Number(v));

async function fetchSeries(cmAsset) {
  const rows = [];
  let url = `${API}?assets=${cmAsset}&metrics=${METRICS.join(",")}&frequency=1d&start_time=2009-01-01&page_size=10000`;
  for (let guard = 0; url && guard < 20; guard++) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Coinmetrics HTTP ${res.status}: ${(await res.text()).slice(0, 140)}`);
    const j = await res.json();
    rows.push(...(j.data || []));
    url = j.next_page_url || null;
  }
  return rows.map((r) => ({
    date: String(r.time).slice(0, 10),
    price: num(r.PriceUSD),
    volume: num(r.volume_reported_spot_usd_1d),
    marketCap: num(r.CapMrktCurUSD),
    holders: num(r.AdrBalCnt),
    mvrv: num(r.CapMVRVCur),
  })).sort((a, b) => a.date.localeCompare(b.date));
}

// « % en gain » proxy. The real supply-in-profit needs each coin's acquisition
// price — a paid dataset for BTC. Free approximation, same shape as the ledger
// method used elsewhere in the project: treat each past day's VOLUME as coins
// acquired at that day's price, building a cost-basis histogram, then count the
// share acquired below today's price. It is explicitly an approximation (it
// ignores re-selling and long-dormant coins), so it ships under its own source
// tag and the UI labels it as such.
function pnlProxy(series) {
  const days = series.filter((d) => d.price > 0 && d.volume > 0);
  if (days.length < 60) return [];
  // log-price buckets (20 per e-fold) → cheap convolution over the history
  const B = 20;
  const bucket = new Map(); // bucketIndex -> weight (USD volume)
  const idxOf = (p) => Math.round(Math.log(p) * B);
  const out = [];
  for (const d of days) {
    bucket.set(idxOf(d.price), (bucket.get(idxOf(d.price)) || 0) + d.volume);
    const cut = idxOf(d.price);
    let below = 0, total = 0;
    for (const [i, w] of bucket) { total += w; if (i < cut) below += w; }
    if (total > 0) {
      out.push({
        date: d.date,
        pctInProfit: Number(((below / total) * 100).toFixed(2)),
        mvrv: d.mvrv ?? null,
      });
    }
  }
  return out;
}

export async function collectCoinmetricsHistory(asset) {
  const cmAsset = asset.holders?.cmAsset;
  if (!cmAsset) throw new Error(`${asset.symbol}: pas de holders.cmAsset en config`);
  const series = await fetchSeries(cmAsset);
  const sym = asset.symbol;
  const write = (dir, body) => {
    const f = path.resolve(`data/raw/${dir}/${sym}.json`);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(body, null, 1));
  };

  // PRICE HISTORY ONLY. The same call also exposes holders (AdrBalCnt, back to
  // 2009) and supports a % en gain proxy, but a 16-year daily series per metric
  // doubled data.json — which every page load downloads. Kept deliberately out;
  // pnlProxy() below stays available if that trade-off is ever revisited.
  const prices = series.filter((d) => d.price != null)
    .map((d) => ({ date: d.date, price: d.price, volume: d.volume ?? null, marketCap: d.marketCap ?? null }));
  write("prices-history", { symbol: sym, source: "coinmetrics", series: prices });

  return { days: series.length, priceDays: prices.length, priceFrom: prices[0]?.date, lastMvrv: series.at(-1)?.mvrv ?? null };
}
