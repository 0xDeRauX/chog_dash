// Telegram member/subscriber counts from the public t.me preview page
// (keyless). CoinGecko dropped community_data and the telegram identifiers
// from its free API in Aug 2026 (counts frozen from 2026-08-13, then empty),
// so each asset now names its official channel/group in config (`telegram`).
// Handles were picked from DexScreener's official socials and kept only when
// the count matched CoinGecko's last live value. Only the current snapshot is
// available, so the series accumulates from the first collection onward.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchTelegramMembers(handle) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`https://t.me/${handle}`, { headers: { "User-Agent": "Mozilla/5.0 (chog-dash)" } });
    if (res.ok) {
      const html = await res.text();
      // "26 799 members, 397 online" (group) or "30 603 subscribers" (channel)
      const m = html.match(/tgme_page_extra">\s*([\d\s ]+)\s+(members|subscribers)/);
      if (m) return Number(m[1].replace(/\D/g, ""));
      throw new Error(`t.me/${handle}: no member count on the page (handle renamed/private?)`);
    }
    if (attempt === 3) throw new Error(`t.me/${handle} HTTP ${res.status}`);
    await sleep(3000 * attempt);
  }
}

export async function collectAllTelegram(assets) {
  const results = [];
  for (const asset of assets) {
    if (!asset.telegram) continue;
    try {
      results.push({ symbol: asset.symbol, members: await fetchTelegramMembers(asset.telegram) });
    } catch (err) {
      console.error(`Skipped ${asset.symbol}: ${err.message}`);
    }
    await sleep(1000);
  }
  return results;
}
