-- Password-reset tokens (self-serve customer portal). Only the SHA-256 hash of
-- the token is stored; the raw token is emailed once and never persisted.
CREATE TABLE IF NOT EXISTS password_resets (
    token_hash  TEXT PRIMARY KEY,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_customer ON password_resets(customer_id);

-- Usage-alert de-dup: the billing period (YYYY-MM) we last emailed a quota
-- warning for, so the alert fires at most once per customer per month.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS alerted_period TEXT;
