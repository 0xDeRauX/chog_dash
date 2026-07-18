// Enables/disables daily X mention tracking for radar tokens — the ONLY way
// the tracked list changes (dispatched by the Admin page through the
// collect-manual workflow, or run locally). Free by itself; each tracked
// token then costs ~$0.005/day in the daily mentions collection.
//
// Usage: node scripts/radar-track.js [--add=chain:addr,...] [--remove=chain:addr,...]
import fs from "fs";
import path from "path";
import { loadTracked, saveTracked, saneCashtag, CONFIG_SYMS } from "../src/collectors/chainradar.js";

const args = process.argv.slice(2);
const parse = (flag) => (args.find((a) => a.startsWith(flag))?.split("=")[1] || "")
  .toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
const toAdd = parse("--add=");
const toRemove = parse("--remove=");
if (!toAdd.length && !toRemove.length) {
  const cur = loadTracked();
  console.log(`Suivis actuels (${cur.length}) : ${cur.map((t) => `$${t.symbol} (${t.chain}:${t.address})`).join(", ") || "aucun"}`);
  process.exit(0);
}

// resolve symbols from the latest radar snapshot
const dir = path.resolve("data/raw/chainradar");
const snaps = fs.readdirSync(dir).filter((f) => /^\d{4}-/.test(f)).sort();
const bySymKey = new Map();
if (snaps.length) {
  const snap = JSON.parse(fs.readFileSync(path.join(dir, snaps.at(-1)), "utf8"));
  for (const [chain, toks] of Object.entries(snap.chains || {})) {
    for (const t of toks) bySymKey.set(`${chain}:${t.address}`, t.symbol);
  }
}

let tracked = loadTracked();
const today = new Date().toISOString().slice(0, 10);
for (const key of toAdd) {
  const [chain, address] = key.split(":");
  const symbol = bySymKey.get(key);
  if (!symbol) { console.error(`SKIP ${key}: introuvable dans le dernier snapshot radar`); continue; }
  if (CONFIG_SYMS.has(symbol.toUpperCase())) { console.error(`SKIP $${symbol}: actif config — mentions déjà mutualisées, rien à payer`); continue; }
  if (!saneCashtag(symbol.toUpperCase())) { console.error(`SKIP $${symbol}: cashtag ambigu ou réservé (bruit garanti)`); continue; }
  if (tracked.some((t) => t.chain === chain && t.address === address)) { console.log(`déjà suivi: $${symbol}`); continue; }
  tracked.push({ chain, address, symbol: symbol.toUpperCase(), addedAt: today });
  console.log(`+ $${symbol} (${key}) — ~$0.15/mois`);
}
for (const key of toRemove) {
  const [chain, address] = key.split(":");
  const before = tracked.length;
  tracked = tracked.filter((t) => !(t.chain === chain && t.address === address));
  console.log(tracked.length < before ? `− ${key} retiré` : `${key}: n'était pas suivi`);
}
saveTracked(tracked);
console.log(`\nSuivis (${tracked.length}) : ${tracked.map((t) => "$" + t.symbol).join(", ") || "aucun"} · coût quotidien ≈ $${(tracked.length * 0.005).toFixed(3)}`);
