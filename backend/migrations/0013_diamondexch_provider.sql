-- New provider: Diamond Exch (d247.com). A betting-exchange platform distinct
-- from the melbet-family skins, so it ships disabled (no scraper wired yet) —
-- it appears in the admin Providers tab and the provider-scoped public API as a
-- catalog entry, ready to enable once data ingestion is built for it.
INSERT INTO providers (slug, name, base_url, is_active, capabilities) VALUES
    ('diamondexch', 'Diamond Exch', 'https://d247.com', FALSE,
     '["sports","leagues","matches","live","odds"]')
ON CONFLICT (slug) DO UPDATE
    SET name = EXCLUDED.name, base_url = EXCLUDED.base_url;
