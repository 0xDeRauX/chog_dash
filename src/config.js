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
    xQuery: '("CHOG" OR "$CHOG") -is:retweet',
  },
  {
    group: "memes",
    symbol: "PEPE",
    chain: "ethereum",
    coingeckoId: "pepe",
    xQuery: '("PEPE" OR "$PEPE") -is:retweet',
  },
  {
    group: "memes",
    symbol: "WIF",
    chain: "solana",
    coingeckoId: "dogwifcoin",
    xQuery: '("$WIF" OR "dogwifhat") -is:retweet',
  },
  {
    group: "memes",
    symbol: "BONK",
    chain: "solana",
    coingeckoId: "bonk",
    xQuery: '("BONK" OR "$BONK") -is:retweet',
  },
  {
    group: "memes",
    symbol: "BRETT",
    chain: "base",
    coingeckoId: "based-brett",
    xQuery: '("BRETT" OR "$BRETT") -is:retweet',
  },
  {
    group: "memes",
    symbol: "PENGU",
    chain: "solana",
    coingeckoId: "pudgy-penguins",
    xQuery: '("$PENGU" OR "Pudgy Penguins") -is:retweet',
  },
  {
    group: "memes",
    symbol: "FARTCOIN",
    chain: "solana",
    coingeckoId: "fartcoin",
    xQuery: '("$FARTCOIN" OR "Fartcoin") -is:retweet',
  },
  {
    group: "memes",
    symbol: "ANSEM",
    chain: "solana",
    coingeckoId: "the-black-bull",
    // Cashtag + the word (X search is case-insensitive, so "ANSEM" also matches
    // "ansem"). Note: this deliberately includes chatter about the influencer
    // Ansem, so the count reflects name buzz, not only the token's community.
    xQuery: '("$ANSEM" OR "ANSEM") -is:retweet',
  },

  // ---- majors ------------------------------------------------------------
  {
    group: "majors",
    symbol: "BTC",
    chain: "bitcoin",
    coingeckoId: "bitcoin",
    xQuery: '("$BTC" OR "Bitcoin" OR "btc") -is:retweet',
  },
  {
    group: "majors",
    symbol: "ETH",
    chain: "ethereum",
    coingeckoId: "ethereum",
    xQuery: '("$ETH" OR "Ethereum" OR "eth") -is:retweet',
  },
  {
    group: "majors",
    symbol: "SOL",
    chain: "solana",
    coingeckoId: "solana",
    xQuery: '("$SOL" OR "Solana" OR "sol") -is:retweet',
  },
  {
    group: "majors",
    symbol: "XRP",
    chain: "xrp",
    coingeckoId: "ripple",
    xQuery: '("$XRP" OR "Ripple" OR "xrp") -is:retweet',
  },
  {
    group: "majors",
    symbol: "SUI",
    chain: "sui",
    coingeckoId: "sui",
    xQuery: '("$SUI" OR "@SuiNetwork") -is:retweet',
  },
  {
    group: "majors",
    symbol: "MON",
    chain: "monad",
    coingeckoId: "monad",
    xQuery: '("$MON" OR "Monad") -is:retweet',
  },
  {
    group: "majors",
    symbol: "HYPE",
    chain: "hyperliquid",
    coingeckoId: "hyperliquid",
    xQuery: '("$HYPE" OR "Hyperliquid") -is:retweet',
  },
  {
    group: "majors",
    symbol: "TAO",
    chain: "bittensor",
    coingeckoId: "bittensor",
    xQuery: '("$TAO" OR "Bittensor") -is:retweet',
  },
  {
    group: "majors",
    symbol: "AKT",
    chain: "akash",
    coingeckoId: "akash-network",
    // "Akash" alone is a common first name → use the project name + cashtag.
    xQuery: '("$AKT" OR "Akash Network") -is:retweet',
  },
  {
    group: "majors",
    symbol: "STRK",
    chain: "starknet",
    coingeckoId: "starknet",
    xQuery: '("$STRK" OR "Starknet") -is:retweet',
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
};
