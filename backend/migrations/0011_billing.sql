-- Stripe billing. Sits beside the existing plans/customers tables; free/demo
-- plans still work without a card. Plan changes route through Stripe Checkout
-- and a webhook syncs subscription status back here.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS subscription_status    TEXT;  -- active|past_due|canceled|...

ALTER TABLE plans ADD COLUMN IF NOT EXISTS stripe_price_id   TEXT;  -- recurring base price
ALTER TABLE plans ADD COLUMN IF NOT EXISTS metered_price_id  TEXT;  -- optional usage/overage price
