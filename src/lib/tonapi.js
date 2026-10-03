// Shared tonapi.io helpers (free, keyless, ~1 req/s).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function tonapiJson(url) {
  for (let a = 0; ; a++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (res.status === 429 && a < 5) { await sleep(4000 * (a + 1)); continue; }
    throw new Error(`tonapi HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  }
}

// Every holder of a jetton: [{ address, owner, balance }]. Offset pagination
// is capped at offset 9000 (a jetton past 10K holders — UTYA since Aug 2026 —
// got HTTP 400 and was skipped whole), so walk the address-sorted cursor
// instead, which has no depth limit.
export async function tonapiAllHolders(address, { cap = 200_000 } = {}) {
  const out = [];
  let cursor = null;
  for (;;) {
    const url = new URL(`https://tonapi.io/v2/jettons/${address}/holders`);
    url.searchParams.set("limit", "1000");
    url.searchParams.set("sort_by", "address");
    if (cursor) url.searchParams.set("last_account_id", cursor);
    const page = await tonapiJson(url);
    const addrs = page.addresses || [];
    out.push(...addrs);
    if (addrs.length < 1000 || out.length >= cap) break;
    cursor = addrs.at(-1).address;
    await sleep(1100);
  }
  return out;
}
