-- Expand odds capture to ALL markets: store the provider's raw group id (G)
-- and outcome type code (T) for every single event, not just main lines.

-- Reset odds (dev): old rows lack group/type codes and would clash with the
-- new uniqueness model. History is append-only and also reset for consistency.
TRUNCATE TABLE odds;
TRUNCATE TABLE odds_history;

ALTER TABLE odds        ADD COLUMN IF NOT EXISTS group_id  BIGINT;
ALTER TABLE odds        ADD COLUMN IF NOT EXISTS type_code BIGINT;
ALTER TABLE odds_history ADD COLUMN IF NOT EXISTS group_id  BIGINT;
ALTER TABLE odds_history ADD COLUMN IF NOT EXISTS type_code BIGINT;

-- Drop the old main-line uniqueness and key on the real provider coordinates.
ALTER TABLE odds DROP CONSTRAINT IF EXISTS odds_match_id_market_outcome_param_key;

-- A market line is uniquely identified by (match, group, type, param-line).
-- param may be NULL (e.g. 1x2) so COALESCE to a sentinel for the unique index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_odds_line
    ON odds (match_id, group_id, type_code, (COALESCE(param, 0)));

CREATE INDEX IF NOT EXISTS idx_odds_group ON odds (match_id, group_id);
