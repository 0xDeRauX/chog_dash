// Backfills daily USD price history from CoinGecko's free market_chart endpoint.
// Downsamples to one price per UTC day (the last sample of each day), so the
// dashboard has real multi-week curves immediately instead of waiting for the
// daily collector to accumulate them.
export async function fetchPriceHistory(asset, days = 90) {
  const url = new URL(
    `https://api.coingecko.com/api/v3/coins/${asset.coingeckoId}/market_chart`
  );
  url.searchParams.set("vs_currency", "usd");
  url.searchParams.set("days", String(days));

  // Free tier rate-limits the heavy market_chart endpoint; retry 429s with
  // a growing wait instead of failing the asset outright.
  let res;
  for (let attempt = 0; attempt < 5; attempt++) {
    res = await fetch(url);
    if (res.status !== 429) break;
    const wait = 15000 * (attempt + 1);
    console.log(`  ${asset.symbol}: 429, waiting ${wait / 1000}s…`);
    await new Promise((r) => setTimeout(r, wait));
  }
  if (!res.ok) {
    throw new Error(`CoinGecko market_chart HTTP ${res.status} for ${asset.symbol}: ${await res.text()}`);
  }

  const data = await res.json();
  // market_chart returns prices + total_volumes as [[unixMs, value], ...].
  // Collapse each to the last sample per UTC date.
  const priceByDate = new Map();
  for (const [ts, price] of data.prices ?? []) {
    priceByDate.set(new Date(ts).toISOString().slice(0, 10), price);
  }
  const volByDate = new Map();
  for (const [ts, vol] of data.total_volumes ?? []) {
    volByDate.set(new Date(ts).toISOString().slice(0, 10), vol);
  }

  const series = [...priceByDate.entries()]
    .map(([date, price]) => ({ date, price, volume: volByDate.get(date) ?? null }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { symbol: asset.symbol, coingeckoId: asset.coingeckoId, series };
}
