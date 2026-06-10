-- Full d247 sports catalog (the left "All Sports" list — ~37 entries), so the
-- diamondexch /sports + /sidebar show EVERY sport the site offers, not just the
-- few that happen to have live matches right now (those come from the events
-- table). Keyed by name; etid is best-effort from the sidebar link (events
-- supply the authoritative etid for sports that do have matches).
CREATE TABLE IF NOT EXISTS diamondexch_sports (
    name        TEXT PRIMARY KEY,
    etid        INTEGER     NOT NULL DEFAULT 0,
    dead        BOOLEAN     NOT NULL DEFAULT false,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
