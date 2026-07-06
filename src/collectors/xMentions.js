// Calls the official X API's "Counts: Recent" endpoint ($0.005/request,
// not per tweet). Counts the PREVIOUS complete UTC calendar day (not a rolling
// 24h ending "now"), so the value is independent of the exact run time — a
// missed/delayed schedule no longer shifts the window. Yesterday is always
// within the endpoint's 7-day reach.
import { CONFIG } from "../config.js";

// [yesterday 00:00 UTC, today 00:00 UTC), labelled with yesterday's date.
export function previousUtcDay() {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 1);
  return { start, end, date: start.toISOString().slice(0, 10) };
}

export async function collectMentionsForAsset(asset) {
  const { start, end, date } = previousUtcDay();

  const url = new URL("https://api.x.com/2/tweets/counts/recent");
  url.searchParams.set("query", asset.xQuery);
  url.searchParams.set("start_time", start.toISOString());
  url.searchParams.set("end_time", end.toISOString());
  url.searchParams.set("granularity", "day");

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
    date,
    mentionCount: data.meta?.total_tweet_count ?? 0,
    collectedAt: new Date().toISOString(),
  };
}

export async function collectAllMentions(assets) {
  const results = [];
  for (const asset of assets) {
    results.push(await collectMentionsForAsset(asset));
  }
  return results;
}
