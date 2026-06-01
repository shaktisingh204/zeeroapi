-- Image/logo scraping: team logos on matches, sport & league logos, plus a
-- dedicated catalog table for the Images management tab.

ALTER TABLE sports  ADD COLUMN IF NOT EXISTS logo_url  TEXT;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS logo_url  TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS home_logo TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS away_logo TEXT;

-- Every distinct image we scrape, with what it belongs to.
CREATE TABLE IF NOT EXISTS images (
    url         TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,          -- sport | league | team
    name        TEXT,                   -- entity name (team/league/sport)
    seen_count  INTEGER NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_images_kind ON images(kind);
