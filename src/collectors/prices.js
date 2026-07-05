// Calls CoinGecko's free /simple/price endpoint (no API key needed) to get
// USD price + 24h change + market cap for every tracked asset in one request.
export async function collectPrices(assets) {
  const ids = assets.map((a) => a.coingeckoId).filter(Boolean).join(",");

  const url = new URL("https://api.coingecko.com/api/v3/simple/price");
  url.searchParams.set("ids", ids);
  url.searchParams.set("vs_currencies", "usd");
  url.searchParams.set("include_24hr_change", "true");
  url.searchParams.set("include_market_cap", "true");

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
    marketCap: data[asset.coingeckoId]?.usd_market_cap ?? null,
  }));
}
