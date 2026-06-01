-- Granular API-key scoping: restrict a key to specific providers, source IPs,
-- and/or an expiry. NULL/empty = unrestricted (back-compat with existing keys).
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS allowed_providers TEXT[];
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS allowed_ips       TEXT[];
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expires_at        TIMESTAMPTZ;

-- Per-customer usage-alert threshold (% of monthly quota). Surfaced as an
-- in-portal banner when crossed.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS alert_threshold INT NOT NULL DEFAULT 80;
