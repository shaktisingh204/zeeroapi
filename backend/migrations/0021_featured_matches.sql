-- Featured / highlighted events.
--
-- Providers promote a rotating strip of events at the top of their home page
-- (d247's "FIFA WORLD CUP - WINNER 2026", featured matches, special markets).
-- The featured scraper marks these; the /{provider}/featured endpoint returns
-- the current set. `featured` is OR-merged on upsert and reset per featured
-- pass (see the ingest `clear_featured` flag), so the flag self-corrects as the
-- promoted strip rotates.

ALTER TABLE matches ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_matches_featured ON matches(provider, featured) WHERE featured;
