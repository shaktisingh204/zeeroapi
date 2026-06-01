-- Auto-results: a match's winner is derived once it leaves the live feed
-- (stops updating) using its last-known score. result = W1 | Draw | W2 | NULL.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS result      TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_matches_finished ON matches(finished_at DESC) WHERE finished_at IS NOT NULL;

-- Settler config (admin-tunable on the Settings tab).
INSERT INTO settings (key, value, updated_at) VALUES
    ('result_enabled', 'true', now()),
    ('result_stale_minutes', '20', now())
ON CONFLICT (key) DO NOTHING;
