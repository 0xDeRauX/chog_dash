// Ingests every data/raw/**/*.json snapshot into data/chog_dash.db (idempotent
// upserts, safe to re-run). The DB is derived data and can be rebuilt at any
// time with: rm data/chog_dash.db && npm run ingest
// Usage: npm run ingest
import { ingestAll } from "../src/ingest/ingest.js";

const { mentionRows, priceRows } = ingestAll();
console.log(`Ingested ${mentionRows} mention rows, ${priceRows} price rows.`);
