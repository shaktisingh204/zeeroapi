-- Provider-native odds fields.
--
-- Different providers expose fundamentally different data:
--   * Exchanges (d247 / diamondexch) quote BACK and LAY prices with matched
--     VOLUME, and SUSPEND markets in-play (the padlock).
--   * Sportsbooks (melbet / 1xbet family / 1win / bcgame) quote a single price
--     and can BLOCK an outcome.
-- These columns let every provider's native shape be stored faithfully while
-- keeping the existing single-price `value` working unchanged. All are
-- nullable/defaulted, so existing rows and existing scrapers are unaffected.

ALTER TABLE matches ADD COLUMN IF NOT EXISTS suspended BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE odds ADD COLUMN IF NOT EXISTS lay       NUMERIC(12,3);
ALTER TABLE odds ADD COLUMN IF NOT EXISTS volume    NUMERIC(16,2);
ALTER TABLE odds ADD COLUMN IF NOT EXISTS suspended BOOLEAN NOT NULL DEFAULT false;

-- Fast "what is live and not suspended" filtering.
CREATE INDEX IF NOT EXISTS idx_matches_suspended ON matches(suspended);
