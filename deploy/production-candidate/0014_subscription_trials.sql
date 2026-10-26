-- Additive schema only. The external migration runner owns the transaction,
-- advisory lock, timeouts and checksum ledger. Never run from app startup/build.
-- Existing agreements remain ordinary subscriptions (NULL trial); no backfill.
ALTER TABLE public.tenant_subscriptions ADD COLUMN IF NOT EXISTS trial jsonb;

-- IF NOT EXISTS must not silently accept an incompatible pre-existing column.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute a
    WHERE a.attrelid = 'public.tenant_subscriptions'::regclass
      AND a.attname = 'trial'
      AND NOT a.attisdropped
      AND a.atttypid = 'pg_catalog.jsonb'::regtype
      AND NOT a.attnotnull
      AND NOT a.atthasdef
      AND a.attidentity = ''
      AND a.attgenerated = ''
  ) THEN
    RAISE EXCEPTION 'Subscription trial column must be nullable JSONB without a default, identity or generation expression';
  END IF;
END
$$;
