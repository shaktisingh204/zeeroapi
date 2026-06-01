-- Provider-scoped API: each provider exposes a different set of endpoints
-- (capabilities) and its own data. The public API is namespaced per provider
-- (/api/v1/{provider}/...) and gated by these capabilities.

ALTER TABLE providers ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL
    DEFAULT '["sports","leagues","matches","live","odds"]';

-- Differentiate providers so the docs + API genuinely vary per provider.
UPDATE providers SET capabilities = '["sports","leagues","matches","live","odds","full_markets"]' WHERE slug = 'melbet';
UPDATE providers SET capabilities = '["sports","leagues","matches","live","odds"]'                WHERE slug = '1xbet';
UPDATE providers SET capabilities = '["sports","leagues","matches","odds"]'                        WHERE slug = 'betwinner';
UPDATE providers SET capabilities = '["sports","matches","live","odds"]'                           WHERE slug = '1win';
UPDATE providers SET capabilities = '["sports","matches","odds"]'                                  WHERE slug = 'megapari';
