import dotenv from "dotenv";
dotenv.config();

// Actifs suivis par le dashboard (CHOG au centre, comparables autour).
// Source unique de vérité pour les collecteurs (requête X, id CoinGecko, etc.)
export const ASSETS = [
  {
    symbol: "CHOG",
    chain: "monad",
    coingeckoId: null,
    xQuery: '("CHOG" OR "$CHOG") -is:retweet',
  },
  {
    symbol: "PEPE",
    chain: "ethereum",
    coingeckoId: "pepe",
    xQuery: '("PEPE" OR "$PEPE") -is:retweet',
  },
  {
    symbol: "WIF",
    chain: "solana",
    coingeckoId: "dogwifcoin",
    xQuery: '("$WIF" OR "dogwifhat") -is:retweet',
  },
  {
    symbol: "BONK",
    chain: "solana",
    coingeckoId: "bonk",
    xQuery: '("BONK" OR "$BONK") -is:retweet',
  },
  {
    symbol: "BRETT",
    chain: "base",
    coingeckoId: "based-brett",
    xQuery: '("BRETT" OR "$BRETT") -is:retweet',
  },
];

export const CONFIG = {
  TWITTER_API_KEY: process.env.TWITTER_API_KEY,
  X_BEARER_TOKEN: process.env.X_BEARER_TOKEN,
};
