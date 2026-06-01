-- The JSON-feed scheduler is gone; its settings are obsolete. Replace them with
-- the page-sync controls used by the managed page-scraper supervisor.

DELETE FROM settings WHERE key IN
    ('scrape_enabled', 'prematch_interval_secs', 'live_interval_secs');

INSERT INTO settings (key, value) VALUES
    ('page_sync_enabled', 'true'),
    ('page_sync_interval', '1')
ON CONFLICT (key) DO NOTHING;
