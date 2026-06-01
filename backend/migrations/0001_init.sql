-- Core schema for the melbet SaaS scraper/admin platform.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Auth
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'admin', -- admin | editor | viewer
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Catalog: sports -> leagues (champs) -> matches -> odds
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sports (
    id           BIGINT PRIMARY KEY,          -- provider sport id
    name         TEXT NOT NULL,
    slug         TEXT NOT NULL,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    match_count  INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leagues (
    id           BIGINT PRIMARY KEY,          -- provider champ id
    sport_id     BIGINT NOT NULL REFERENCES sports(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    country      TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leagues_sport ON leagues(sport_id);

CREATE TABLE IF NOT EXISTS matches (
    id           BIGINT PRIMARY KEY,          -- provider game/event id
    sport_id     BIGINT NOT NULL REFERENCES sports(id) ON DELETE CASCADE,
    league_id    BIGINT REFERENCES leagues(id) ON DELETE SET NULL,
    home_team    TEXT NOT NULL,
    away_team    TEXT NOT NULL,
    start_time   TIMESTAMPTZ,
    status       TEXT NOT NULL DEFAULT 'prematch', -- prematch | live | finished
    home_score   INTEGER,
    away_score   INTEGER,
    period       TEXT,                        -- e.g. "2nd half", "Set 3"
    match_time   TEXT,                        -- e.g. "67'"
    raw          JSONB,                       -- last raw payload for debugging
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_matches_sport ON matches(sport_id);
CREATE INDEX IF NOT EXISTS idx_matches_league ON matches(league_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_start ON matches(start_time);

CREATE TABLE IF NOT EXISTS odds (
    id           BIGSERIAL PRIMARY KEY,
    match_id     BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    market       TEXT NOT NULL,               -- e.g. "1x2", "Total", "Handicap"
    outcome      TEXT NOT NULL,               -- e.g. "W1", "X", "W2", "Over 2.5"
    value        NUMERIC(10,3) NOT NULL,      -- decimal odds
    param        NUMERIC(10,3),               -- line param (total/handicap)
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (match_id, market, outcome, param)
);
CREATE INDEX IF NOT EXISTS idx_odds_match ON odds(match_id);

-- Historical odds movements (for charts / line history)
CREATE TABLE IF NOT EXISTS odds_history (
    id           BIGSERIAL PRIMARY KEY,
    match_id     BIGINT NOT NULL,
    market       TEXT NOT NULL,
    outcome      TEXT NOT NULL,
    value        NUMERIC(10,3) NOT NULL,
    param        NUMERIC(10,3),
    recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_odds_history_match ON odds_history(match_id, recorded_at);

-- ---------------------------------------------------------------------------
-- Operations: scrape jobs + logs + settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scrape_logs (
    id            BIGSERIAL PRIMARY KEY,
    job           TEXT NOT NULL,              -- sports | prematch | live
    status        TEXT NOT NULL,              -- success | error
    items         INTEGER NOT NULL DEFAULT 0,
    duration_ms   BIGINT NOT NULL DEFAULT 0,
    message       TEXT,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scrape_logs_started ON scrape_logs(started_at DESC);

CREATE TABLE IF NOT EXISTS settings (
    key          TEXT PRIMARY KEY,
    value        TEXT NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value) VALUES
    ('scrape_enabled', 'true'),
    ('prematch_interval_secs', '300'),
    ('live_interval_secs', '20')
ON CONFLICT (key) DO NOTHING;
