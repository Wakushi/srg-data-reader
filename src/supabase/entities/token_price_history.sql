CREATE TABLE token_price_history (
  id SERIAL PRIMARY KEY,
  token_address TEXT NOT NULL,
  chain TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  srg_balance NUMERIC NOT NULL,
  token_balance NUMERIC NOT NULL,
  internal_price_usd NUMERIC NOT NULL,
  real_price_usd NUMERIC NOT NULL,
  internal_liquidity_usd NUMERIC NOT NULL,
  real_liquidity_usd NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  volume NUMERIC NOT NULL
  UNIQUE(token_address, chain, timestamp)
);

CREATE INDEX idx_token_price_history_token_chain_timestamp 
ON token_price_history(token_address, chain, timestamp);