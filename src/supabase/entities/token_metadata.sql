CREATE TABLE token_metadata (
  id SERIAL PRIMARY KEY,
  name TEXT,
  symbol TEXT,
  token_address TEXT NOT NULL,
  chain TEXT NOT NULL,
  deployed_at BIGINT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(token_address, chain)
)