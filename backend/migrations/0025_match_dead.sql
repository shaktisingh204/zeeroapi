-- "Dead" matches: retired on a scrape sweep.
--
-- When a scraper posts a snapshot flagged `sweep`, any earlier match in the
-- same sports that is NOT in the new snapshot is marked dead and dropped from
-- the public API. Re-scraping a match revives it (the ingest upsert sets
-- dead = false). This makes each fresh scrape replace the previous live set.

ALTER TABLE matches ADD COLUMN IF NOT EXISTS dead BOOLEAN NOT NULL DEFAULT false;

-- Fast "alive matches for a provider" filtering.
CREATE INDEX IF NOT EXISTS idx_matches_alive ON matches(provider, status) WHERE NOT dead;
