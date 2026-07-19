CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY,
  symbol TEXT UNIQUE NOT NULL,
  chain TEXT NOT NULL,
  coingecko_id TEXT,
  x_query TEXT
);

CREATE TABLE IF NOT EXISTS mentions_daily (
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  date TEXT NOT NULL,
  mention_count INTEGER NOT NULL,
  source TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  PRIMARY KEY (asset_id, date, source)
);

CREATE TABLE IF NOT EXISTS price_daily (
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  date TEXT NOT NULL,
  price_usd REAL NOT NULL,
  change_24h REAL,
  market_cap REAL,
  volume_usd REAL,
  source TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  PRIMARY KEY (asset_id, date, source)
);

-- TVL is chain-level (shared by all tokens on that chain), so it is keyed by
-- chain, not asset.
CREATE TABLE IF NOT EXISTS tvl_daily (
  chain TEXT NOT NULL,
  date TEXT NOT NULL,
  tvl_usd REAL NOT NULL,
  PRIMARY KEY (chain, date)
);

CREATE TABLE IF NOT EXISTS discord_daily (
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  date TEXT NOT NULL,
  member_count INTEGER,
  online_count INTEGER,
  PRIMARY KEY (asset_id, date)
);

CREATE TABLE IF NOT EXISTS telegram_daily (
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  date TEXT NOT NULL,
  members INTEGER,
  PRIMARY KEY (asset_id, date)
);

CREATE TABLE IF NOT EXISTS holders_daily (
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  date TEXT NOT NULL,
  holders INTEGER,
  PRIMARY KEY (asset_id, date)
);

-- Holders bucketed by USD value of their balance ($50/$500/$5K/$50K tiers).
-- Only for tokens whose every balance we see (thirdweb ledger, Solana scans).
CREATE TABLE IF NOT EXISTS holder_tiers_daily (
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  date TEXT NOT NULL,
  lt50 INTEGER,
  t50_500 INTEGER,
  t500_5k INTEGER,
  t5k_50k INTEGER,
  gt50k INTEGER,
  PRIMARY KEY (asset_id, date)
);

-- Buy vs sell volume: USD split from Binance taker klines where listed,
-- 24h transaction counts from DexScreener otherwise.
CREATE TABLE IF NOT EXISTS tradeflow_daily (
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  date TEXT NOT NULL,
  buy_usd REAL,
  sell_usd REAL,
  buy_tx INTEGER,
  sell_tx INTEGER,
  PRIMARY KEY (asset_id, date)
);

-- Daily balance flows, only for tokens we index ourselves (thirdweb ledger),
-- where we can diff each address's balance across the day: how many balances
-- rose/fell, and how many addresses entered/left the holder set.
CREATE TABLE IF NOT EXISTS holder_flows_daily (
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  date TEXT NOT NULL,
  accumulating INTEGER,
  distributing INTEGER,
  new_holders INTEGER,
  churned INTEGER,
  PRIMARY KEY (asset_id, date)
);

-- Chain Radar: daily snapshots of the top discovered memes per chain
-- (GeckoTerminal + DexScreener + Blockscout, no config needed).
CREATE TABLE IF NOT EXISTS chain_radar_daily (
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  date TEXT NOT NULL,
  symbol TEXT,
  price REAL,
  liq REAL,
  vol REAL,
  d24 REAL,
  pools INTEGER,
  buys INTEGER,
  sells INTEGER,
  holders INTEGER,
  fdv REAL,
  age TEXT,
  pinned INTEGER,
  tg_members INTEGER,
  dc_members INTEGER,
  socials TEXT,
  crit TEXT,
  PRIMARY KEY (chain, address, date)
);

-- X mentions for radar-promoted tokens (cashtag queries, budget-capped).
CREATE TABLE IF NOT EXISTS radar_mentions_daily (
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  date TEXT NOT NULL,
  count INTEGER,
  PRIMARY KEY (chain, address, date)
);

-- Daily holder-PnL aggregates (assets with a full transfer ledger — CHOG).
-- Tranches are counts of wallets by unrealized multiple (price / avg cost).
CREATE TABLE IF NOT EXISTS pnl_daily (
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  date TEXT NOT NULL,
  holders INTEGER,
  airdrop INTEGER,
  buyers INTEGER,
  in_profit INTEGER,
  pct_in_profit REAL,
  x10 INTEGER,
  x2_10 INTEGER,
  x1_2 INTEGER,
  l0_50 INTEGER,
  l50 INTEGER,
  realized_usd REAL,
  realized_big_usd REAL,
  PRIMARY KEY (asset_id, date)
);
