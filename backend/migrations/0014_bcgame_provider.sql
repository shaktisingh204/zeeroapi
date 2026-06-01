-- New provider: BC.Game (crypto sportsbook & casino). Primary domain bc.game,
-- with many mirror domains (hash.game, bc.fun, bc.app, bcga.me, bcgame.ph/im/ai,
-- bc.casino, bcigra.com, linkbc.net, playbc.co). Ships disabled until its
-- scraper is wired; appears in the admin Providers tab + provider-scoped API.
INSERT INTO providers (slug, name, base_url, is_active, capabilities) VALUES
    ('bcgame', 'BC.Game', 'https://bc.game', FALSE,
     '["sports","leagues","matches","live","odds"]')
ON CONFLICT (slug) DO UPDATE
    SET name = EXCLUDED.name, base_url = EXCLUDED.base_url;
