// Sanity check: confirms the TwitterAPI.io key/endpoint still work and shows
// how many CHOG mentions came back on a single page over the last 24h.
// Usage: npm run test:twitterapi
import { CONFIG } from "../src/config.js";

const API_KEY = CONFIG.TWITTER_API_KEY;
if (!API_KEY) {
  console.error("Missing TWITTER_API_KEY (set it in .env)");
  process.exit(1);
}

const QUERY = process.argv[2] || '"CHOG" OR "$CHOG"';
const sinceUnix = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
const fullQuery = `${QUERY} since_time:${sinceUnix}`;

const url = new URL("https://api.twitterapi.io/twitter/tweet/advanced_search");
url.searchParams.set("query", fullQuery);
url.searchParams.set("queryType", "Latest");
url.searchParams.set("cursor", "");

console.log(`Query: ${fullQuery}`);

const res = await fetch(url, { headers: { "X-API-Key": API_KEY } });

console.log(`HTTP ${res.status}`);

if (!res.ok) {
  console.error(await res.text());
  process.exit(1);
}

const data = await res.json();
const tweets = data.tweets || [];

console.log(`Tweets on this page: ${tweets.length}`);
console.log(`has_next_page: ${data.has_next_page}`);
if (tweets[0]) {
  console.log(`Most recent: [@${tweets[0].author?.userName}] ${tweets[0].text?.slice(0, 100)}`);
}
