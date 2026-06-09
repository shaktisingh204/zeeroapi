-- Header matches.
--
-- d247 (and similar) shows a HEADER strip of matches on the game page, distinct
-- from the main body list. The /{provider}/headermatches endpoint returns this
-- set. Like `featured`, the flag is OR-merged on upsert and reset per header
-- pass (ingest `clear_header`), so it self-corrects as the strip rotates.

ALTER TABLE matches ADD COLUMN IF NOT EXISTS header BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_matches_header ON matches(provider, header) WHERE header;
