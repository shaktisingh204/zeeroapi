-- Page-level scraping: discovered site pages (from the sitemap tree / HTML
-- crawling) and what we managed to extract from each.

CREATE TABLE IF NOT EXISTS pages (
    url             TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,          -- sport | league | match | other
    sport_slug      TEXT,
    league_id       BIGINT,
    game_id         BIGINT,
    title           TEXT,                   -- parsed from HTML when reachable
    matches_found   INTEGER NOT NULL DEFAULT 0,
    odds_found      INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'discovered', -- discovered | resolved | blocked | error
    note            TEXT,
    last_crawled_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pages_kind ON pages(kind);
CREATE INDEX IF NOT EXISTS idx_pages_status ON pages(status);
