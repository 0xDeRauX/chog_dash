// Sanity check: calls the official X API's "Counts: Recent" endpoint
// (billed $0.005/request, not per tweet) and prints the total number of
// CHOG mentions over the last 24h. No tweet content is ever fetched.
// Usage: npm run test:xcounts
import { CONFIG } from "../src/config.js";

const BEARER_TOKEN = CONFIG.X_BEARER_TOKEN;
if (!BEARER_TOKEN) {
  console.error("Missing X_BEARER_TOKEN (set it in .env)");
  process.exit(1);
}

const QUERY = process.argv[2] || '("CHOG" OR "$CHOG") -is:retweet';
const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

const url = new URL("https://api.x.com/2/tweets/counts/recent");
url.searchParams.set("query", QUERY);
url.searchParams.set("start_time", startTime);
url.searchParams.set("granularity", "hour");

console.log(`Query: ${QUERY}`);
console.log(`Since: ${startTime}`);

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
});

console.log(`HTTP ${res.status}`);

if (!res.ok) {
  console.error(await res.text());
  process.exit(1);
}

const data = await res.json();

console.log(`Mentions over last 24h: ${data.meta?.total_tweet_count}`);
console.log(`Buckets: ${data.data?.length ?? 0}`);
