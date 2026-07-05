// Fetches daily chain TVL history from DefiLlama's free, keyless endpoint.
// The historical endpoint already returns one point per day and includes today,
// so it doubles as both backfill and daily collection (idempotent upserts).
export async function fetchChainTvl(defillamaName) {
  const url = `https://api.llama.fi/v2/historicalChainTvl/${encodeURIComponent(defillamaName)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`DefiLlama TVL HTTP ${res.status} for ${defillamaName}: ${await res.text()}`);
  }
  const data = await res.json();
  // data = [{ date: unixSeconds, tvl: number }, ...]
  return data.map((p) => ({
    date: new Date(p.date * 1000).toISOString().slice(0, 10),
    tvl: p.tvl,
  }));
}
