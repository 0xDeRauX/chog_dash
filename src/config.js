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
    flow: { net: "monad", addr: "0x350035555e10d9afaf1566aaebfced5ba6c27777" }, // on-chain buy/sell (GeckoTerminal, tous pools DEX)
    gtNetwork: "monad", // GeckoTerminal: aggregate 24h trades -> real $ buy/sell split
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
    flow: { net: "eth", addr: "0x6982508145454ce325ddbe47a25d4ec3d2311933" }, // on-chain buy/sell (GeckoTerminal, tous pools DEX)
    binance: "PEPEUSDT", // spot pair for buy/sell volume (taker klines)
    chain: "ethereum",
    coingeckoId: "pepe",
    xQuery: '("PEPE" OR "$PEPE" OR "@pepecoineth") -is:retweet',
    // Ethereum runs a public Blockscout that returns holder count in one call.
    holders: { source: "blockscout", base: "https://eth.blockscout.com", contract: "0x6982508145454ce325ddbe47a25d4ec3d2311933" },
  },
  {
    group: "memes",
    symbol: "WIF",
    flow: { net: "solana", addr: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" }, // on-chain buy/sell (GeckoTerminal, tous pools DEX)
    binance: "WIFUSDT", // spot pair for buy/sell volume (taker klines)
    chain: "solana",
    coingeckoId: "dogwifcoin",
    xQuery: '("$WIF" OR "dogwifhat") -is:retweet',
    // Solana has no free holder API, so we count SPL token accounts on-chain
    // via a public RPC (keyless). program defaults to the classic Token program.
    holders: { source: "solana", mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", decimals: 6 },
  },
  {
    group: "memes",
    symbol: "BONK",
    flow: { net: "solana", addr: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" }, // on-chain buy/sell (GeckoTerminal, tous pools DEX)
    binance: "BONKUSDT", // spot pair for buy/sell volume (taker klines)
    chain: "solana",
    coingeckoId: "bonk",
    xQuery: '("BONK" OR "$BONK" OR "@bonk_inu") -is:retweet',
    discordInvite: "qaQa6M6mN2",
    holders: { source: "solana", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", decimals: 5 },
  },
  {
    group: "memes",
    symbol: "BRETT",
    flow: { net: "base", addr: "0x532f27101965dd16442E59d40670FaF5eBB142E4" }, // on-chain buy/sell (GeckoTerminal, tous pools DEX)
    gtNetwork: "base",
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
    flow: { net: "solana", addr: "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv" }, // on-chain buy/sell (GeckoTerminal, tous pools DEX)
    binance: "PENGUUSDT", // spot pair for buy/sell volume (taker klines)
    chain: "solana",
    coingeckoId: "pudgy-penguins",
    xQuery: '("$PENGU" OR "Pudgy Penguins" OR "@pudgypenguins") -is:retweet',
    discordInvite: "pudgypenguins",
    holders: { source: "solana", mint: "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv", decimals: 6 },
  },
  {
    group: "memes",
    symbol: "FARTCOIN",
    flow: { net: "solana", addr: "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump" }, // on-chain buy/sell (GeckoTerminal, tous pools DEX)
    binancePerp: "FARTCOINUSDT", // no spot pair -> perp taker klines for buy/sell volume
    chain: "solana",
    coingeckoId: "fartcoin",
    xQuery: '("$FARTCOIN" OR "Fartcoin" OR "@FartCoinOfSOL") -is:retweet',
    holders: { source: "solana", mint: "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump", decimals: 6 },
  },
  {
    group: "memes",
    symbol: "ANSEM",
    flow: { net: "solana", addr: "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump" }, // on-chain buy/sell (GeckoTerminal, tous pools DEX)
    chain: "solana",
    coingeckoId: "the-black-bull",
    // Cashtag + the word (X search is case-insensitive, so "ANSEM" also matches
    // "ansem"). Note: this deliberately includes chatter about the influencer
    // Ansem, so the count reflects name buzz, not only the token's community.
    xQuery: '("$ANSEM" OR "ANSEM" OR "@blknoiz06") -is:retweet',
    // Minted on pump.fun with the newer Token-2022 program (not classic SPL).
    holders: { source: "solana", mint: "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump", decimals: 6, program: "token-2022" },
  },
  {
    group: "memes",
    symbol: "CASHCAT",
    flow: { net: "robinhood", addr: "0x020bfc650a365f8bb26819deaabf3e21291018b4" }, // on-chain buy/sell (GeckoTerminal, tous pools DEX)
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
    binance: "BTCUSDT", // spot pair for buy/sell volume (taker klines)
    chain: "bitcoin",
    coingeckoId: "bitcoin",
    xQuery: '("$BTC" OR "Bitcoin" OR "btc") -is:retweet',
    // Native-coin "holders" = addresses with a non-zero balance (Coinmetrics).
    holders: { source: "coinmetrics", cmAsset: "btc" },
  },
  {
    group: "majors",
    symbol: "ETH",
    flow: { net: "eth", addr: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" }, // on-chain buy/sell (GeckoTerminal, tous pools DEX)
    binance: "ETHUSDT", // spot pair for buy/sell volume (taker klines)
    chain: "ethereum",
    coingeckoId: "ethereum",
    xQuery: '("$ETH" OR "Ethereum" OR "eth" OR "@ethereum") -is:retweet',
    discordInvite: "ethereum-org",
    holders: { source: "coinmetrics", cmAsset: "eth" },
  },
  {
    group: "majors",
    symbol: "SOL",
    flow: { net: "solana", addr: "So11111111111111111111111111111111111111112" }, // on-chain buy/sell (GeckoTerminal, tous pools DEX)
    binance: "SOLUSDT", // spot pair for buy/sell volume (taker klines)
    chain: "solana",
    coingeckoId: "solana",
    xQuery: '("$SOL" OR "Solana" OR "@solana") -is:retweet',
    discordInvite: "solana",
  },
  {
    group: "majors",
    symbol: "XRP",
    binance: "XRPUSDT", // spot pair for buy/sell volume (taker klines)
    chain: "xrp",
    coingeckoId: "ripple",
    xQuery: '("$XRP" OR "Ripple" OR "xrp" OR "@ripple") -is:retweet',
    discordInvite: "xrpl",
    holders: { source: "coinmetrics", cmAsset: "xrp" },
  },
  {
    group: "majors",
    symbol: "SUI",
    binance: "SUIUSDT", // spot pair for buy/sell volume (taker klines)
    chain: "sui",
    coingeckoId: "sui",
    xQuery: '("$SUI" OR "@SuiNetwork") -is:retweet',
    discordInvite: "sui",
    // Blockvision exposes native SUI holders via coin/detail (full coinType).
    holders: { source: "blockvision-sui", coinType: "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI" },
  },
  {
    group: "majors",
    symbol: "MON",
    binancePerp: "MONUSDT", // no spot pair -> perp taker klines for buy/sell volume
    chain: "monad",
    coingeckoId: "monad",
    xQuery: '("$MON" OR "Monad" OR "@monad") -is:retweet',
    discordInvite: "monad",
  },
  {
    group: "majors",
    symbol: "HYPE",
    binancePerp: "HYPEUSDT", // no spot pair -> perp taker klines for buy/sell volume
    chain: "hyperliquid",
    coingeckoId: "hyperliquid",
    xQuery: '("$HYPE" OR "Hyperliquid" OR "@HyperliquidX") -is:retweet',
    discordInvite: "hyperliquid",
    holders: { source: "hypurrscan", token: "HYPE" },
  },
  {
    group: "majors",
    symbol: "TAO",
    binance: "TAOUSDT", // spot pair for buy/sell volume (taker klines)
    chain: "bittensor",
    coingeckoId: "bittensor",
    xQuery: '("$TAO" OR "Bittensor" OR "@bittensor") -is:retweet',
    discordInvite: "5MGtAz5kW",
    // Bittensor account count = holders (taostats, free key).
    holders: { source: "taostats" },
  },
  {
    group: "majors",
    symbol: "AKT",
    binancePerp: "AKTUSDT", // no spot pair -> perp taker klines for buy/sell volume
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
    binance: "STRKUSDT", // spot pair for buy/sell volume (taker klines)
    chain: "starknet",
    coingeckoId: "starknet",
    xQuery: '("$STRK" OR "Starknet" OR "@starknet") -is:retweet',
    discordInvite: "starknet",
  },
  {
    group: "majors",
    symbol: "ZEC",
    binance: "ZECUSDT", // spot pair for buy/sell volume (taker klines)
    chain: "zcash",
    coingeckoId: "zcash",
    xQuery: '("$ZEC" OR "Zcash" OR "@Zcash") -is:retweet',
    discordInvite: "zcash",
    // Transparent-address balance count (shielded addresses aren't counted).
    holders: { source: "coinmetrics", cmAsset: "zec" },
  },
  {
    group: "majors",
    symbol: "ONDO",
    flow: { net: "eth", addr: "0xfAbA6f8e4a5E8Ab82F62fe7C39859FA577269BE3" }, // on-chain buy/sell (GeckoTerminal, tous pools DEX)
    binance: "ONDOUSDT", // spot pair for buy/sell volume (taker klines)
    chain: "ethereum",
    coingeckoId: "ondo-finance",
    // "Ondo" alone is a common word/name → use the project name + cashtag.
    xQuery: '("$ONDO" OR "Ondo Finance" OR "@OndoFinance") -is:retweet',
    discordInvite: "ondofinance",
    // ERC-20 on Ethereum → Blockscout holder count.
    holders: { source: "blockscout", base: "https://eth.blockscout.com", contract: "0xfAbA6f8e4a5E8Ab82F62fe7C39859FA577269BE3" },
  },
  {
    group: "majors",
    symbol: "XMR",
    chain: "monero",
    coingeckoId: "monero",
    xQuery: '("$XMR" OR "Monero" OR "@monero") -is:retweet',
    // Privacy coin: no buy/sell (delisted from Binance, no OKX perp), no
    // holder count (shielded balances), no CoinGecko-tracked Telegram.
  },
  {
    group: "majors",
    symbol: "NEAR",
    binance: "NEARUSDT", // spot pair for buy/sell volume (taker klines)
    chain: "near",
    coingeckoId: "near",
    // "NEAR" alone is a common English word → use the project name + cashtag.
    xQuery: '("$NEAR" OR "@NEARProtocol" OR "NEAR Protocol") -is:retweet',
    discordInvite: "nearprotocol",
    // No holder count: NEAR's account total is dominated by ~300M app/spam
    // accounts (SWEAT etc.) with zero balance — not comparable to the
    // balance-holder counts used for BTC/ETH/XRP. Kept honest as "—".
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
  zcash: "Zcash",
  monero: "Monero",
  near: "NEAR",
};

export const CONFIG = {
  TWITTER_API_KEY: process.env.TWITTER_API_KEY,
  X_BEARER_TOKEN: process.env.X_BEARER_TOKEN,
  THIRDWEB_SECRET_KEY: process.env.THIRDWEB_SECRET_KEY,
  HYPERSYNC_API_KEY: process.env.HYPERSYNC_API_KEY, // Envio HyperRPC (Monad logs)
  // Optional dedicated Solana RPC for the SPL holder counts. Note: Helius's free
  // tier rejects the large getProgramAccounts these need (e.g. BONK ~485MB), so
  // the public mainnet-beta endpoint is actually the reliable default here.
  SOL_RPC: process.env.SOL_RPC,
  // Native-coin holder counts that need a free API key.
  TAOSTATS_API_KEY: process.env.TAOSTATS_API_KEY,          // TAO (Bittensor)
  BLOCKVISION_SUI_KEY: process.env.blockvision_api_key_sui, // SUI
  BLOCKVISION_MONAD_KEY: process.env.blockvision_api_key_monad, // MON (reserved)
};
