-- Multi-provider SaaS: providers, subscription plans, API customers, API keys,
-- and provider tagging on all scraped data.

-- ---------------------------------------------------------------------------
-- Providers (scraping sources). melbet is first; the rest are 1xbet-family
-- skins that reuse the same scraper, shipped disabled until enabled.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS providers (
    slug        TEXT PRIMARY KEY,           -- 'melbet', '1xbet', ...
    name        TEXT NOT NULL,
    base_url    TEXT NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO providers (slug, name, base_url, is_active) VALUES
    ('melbet',    'MelBet',    'https://india.melbet.com', TRUE),
    ('1xbet',     '1xBet',     'https://1xbet.com',        FALSE),
    ('betwinner', 'BetWinner', 'https://betwinner.com',    FALSE),
    ('1win',      '1Win',      'https://1win.com',         FALSE),
    ('megapari',  'MegaPari',  'https://megapari.com',     FALSE)
ON CONFLICT (slug) DO NOTHING;

-- Tag all scraped data with its provider.
ALTER TABLE sports  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'melbet';
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'melbet';
ALTER TABLE matches ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'melbet';
ALTER TABLE odds    ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'melbet';
CREATE INDEX IF NOT EXISTS idx_matches_provider ON matches(provider);

-- ---------------------------------------------------------------------------
-- Subscription plans
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
    slug                TEXT PRIMARY KEY,    -- free | pro | enterprise
    name                TEXT NOT NULL,
    price_cents         INTEGER NOT NULL DEFAULT 0,   -- per month
    rate_limit_per_min  INTEGER NOT NULL,
    monthly_quota       INTEGER NOT NULL,    -- -1 = unlimited
    features            JSONB NOT NULL DEFAULT '[]',
    sort_order          INTEGER NOT NULL DEFAULT 0
);
INSERT INTO plans (slug, name, price_cents, rate_limit_per_min, monthly_quota, features, sort_order) VALUES
    ('free',       'Free',        0,     60,    10000,
        '["1 provider","Live scores & odds","Community support"]', 1),
    ('pro',        'Pro',         4900,  600,   1000000,
        '["All providers","Live + prematch + full markets","Odds history","Email support"]', 2),
    ('enterprise', 'Enterprise',  49900, 6000,  -1,
        '["All providers","Unlimited requests","Webhooks (planned)","Priority support","SLA"]', 3)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- API customers (consumers of the public API — distinct from admin users)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email         TEXT NOT NULL UNIQUE,
    name          TEXT,
    password_hash TEXT,                       -- for the (planned) self-serve portal
    plan_slug     TEXT NOT NULL DEFAULT 'free' REFERENCES plans(slug),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- API keys. We store only a SHA-256 hash; the full key is shown once.
-- key_prefix is the visible identifier (e.g. 'mk_live_3f9a').
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id  UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    name         TEXT,
    key_prefix   TEXT NOT NULL,
    key_hash     TEXT NOT NULL UNIQUE,
    revoked      BOOLEAN NOT NULL DEFAULT FALSE,
    last_used_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash) WHERE NOT revoked;
CREATE INDEX IF NOT EXISTS idx_api_keys_customer ON api_keys(customer_id);
