// Calls the official X API's "Counts: Recent" endpoint ($0.005/request,
// not per tweet) to get the mention count for one asset over the last 24h.
import { CONFIG } from "../config.js";

export async function collectMentionsForAsset(asset) {
  const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const url = new URL("https://api.x.com/2/tweets/counts/recent");
  url.searchParams.set("query", asset.xQuery);
  url.searchParams.set("start_time", startTime);
  url.searchParams.set("granularity", "hour");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${CONFIG.X_BEARER_TOKEN}` },
  });

  if (!res.ok) {
    throw new Error(`X counts API HTTP ${res.status} for ${asset.symbol}: ${await res.text()}`);
  }

  const data = await res.json();

  return {
    symbol: asset.symbol,
    query: asset.xQuery,
    startTime,
    mentionCount: data.meta?.total_tweet_count ?? 0,
    buckets: data.data?.length ?? 0,
  };
}

export async function collectAllMentions(assets) {
  const results = [];
  for (const asset of assets) {
    results.push(await collectMentionsForAsset(asset));
  }
  return results;
}
