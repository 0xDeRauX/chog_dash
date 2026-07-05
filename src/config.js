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

  // ---- majors ------------------------------------------------------------
  {
    group: "majors",
    symbol: "BTC",
    chain: "bitcoin",
    coingeckoId: "bitcoin",
    xQuery: '("$BTC" OR "Bitcoin") -is:retweet',
  },
  {
    group: "majors",
    symbol: "ETH",
    chain: "ethereum",
    coingeckoId: "ethereum",
    xQuery: '("$ETH" OR "Ethereum") -is:retweet',
  },
  {
    group: "majors",
    symbol: "SOL",
    chain: "solana",
    coingeckoId: "solana",
    xQuery: '("$SOL" OR "Solana") -is:retweet',
  },
  {
    group: "majors",
    symbol: "XRP",
    chain: "xrp",
    coingeckoId: "ripple",
    xQuery: '("$XRP" OR "Ripple") -is:retweet',
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
];

export const CONFIG = {
  TWITTER_API_KEY: process.env.TWITTER_API_KEY,
  X_BEARER_TOKEN: process.env.X_BEARER_TOKEN,
};
