-- Activate the providers whose scrapers now ingest real data, and tag the
-- exchange so the API/docs expose its native back/lay/volume/suspended shape.
--
-- `exchange` is a documentation/shape marker (the OpenAPI generator renders
-- exchange-native examples for it); the resource capabilities (sports, matches,
-- live, odds) are what actually gate the endpoints.

UPDATE providers
   SET is_active = true,
       capabilities = '["sports","leagues","matches","live","odds","exchange"]'
 WHERE slug = 'diamondexch';

UPDATE providers
   SET is_active = true
 WHERE slug = 'bcgame';
