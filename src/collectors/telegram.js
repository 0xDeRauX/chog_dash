// Fetches a project's Telegram channel member count from CoinGecko's free,
// keyless community_data (X/Twitter followers are no longer exposed there, but
// telegram_channel_user_count still is). Only the current snapshot is available
// (no history), so counts accumulate from the first collection onward. Not every
// listing has a Telegram registered — those are simply skipped (rendered "—").
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchTelegramMembers(coingeckoId) {
  const url = new URL(`https://api.coingecko.com/api/v3/coins/${coingeckoId}`);
  url.searchParams.set("localization", "false");
  url.searchParams.set("tickers", "false");
  url.searchParams.set("market_data", "false");
  url.searchParams.set("community_data", "true");
  url.searchParams.set("developer_data", "false");
  // CoinGecko's free tier is aggressively rate-limited (HTTP 429). Retry with
  // backoff, honouring Retry-After when present.
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "chog-dash/1.0" } });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || 15000 * (attempt + 1);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status} for ${coingeckoId}`);
    const data = await res.json();
    return data.community_data?.telegram_channel_user_count ?? null;
  }
  throw new Error(`CoinGecko 429 (rate limited) for ${coingeckoId}`);
}

export async function collectAllTelegram(assets) {
  const results = [];
  for (const asset of assets) {
    if (!asset.coingeckoId) continue;
    try {
      const members = await fetchTelegramMembers(asset.coingeckoId);
      if (members != null) results.push({ symbol: asset.symbol, members });
    } catch (err) {
      console.error(`Skipped ${asset.symbol}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 6000)); // stay under CoinGecko free rate limits
  }
  return results;
}
