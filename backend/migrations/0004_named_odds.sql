-- Page-scraped odds come with real human names (market + outcome) instead of
-- numeric group/type codes. Make the odds uniqueness name-based so both the
-- page scraper and the feed scraper dedupe correctly. group_id/type_code stay
-- as optional metadata.

DROP INDEX IF EXISTS uq_odds_line;

CREATE UNIQUE INDEX IF NOT EXISTS uq_odds_named
    ON odds (match_id, market, outcome, (COALESCE(param, 0)));

-- Tag rows with their origin so feed/page data can coexist or be filtered.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'feed';
ALTER TABLE odds    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'feed';
