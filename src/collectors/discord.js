// Fetches a Discord server's member counts from the public invite endpoint.
// No bot, no admin, no auth — just a valid invite code / vanity. Only the
// current snapshot is available (no history), so counts accumulate from the
// first collection onward.
export async function fetchDiscordCounts(inviteCode) {
  const url = `https://discord.com/api/v10/invites/${encodeURIComponent(inviteCode)}?with_counts=true`;
  const res = await fetch(url, { headers: { "User-Agent": "chog-dash/1.0" } });
  if (!res.ok) {
    throw new Error(`Discord invite HTTP ${res.status} for ${inviteCode}: ${await res.text()}`);
  }
  const data = await res.json();
  return {
    memberCount: data.approximate_member_count ?? null,
    onlineCount: data.approximate_presence_count ?? null,
    guildName: data.guild?.name ?? null,
  };
}

export async function collectAllDiscord(assets) {
  const results = [];
  for (const asset of assets) {
    if (!asset.discordInvite) continue;
    try {
      const c = await fetchDiscordCounts(asset.discordInvite);
      results.push({ symbol: asset.symbol, invite: asset.discordInvite, ...c });
    } catch (err) {
      console.error(`Skipped ${asset.symbol}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 400)); // be gentle
  }
  return results;
}
