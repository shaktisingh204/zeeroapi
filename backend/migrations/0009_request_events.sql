-- Durable per-request usage log + daily rollups. This is the analytical source
-- of truth that powers per-endpoint / status-class / latency / provider
-- analytics in both the customer portal and the admin console, and feeds
-- usage-based billing. The hot-path Redis counters (rl:/quota:/usage:day) stay
-- as-is for rate-limiting; this table is written off the request path.

CREATE TABLE IF NOT EXISTS request_events (
    id          BIGSERIAL PRIMARY KEY,
    customer_id UUID NOT NULL,
    api_key_id  UUID,
    provider    TEXT,                       -- 'melbet', ... or NULL for meta endpoints
    endpoint    TEXT NOT NULL,              -- normalized: 'matches', 'matches/:id', 'live', ...
    method      TEXT NOT NULL,
    status_code INT  NOT NULL,
    latency_ms  INT  NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_req_events_customer ON request_events(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_req_events_created  ON request_events(created_at);

-- Pre-aggregated daily counts per (customer, day, provider, endpoint, status_class).
-- status_class is the leading HTTP digit (2/4/5). latency_sum / count = mean latency.
CREATE TABLE IF NOT EXISTS usage_rollup (
    customer_id  UUID     NOT NULL,
    day          DATE     NOT NULL,
    provider     TEXT     NOT NULL DEFAULT '',
    endpoint     TEXT     NOT NULL DEFAULT '',
    status_class SMALLINT NOT NULL DEFAULT 2,
    count        BIGINT   NOT NULL DEFAULT 0,
    latency_sum  BIGINT   NOT NULL DEFAULT 0,
    PRIMARY KEY (customer_id, day, provider, endpoint, status_class)
);
CREATE INDEX IF NOT EXISTS idx_usage_rollup_day ON usage_rollup(day);

-- Watermark so the rollup job only folds new events.
CREATE TABLE IF NOT EXISTS rollup_state (
    id              INT PRIMARY KEY DEFAULT 1,
    last_event_id   BIGINT NOT NULL DEFAULT 0
);
INSERT INTO rollup_state (id, last_event_id) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
