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
