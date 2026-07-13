import dotenv from "dotenv";
// quiet: true suppresses dotenv's console "tips", which since v17 include
// unsolicited ads for the maintainer's other product (vestauth.com) mixed
// into stdout — noise at best, a supply-chain prompt-injection vector for
// AI coding agents at worst.
dotenv.config({ quiet: true });

// Two comparison universes:
//  - "memes": CHOG (Monad memecoin) vs other-chain memecoins.
//  - "majors": large caps, to compare communities across ecosystems.
// One flat list (collectors iterate it uniformly); `group` splits the dashboard.
export const ASSETS = [
  // ---- memes -------------------------------------------------------------
  {
    group: "memes",
    symbol: "CHOG",
    chain: "monad",
    coingeckoId: "chog",
    xQuery: '("CHOG" OR "$CHOG" OR "@ChogNFT" OR "@chog_xyz") -is:retweet',
    // Discord invite code / vanity (member count is public via the invite API,
    // no bot/admin needed). Add one per project to compare communities.
    discordInvite: "chog",
    // Holder count. Monad has no free holder API, so we index Transfer events
    // via thirdweb Insight and reconstruct balances (incremental, state cached).
    holders: { source: "thirdweb", chainId: 143, contract: "0x350035555e10d9afaf1566aaebfced5ba6c27777", startBlock: 37000000, decimals: 18 },
  },
  {
    group: "memes",
    symbol: "PEPE",
    chain: "ethereum",
    coingeckoId: "pepe",
    xQuery: '("PEPE" OR "$PEPE" OR "@pepecoineth") -is:retweet',
    // Ethereum runs a public Blockscout that returns holder count in one call.
    holders: { source: "blockscout", base: "https://eth.blockscout.com", contract: "0x6982508145454ce325ddbe47a25d4ec3d2311933" },
  },
  {
    group: "memes",
    symbol: "WIF",
    chain: "solana",
    coingeckoId: "dogwifcoin",
    xQuery: '("$WIF" OR "dogwifhat") -is:retweet',
    // Solana has no free holder API, so we count SPL token accounts on-chain
    // via a public RPC (keyless). program defaults to the classic Token program.
    holders: { source: "solana", mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  },
  {
    group: "memes",
    symbol: "BONK",
    chain: "solana",
    coingeckoId: "bonk",
    xQuery: '("BONK" OR "$BONK" OR "@bonk_inu") -is:retweet',
    discordInvite: "qaQa6M6mN2",
    holders: { source: "solana", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  },
  {
    group: "memes",
    symbol: "BRETT",
    chain: "base",
    coingeckoId: "based-brett",
    xQuery: '("BRETT" OR "$BRETT" OR "@BasedBrett") -is:retweet',
    // Base runs a public Blockscout with a holder count. (Note: some ISPs, e.g.
    // SFR, wrongly block base.blockscout.com — it resolves fine from CI.)
    holders: { source: "blockscout", base: "https://base.blockscout.com", contract: "0x532f27101965dd16442E59d40670FaF5eBB142E4" },
  },
  {
    group: "memes",
    symbol: "PENGU",
    chain: "solana",
    coingeckoId: "pudgy-penguins",
    xQuery: '("$PENGU" OR "Pudgy Penguins" OR "@pudgypenguins") -is:retweet',
    discordInvite: "pudgypenguins",
    holders: { source: "solana", mint: "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv" },
  },
  {
    group: "memes",
    symbol: "FARTCOIN",
    chain: "solana",
    coingeckoId: "fartcoin",
    xQuery: '("$FARTCOIN" OR "Fartcoin" OR "@FartCoinOfSOL") -is:retweet',
    holders: { source: "solana", mint: "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump" },
  },
  {
    group: "memes",
    symbol: "ANSEM",
    chain: "solana",
    coingeckoId: "the-black-bull",
    // Cashtag + the word (X search is case-insensitive, so "ANSEM" also matches
    // "ansem"). Note: this deliberately includes chatter about the influencer
    // Ansem, so the count reflects name buzz, not only the token's community.
    xQuery: '("$ANSEM" OR "ANSEM" OR "@blknoiz06") -is:retweet',
    // Minted on pump.fun with the newer Token-2022 program (not classic SPL).
    holders: { source: "solana", mint: "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump", program: "token-2022" },
  },
  {
    group: "memes",
    symbol: "CASHCAT",
    chain: "robinhood",
    coingeckoId: "cash-cat",
    xQuery: '("$CASHCAT" OR "Cash Cat" OR "CashCat") -is:retweet',
    // Robinhood Chain (chainId 4663) runs a public Blockscout with a holder
    // count in one call — same path as PEPE/BRETT.
    holders: { source: "blockscout", base: "https://robinhoodchain.blockscout.com", contract: "0x020bfc650a365f8bb26819deaabf3e21291018b4" },
  },

  // ---- majors ------------------------------------------------------------
  {
    group: "majors",
    symbol: "BTC",
    chain: "bitcoin",
    coingeckoId: "bitcoin",
    xQuery: '("$BTC" OR "Bitcoin" OR "btc") -is:retweet',
    // Native-coin "holders" = addresses with a non-zero balance (Coinmetrics).
    holders: { source: "coinmetrics", cmAsset: "btc" },
  },
  {
    group: "majors",
    symbol: "ETH",
    chain: "ethereum",
    coingeckoId: "ethereum",
    xQuery: '("$ETH" OR "Ethereum" OR "eth" OR "@ethereum") -is:retweet',
    discordInvite: "ethereum-org",
    holders: { source: "coinmetrics", cmAsset: "eth" },
  },
  {
    group: "majors",
    symbol: "SOL",
    chain: "solana",
    coingeckoId: "solana",
    xQuery: '("$SOL" OR "Solana" OR "@solana") -is:retweet',
    discordInvite: "solana",
  },
  {
    group: "majors",
    symbol: "XRP",
    chain: "xrp",
    coingeckoId: "ripple",
    xQuery: '("$XRP" OR "Ripple" OR "xrp" OR "@ripple") -is:retweet',
    discordInvite: "xrpl",
    holders: { source: "coinmetrics", cmAsset: "xrp" },
  },
  {
    group: "majors",
    symbol: "SUI",
    chain: "sui",
    coingeckoId: "sui",
    xQuery: '("$SUI" OR "@SuiNetwork") -is:retweet',
    discordInvite: "sui",
  },
  {
    group: "majors",
    symbol: "MON",
    chain: "monad",
    coingeckoId: "monad",
    xQuery: '("$MON" OR "Monad" OR "@monad") -is:retweet',
    discordInvite: "monad",
  },
  {
    group: "majors",
    symbol: "HYPE",
    chain: "hyperliquid",
    coingeckoId: "hyperliquid",
    xQuery: '("$HYPE" OR "Hyperliquid" OR "@HyperliquidX") -is:retweet',
    discordInvite: "hyperliquid",
    holders: { source: "hypurrscan", token: "HYPE" },
  },
  {
    group: "majors",
    symbol: "TAO",
    chain: "bittensor",
    coingeckoId: "bittensor",
    xQuery: '("$TAO" OR "Bittensor" OR "@bittensor") -is:retweet',
    discordInvite: "5MGtAz5kW",
  },
  {
    group: "majors",
    symbol: "AKT",
    chain: "akash",
    coingeckoId: "akash-network",
    // "Akash" alone is a common first name → use the project name + cashtag.
    xQuery: '("$AKT" OR "Akash Network" OR "@akashnet") -is:retweet',
    discordInvite: "akash",
    // Cosmos SDK: total account count via the auth module (public LCD, keyless).
    holders: { source: "cosmos", lcds: ["https://akash-api.polkachu.com", "https://rest-akash.ecostake.com"] },
  },
  {
    group: "majors",
    symbol: "STRK",
    chain: "starknet",
    coingeckoId: "starknet",
    xQuery: '("$STRK" OR "Starknet" OR "@starknet") -is:retweet',
    discordInvite: "starknet",
  },
];

// Maps each asset's `chain` to its DefiLlama chain name for TVL lookups.
// TVL is a chain-level metric, so tokens sharing a chain share one TVL series
// (e.g. WIF/BONK/SOL all → Solana). null = no meaningful DeFi TVL (e.g. Akash,
// a compute network), rendered as "—".
export const CHAINS = {
  monad: "Monad",
  ethereum: "Ethereum",
  solana: "Solana",
  base: "Base",
  robinhood: "Robinhood Chain",
  sui: "Sui",
  bitcoin: "Bitcoin",
  xrp: "XRPL",
  hyperliquid: "Hyperliquid L1",
  bittensor: "Bittensor",
  akash: null,
  starknet: "Starknet",
};

export const CONFIG = {
  TWITTER_API_KEY: process.env.TWITTER_API_KEY,
  X_BEARER_TOKEN: process.env.X_BEARER_TOKEN,
  THIRDWEB_SECRET_KEY: process.env.THIRDWEB_SECRET_KEY,
  // Optional: a dedicated Solana RPC (higher rate limits than public ones) for
  // the keyless holder count. Falls back to public RPCs if unset.
  SOL_RPC: process.env.SOL_RPC,
};
