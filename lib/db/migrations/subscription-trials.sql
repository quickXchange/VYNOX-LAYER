-- Additive only: no existing subscription, invoice or agreed price is rewritten.
ALTER TABLE public.tenant_subscriptions ADD COLUMN IF NOT EXISTS trial jsonb;
