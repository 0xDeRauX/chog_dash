// Calls CoinGecko's free /simple/price endpoint (no API key needed) to get
// USD price + 24h change for every tracked asset in a single request.
export async function collectPrices(assets) {
  const ids = assets.map((a) => a.coingeckoId).filter(Boolean).join(",");

  const url = new URL("https://api.coingecko.com/api/v3/simple/price");
  url.searchParams.set("ids", ids);
  url.searchParams.set("vs_currencies", "usd");
  url.searchParams.set("include_24hr_change", "true");

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`CoinGecko HTTP ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();

  return assets.map((asset) => ({
    symbol: asset.symbol,
    coingeckoId: asset.coingeckoId,
    priceUsd: data[asset.coingeckoId]?.usd ?? null,
    change24h: data[asset.coingeckoId]?.usd_24h_change ?? null,
  }));
}
