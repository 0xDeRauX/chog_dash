// FULL price history for TON jettons from tonapi's on-chain rate chart — the
// whole life of the token since its first DEX trade, which beats CoinGecko's
// free 365-day cap and GeckoTerminal's ~180-day cap. Keyless. Windowed backwards
// (the endpoint returns denser points near "now"), aggregated to a daily close.
// mcap = current price × total supply (jetton metadata). Returns { series, mcap }.
const TA = "https://tonapi.io/v2";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function taJson(url) {
  for (let a = 0; ; a++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status === 500) && a < 5) { await sleep(4000 * (a + 1)); continue; }
    throw new Error(`tonapi HTTP ${res.status}`);
  }
}

export async function fetchTonPriceHistory(address, decimals = 9) {
  const now = Math.floor(Date.now() / 1000);
  const FLOOR = 1700000000; // ~2023-11-14; no TON meme older, guards the loop
  const WIN = 120 * 86400;  // 120-day windows keep good daily density
  const byDate = new Map();  // date -> { ts, price } (latest ts of the day = close)
  let end = now;
  for (let w = 0; w < 40 && end > FLOOR; w++) {
    const start = Math.max(end - WIN, FLOOR);
    let pts;
    try { pts = (await taJson(`${TA}/rates/chart?token=${address}&currency=usd&start_date=${start}&end_date=${end}`)).points || []; }
    catch (e) { if (w === 0) throw e; break; } // keep what we have if a deep window fails
    if (!pts.length) break;
    for (const [ts, price] of pts) {
      if (!(price > 0)) continue;
      const d = new Date(ts * 1000).toISOString().slice(0, 10);
      const prev = byDate.get(d);
      if (!prev || ts > prev.ts) byDate.set(d, { ts, price });
    }
    const oldest = Math.min(...pts.map((p) => p[0]));
    if (oldest > start + 2 * 86400) break; // history began inside this window → done
    end = start;
    await sleep(900);
  }
  const series = [...byDate.entries()].map(([date, v]) => ({ date, price: v.price })).sort((a, b) => a.date.localeCompare(b.date));

  let mcap = null;
  try {
    const meta = await taJson(`${TA}/jettons/${address}`);
    const dec = Number(meta.metadata?.decimals ?? decimals);
    const supply = Number(BigInt(meta.total_supply || "0")) / 10 ** dec;
    if (series.length && supply > 0) mcap = supply * series.at(-1).price;
  } catch { /* mcap optional */ }
  if (series.length && mcap != null) series[series.length - 1].marketCap = mcap;
  return { series, mcap };
}
