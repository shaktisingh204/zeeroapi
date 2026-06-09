-- Tag catalogued images (sport/league/team logos) with the provider that
-- produced them, so the admin Images view can be scoped per provider. Existing
-- rows keep provider = NULL and still show when no provider filter is applied.
ALTER TABLE images ADD COLUMN IF NOT EXISTS provider TEXT;
CREATE INDEX IF NOT EXISTS idx_images_provider ON images(provider);
