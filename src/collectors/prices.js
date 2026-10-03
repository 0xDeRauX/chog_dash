// Calls CoinGecko's free /simple/price endpoint (no API key needed) to get
// USD price + 24h change + market cap for every tracked asset in one request.
export async function collectPrices(assets) {
  const ids = assets.map((a) => a.coingeckoId).filter(Boolean).join(",");

  const url = new URL("https://api.coingecko.com/api/v3/simple/price");
  url.searchParams.set("ids", ids);
  url.searchParams.set("vs_currencies", "usd");
  url.searchParams.set("include_24hr_change", "true");
  url.searchParams.set("include_market_cap", "true");
  url.searchParams.set("include_24hr_vol", "true");

  // The free tier throws the occasional 429/5xx — a single miss used to cost
  // the whole daily run (2026-09-29, 10-01), so retry with backoff.
  let res;
  for (let attempt = 1; ; attempt++) {
    res = await fetch(url);
    if (res.ok) break;
    if (attempt >= 5 || ![429, 500, 502, 503, 504].includes(res.status)) {
      throw new Error(`CoinGecko HTTP ${res.status}: ${await res.text()}`);
    }
    const wait = Number(res.headers.get("retry-after")) * 1000 || 15000 * attempt;
    console.warn(`CoinGecko HTTP ${res.status} — nouvel essai dans ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
  }

  const data = await res.json();

  return assets.map((asset) => ({
    symbol: asset.symbol,
    coingeckoId: asset.coingeckoId,
    priceUsd: data[asset.coingeckoId]?.usd ?? null,
    change24h: data[asset.coingeckoId]?.usd_24h_change ?? null,
    marketCap: data[asset.coingeckoId]?.usd_market_cap ?? null,
    volume24h: data[asset.coingeckoId]?.usd_24h_vol ?? null,
  }));
}
