// Backfills daily mention counts from the X API's full-archive "Counts: All"
// endpoint ($0.010 PER REQUEST). It returns calendar-day (UTC) buckets and
// paginates at 31 days per page, so an N-day backfill costs ceil(N/31) requests
// per asset. Values are whole-day counts, matching the daily collector's
// calendar-day definition.
import { CONFIG } from "../config.js";

export function pagesFor(days) {
  return Math.ceil(days / 31);
}

// Window = [today-00:00 UTC − days, today-00:00 UTC): only complete days.
export function backfillWindow(days) {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  return { start, end };
}

export async function fetchMentionHistory(asset, days) {
  const { start, end } = backfillWindow(days);
  const byDate = new Map();
  let nextToken = null;
  let requests = 0;
  const maxPages = pagesFor(days) + 2; // safety margin

  do {
    const url = new URL("https://api.x.com/2/tweets/counts/all");
    url.searchParams.set("query", asset.xQuery);
    url.searchParams.set("start_time", start.toISOString());
    url.searchParams.set("end_time", end.toISOString());
    url.searchParams.set("granularity", "day");
    if (nextToken) url.searchParams.set("next_token", nextToken);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${CONFIG.X_BEARER_TOKEN}` },
    });
    requests++;
    if (!res.ok) {
      throw new Error(`X counts/all HTTP ${res.status} for ${asset.symbol}: ${await res.text()}`);
    }
    const data = await res.json();
    for (const b of data.data ?? []) {
      byDate.set(b.start.slice(0, 10), b.tweet_count);
    }
    nextToken = data.meta?.next_token ?? null;
    if (nextToken) await new Promise((r) => setTimeout(r, 1200)); // rate-limit courtesy
  } while (nextToken && requests < maxPages);

  const series = [...byDate.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { symbol: asset.symbol, query: asset.xQuery, series, requests };
}
