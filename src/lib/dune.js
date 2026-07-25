// Reusable Dune Analytics client — the pattern all Dune-backed collectors share.
// Dune bills on RESULT datapoints (rows × columns), NOT on data scanned, so an
// aggregated query that returns a few numbers costs ~nothing even when it scans
// years of a token's history server-side. That's what makes deep on-chain
// analysis (cost basis, % in profit, whale concentration) essentially free here.
//
// Design for the free tier: it caps the number of PRIVATE queries, so we create
// ONE PUBLIC, PARAMETERISED query per purpose (e.g. "solana price history") and
// reuse it for every token by passing a {{mint}} parameter at execution time.
// A run = execute the query with parameter values, poll to completion, read
// results. Solana address columns on price tables are varbinary → the SQL uses
// from_base58('{{mint}}').
import { CONFIG } from "../config.js";

const BASE = "https://api.dune.com/api/v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Key rotation: the free tier caps datapoints/month per key, so a heavy backfill
// day can exhaust one key. We keep every configured key and advance to the next
// on a credit error (402, or 429 whose body signals the monthly limit rather
// than rate limiting). Created public queries are per-key, so the query cache is
// keyed by (purpose, keyIndex) — see runQuery.
const KEYS = CONFIG.DUNE_API_KEYS?.length ? CONFIG.DUNE_API_KEYS : [CONFIG.DUNE_API_KEY].filter(Boolean);
let keyIdx = 0;
const curKey = () => KEYS[keyIdx];
function rotateKey(reason) {
  if (keyIdx < KEYS.length - 1) {
    keyIdx++;
    console.warn(`Dune: clé ${keyIdx}/${KEYS.length - 1} épuisée (${reason}) → bascule sur la suivante`);
    return true;
  }
  return false;
}

export const duneAvailable = () => KEYS.length > 0;

function headers() {
  return { "X-Dune-API-Key": curKey(), "content-type": "application/json" };
}

async function api(path, opts = {}, tries = 4) {
  for (let t = 1; ; t++) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: headers() });
    if (res.ok) return res.json();
    const body = await res.text();
    // Rotate to the next key when THIS key can't serve the request: out of
    // credits (402, or a 429 that mentions the monthly quota), or the key's Dune
    // account is stuck on a deprecated query engine (400) — skip it if a working
    // key is configured.
    const creditsOut = res.status === 402 || (res.status === 429 && /credit|limit|quota|month/i.test(body));
    const badEngine = res.status === 400 && /deprecated query engine|old-query-engine/i.test(body);
    if ((creditsOut || badEngine) && rotateKey(badEngine ? "moteur déprécié" : `HTTP ${res.status}`)) continue;
    if (res.status === 429 && t < tries) { await sleep(15000 * t); continue; }
    if (t >= tries) throw new Error(`Dune HTTP ${res.status} on ${path}: ${body.slice(0, 160)}`);
    await sleep(3000 * t);
  }
}

// One public parameterised query per purpose, cached in-process. `params` maps
// {{name}} placeholders in the SQL to their default values; created once, then
// reused for every token with different parameter values at execute time.
const queryCache = new Map();
async function ensureQuery(name, sql, params) {
  const cacheKey = `${keyIdx}:${name}`; // queries belong to the key that created them
  if (queryCache.has(cacheKey)) return queryCache.get(cacheKey);
  const parameters = Object.entries(params).map(([key, value]) => ({ key, type: "text", value: String(value) }));
  const { query_id } = await api("/query", {
    method: "POST",
    body: JSON.stringify({ name: `chog_${name}`, query_sql: sql, is_private: false, parameters }),
  });
  queryCache.set(cacheKey, query_id);
  return query_id;
}

// Run a purpose's query with concrete parameter values → { rows, datapoints, ms }.
// "medium" performance is the free-tier default; heavy full-history joins can
// take minutes (the RESULT stays cheap). maxWaitMs guards a runaway query.
export async function runQuery(name, sql, params = {}, { performance = "medium", maxWaitMs = 600000 } = {}) {
  if (!duneAvailable()) throw new Error("Missing DUNE_API_KEY");
  // Whole run is tied to one key (the query, its execution and results all live
  // in that key's account). If the key rotates mid-run because it ran out of
  // credits, restart cleanly on the next key — bounded by the number of keys.
  for (let attempt = 0; ; attempt++) {
    const startIdx = keyIdx;
    const queryId = await ensureQuery(name, sql, params);
    const { execution_id } = await api(`/query/${queryId}/execute`, {
      method: "POST",
      body: JSON.stringify({ performance, query_parameters: params }),
    });
    if (keyIdx !== startIdx && attempt < KEYS.length) continue; // rotated → redo on new key
    const deadline = Date.now() + maxWaitMs;
    let state = "PENDING";
    while (Date.now() < deadline) {
      await sleep(5000);
      const st = await api(`/execution/${execution_id}/status`);
      state = st.state || "";
      if (state === "QUERY_STATE_COMPLETED" || state === "QUERY_STATE_FAILED") break;
    }
    if (keyIdx !== startIdx && attempt < KEYS.length) continue;
    const rj = await api(`/execution/${execution_id}/results`);
    if (state === "QUERY_STATE_FAILED") throw new Error(`Dune query failed (${name}): ${JSON.stringify(rj.error || "").slice(0, 200)}`);
    if (!rj.result) throw new Error(`Dune query timed out (${name}) after ${maxWaitMs / 1000}s`);
    return { rows: rj.result.rows || [], datapoints: rj.result.metadata?.datapoint_count ?? null, ms: rj.result.metadata?.execution_time_millis ?? null };
  }
}
