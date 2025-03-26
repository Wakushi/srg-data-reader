CREATE TABLE srg_price_history (
    id SERIAL PRIMARY KEY,
    token_address TEXT NOT NULL,
    chain TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    real_native_balance DECIMAL(18,8) NOT NULL,
    internal_native_balance DECIMAL(18,8) NOT NULL,
    native_price_usd DECIMAL(18,8) NOT NULL,
    srg_balance DECIMAL(38,0) NOT NULL,  
    internal_srg_price_usd DECIMAL(18,16) NOT NULL,
    real_price_usd DECIMAL(18,16) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT idx_timestamp UNIQUE (timestamp)
);

CREATE INDEX idx_srg_price_lookup ON srg_price_history (token_address, chain, timestamp DESC);