CREATE TABLE srg_historical_data (
    id SERIAL PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    real_native_balance DECIMAL(18,8) NOT NULL,
    internal_native_balance DECIMAL(18,8) NOT NULL,
    native_price_usd DECIMAL(18,8) NOT NULL,
    srg_balance DECIMAL(38,0) NOT NULL,  
    internal_srg_price_usd DECIMAL(18,16) NOT NULL,
    real_price_usd DECIMAL(18,16) NOT NULL,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT idx_timestamp UNIQUE (timestamp)
);

-- Add an index on timestamp for efficient queries
CREATE INDEX idx_srg_timestamp ON srg_historical_data (timestamp);