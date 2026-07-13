// Ingests every data/raw/**/*.json snapshot into data/chog_dash.db (idempotent
// upserts, safe to re-run). The DB is derived data and can be rebuilt at any
// time with: rm data/chog_dash.db && npm run ingest
// Usage: npm run ingest
import { ingestAll } from "../src/ingest/ingest.js";

const { mentionRows, priceRows, tvlRows, discordRows, telegramRows, holderRows, flowRows } = ingestAll();
console.log(
  `Ingested ${mentionRows} mention, ${priceRows} price, ${tvlRows} TVL, ${discordRows} Discord, ${telegramRows} Telegram, ${holderRows} holder, ${flowRows} flow rows.`
);
