-- Public status page incidents + product changelog (both admin-editable).

CREATE TABLE IF NOT EXISTS incidents (
    id          BIGSERIAL PRIMARY KEY,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    severity    TEXT NOT NULL DEFAULT 'minor',   -- minor|major|critical
    status      TEXT NOT NULL DEFAULT 'investigating', -- investigating|identified|monitoring|resolved
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_incidents_started ON incidents(started_at DESC);

CREATE TABLE IF NOT EXISTS changelog (
    id          BIGSERIAL PRIMARY KEY,
    version     TEXT,                            -- e.g. 'v1.4.0' (optional)
    title       TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    tag         TEXT NOT NULL DEFAULT 'improvement', -- feature|fix|improvement|breaking|deprecation
    published_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_changelog_published ON changelog(published_at DESC);

INSERT INTO changelog (version, title, body, tag) VALUES
    ('v1.0.0', 'Public API launched', 'Provider-scoped sports, leagues, matches, live scores and odds with API-key auth, rate limits and monthly quotas.', 'feature')
ON CONFLICT DO NOTHING;
