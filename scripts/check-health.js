// End-of-run health check. Exits 1 (red CI) when a collector step failed OR a
// source silently stopped producing fresh data. Most collectors skip a broken
// asset and still exit 0, which kept the CI green for weeks while X credits,
// Dune, CoinGecko's Telegram field and tonapi were all dead (Jul–Oct 2026).
// Usage: node scripts/check-health.js   (STEPS_JSON = toJSON(steps) in CI)
import fs from "fs";
import path from "path";
import { ASSETS } from "../src/config.js";
import { ledgerCfg } from "../src/collectors/pnl.js";

const today = new Date().toISOString().slice(0, 10);
const dayShift = (n) => { const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const yesterday = dayShift(-1);
const read = (rel) => { try { return JSON.parse(fs.readFileSync(path.resolve("data/raw", rel), "utf8")); } catch { return null; } };
const problems = [];
const notes = [];

// 1) collector steps that failed (continue-on-error keeps the run going)
if (process.env.STEPS_JSON) {
  const steps = JSON.parse(process.env.STEPS_JSON);
  for (const [id, s] of Object.entries(steps)) if (s.outcome === "failure") problems.push(`étape « ${id} » en échec`);
}

// 2) every daily source wrote today's file, covering the expected assets
const coverage = (source, date, expected, field) => {
  const f = read(`${source}/${date}.json`);
  if (!f) return problems.push(`${source}: pas de fichier ${date}`);
  const got = new Set((f.results || []).filter((r) => r[field] != null).map((r) => r.symbol));
  const missing = expected.filter((s) => !got.has(s));
  if (missing.length) problems.push(`${source} ${date}: manque ${missing.join(", ")}`);
};
coverage("prices", today, ASSETS.filter((a) => a.coingeckoId).map((a) => a.symbol), "priceUsd");
coverage("x-mentions", yesterday, ASSETS.filter((a) => a.xQuery).map((a) => a.symbol), "mentionCount");
coverage("telegram", today, ASSETS.filter((a) => a.telegram).map((a) => a.symbol), "members");
coverage("holders", today, ASSETS.filter((a) => a.holders).map((a) => a.symbol), "holders");
for (const src of ["discord", "tradeflow"]) if (!read(`${src}/${today}.json`)) problems.push(`${src}: pas de fichier ${today}`);

// 3) ledgers: the series must reach (about) yesterday
for (const a of ASSETS) {
  const pnl = read(`pnl/${a.symbol}.json`);
  if (ledgerCfg(a)) {
    if (pnl?.source !== "ledger" && a.symbol !== "CHOG") { notes.push(`${a.symbol}: grand livre en cours d'indexation (série publiée = ancienne)`); continue; }
    if (!pnl?.indexedToDate || pnl.indexedToDate < dayShift(-2)) problems.push(`${a.symbol}: grand livre au ${pnl?.indexedToDate ?? "—"}`);
  } else if (a.chain === "solana" && a.holders?.source === "solana") {
    if (pnl?.indexedToDate !== today) problems.push(`${a.symbol}: grand livre Solana au ${pnl?.indexedToDate ?? "—"}`);
  } else if (a.holders?.source === "tonapi") {
    if (pnl?.indexedToDate !== today) problems.push(`${a.symbol}: % en gain TON au ${pnl?.indexedToDate ?? "—"}`);
  }
}

for (const n of notes) console.log(`ℹ️  ${n}`);
if (problems.length) {
  console.error(`❌ ${problems.length} problème(s) :`);
  for (const p of problems) console.error(`   - ${p}`);
  process.exit(1);
}
console.log("✅ Toutes les sources sont à jour.");
