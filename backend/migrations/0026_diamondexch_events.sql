-- Dedicated table for Diamond Exch (d247). The shared matches/odds tables model
-- a sportsbook (single price per outcome); d247 is an EXCHANGE whose native feed
-- is event → markets → runners → back/lay price LEVELS with sizes and suspension.
-- Forcing that through the shared schema was lossy (collapsed levels, market-name
-- mismatch). Here we store the native shape verbatim: one row per event (gmid),
-- with the markets/runners/odds kept as JSONB exactly as the scraper read them.
-- Every diamondexch API endpoint reads from this table.
CREATE TABLE IF NOT EXISTS diamondexch_events (
    gmid        BIGINT PRIMARY KEY,                 -- d247 event id (from the detail href)
    etid        INTEGER     NOT NULL DEFAULT 0,     -- event-type / sport id (4=cricket, 1=football…)
    sport       TEXT        NOT NULL DEFAULT '',    -- sport name
    cid         BIGINT      NOT NULL DEFAULT 0,     -- competition (league) id
    cname       TEXT        NOT NULL DEFAULT '',    -- competition (league) name
    ename       TEXT        NOT NULL,               -- "Home v Away" (or event name for outrights)
    home        TEXT        NOT NULL DEFAULT '',
    away        TEXT        NOT NULL DEFAULT '',
    iplay       BOOLEAN     NOT NULL DEFAULT false, -- in-play (live)
    stime       TEXT,                               -- start time (native display string)
    suspended   BOOLEAN     NOT NULL DEFAULT false, -- whole event locked
    featured    BOOLEAN     NOT NULL DEFAULT false, -- promoted in the highlights strip
    header      BOOLEAN     NOT NULL DEFAULT false, -- shown in the header ticker
    -- Lean native markets: [{ market, gtype, suspended,
    --   runners: [{ nat, suspended, back:[{odds,size}], lay:[{odds,size}] }] }]
    markets     JSONB       NOT NULL DEFAULT '[]'::jsonb,
    source      TEXT        NOT NULL DEFAULT 'd247',
    dead        BOOLEAN     NOT NULL DEFAULT false, -- retired (no longer on the site)
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dx_events_live   ON diamondexch_events (dead, iplay, updated_at);
CREATE INDEX IF NOT EXISTS idx_dx_events_sport  ON diamondexch_events (etid, dead);
CREATE INDEX IF NOT EXISTS idx_dx_events_susp   ON diamondexch_events (dead, suspended);
