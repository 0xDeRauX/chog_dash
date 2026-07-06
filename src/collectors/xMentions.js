// Daily mention collection via the official X "Counts: Recent" endpoint
// ($0.005 PER REQUEST — not per day). One request returns a whole window of
// calendar-day (UTC) buckets, so re-collecting the last few days each run costs
// the same as one day yet self-heals any missed/late day (the ingest upserts).
import { CONFIG } from "../config.js";

// Trailing complete UTC days to (re)collect each run. Capped at 6 because
// counts/recent only reaches back 7 days — 6 full calendar days always fit
// inside that window whatever time of day the run fires (7 would overflow and
// return a truncated oldest bucket).
export const DAILY_LOOKBACK_DAYS = 6;

// Window = [today 00:00 UTC − days, today 00:00 UTC): only complete days.
export function lookbackWindow(days) {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  return { start, end };
}

export async function collectRecentDays(asset, days = DAILY_LOOKBACK_DAYS) {
  const { start, end } = lookbackWindow(days);

  const url = new URL("https://api.x.com/2/tweets/counts/recent");
  url.searchParams.set("query", asset.xQuery);
  url.searchParams.set("start_time", start.toISOString());
  url.searchParams.set("end_time", end.toISOString());
  url.searchParams.set("granularity", "day");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${CONFIG.X_BEARER_TOKEN}` },
  });
  if (!res.ok) {
    throw new Error(`X counts/recent HTTP ${res.status} for ${asset.symbol}: ${await res.text()}`);
  }

  const data = await res.json();
  const series = (data.data ?? []).map((b) => ({
    date: b.start.slice(0, 10),
    count: b.tweet_count,
  }));
  return { symbol: asset.symbol, query: asset.xQuery, series };
}

export async function collectAllRecent(assets, days = DAILY_LOOKBACK_DAYS) {
  const results = [];
  for (const asset of assets) {
    try {
      results.push(await collectRecentDays(asset, days));
    } catch (err) {
      // One bad/edited query must not fail the whole daily run — skip and log.
      console.error(`Skipped ${asset.symbol}: ${err.message}`);
    }
  }
  return results;
}
