-- Optional per-second rate limit. When set (> 0) it takes precedence over
-- rate_limit_per_min and the API limiter enforces a 1-second window instead of
-- the 1-minute window. NULL/0 = use the existing per-minute limit.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS rate_limit_per_sec INTEGER;
