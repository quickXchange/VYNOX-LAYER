-- Additive plan-management extension. Idempotent; never overwrites operator edits.
-- Step 1 of 2 (schema + contract freeze). Step 2 is plan-management-seed.sql,
-- run by scripts/src/apply-plan-management-migration.mjs only after the public
-- pricing baseline is frozen (TS freezePricingBeforeEdit).
BEGIN;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS profile jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS updated_by text;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='plans_profile_object') THEN
  ALTER TABLE public.plans ADD CONSTRAINT plans_profile_object CHECK (jsonb_typeof(profile)='object');
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS plans_active_slug ON public.plans ((profile->>'slug')) WHERE status <> 'archived' AND profile ? 'slug';

DO $$ BEGIN
 IF to_regclass('qxlayer_acceptance_catalog.plans') IS NOT NULL THEN
  ALTER TABLE qxlayer_acceptance_catalog.plans ADD COLUMN IF NOT EXISTS profile jsonb NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE qxlayer_acceptance_catalog.plans ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;
  ALTER TABLE qxlayer_acceptance_catalog.plans ADD COLUMN IF NOT EXISTS updated_by text;
  CREATE UNIQUE INDEX IF NOT EXISTS acc_plans_active_slug ON qxlayer_acceptance_catalog.plans ((profile->>'slug')) WHERE status <> 'archived' AND profile ? 'slug';
 END IF;
END $$;

-- Immutable publication history (append-only) enabling rollback.
CREATE TABLE IF NOT EXISTS qxlayer_commerce.pricing_publication_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 revision text NOT NULL CHECK (revision ~ '^[a-f0-9]{64}$'),
 payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
 reason text NOT NULL,
 published_by text NOT NULL,
 rollback_of uuid NULL,
 published_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION qxlayer_commerce.publication_versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN RAISE EXCEPTION 'pricing publication versions are immutable'; END $f$;
DROP TRIGGER IF EXISTS publication_versions_immutable ON qxlayer_commerce.pricing_publication_versions;
CREATE TRIGGER publication_versions_immutable BEFORE UPDATE OR DELETE ON qxlayer_commerce.pricing_publication_versions
 FOR EACH ROW EXECUTE FUNCTION qxlayer_commerce.publication_versions_immutable();
ALTER TABLE qxlayer_commerce.pricing_publication_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE qxlayer_commerce.pricing_publication_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS versions_read ON qxlayer_commerce.pricing_publication_versions;
CREATE POLICY versions_read ON qxlayer_commerce.pricing_publication_versions FOR SELECT USING (current_setting('app.is_super_admin',true)='true');
DROP POLICY IF EXISTS versions_insert ON qxlayer_commerce.pricing_publication_versions;
CREATE POLICY versions_insert ON qxlayer_commerce.pricing_publication_versions FOR INSERT
 WITH CHECK (current_setting('app.is_super_admin',true)='true' AND current_setting('app.can_write',true)='true');
GRANT SELECT,INSERT ON qxlayer_commerce.pricing_publication_versions TO pg_database_owner;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qxlayer_runtime') THEN
  GRANT SELECT,INSERT ON qxlayer_commerce.pricing_publication_versions TO qxlayer_runtime;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qxlayer_public_app') THEN
  REVOKE ALL ON qxlayer_commerce.pricing_publication_versions FROM qxlayer_public_app;
 END IF;
 REVOKE ALL ON qxlayer_commerce.pricing_publication_versions FROM PUBLIC;
 IF to_regclass('qxlayer_acceptance_catalog.pricing_publication') IS NOT NULL
    AND to_regclass('qxlayer_acceptance_catalog.pricing_publication_versions') IS NULL THEN
  -- Same private-catalog controls as 0010_acceptance_catalog.sql: no public
  -- runtime access, every policy pinned to the original SESSION_USER.
  CREATE TABLE qxlayer_acceptance_catalog.pricing_publication_versions (LIKE qxlayer_commerce.pricing_publication_versions INCLUDING ALL);
  CREATE TRIGGER publication_versions_immutable BEFORE UPDATE OR DELETE ON qxlayer_acceptance_catalog.pricing_publication_versions
   FOR EACH ROW EXECUTE FUNCTION qxlayer_commerce.publication_versions_immutable();
  ALTER TABLE qxlayer_acceptance_catalog.pricing_publication_versions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE qxlayer_acceptance_catalog.pricing_publication_versions FORCE ROW LEVEL SECURITY;
  REVOKE ALL ON qxlayer_acceptance_catalog.pricing_publication_versions FROM PUBLIC, anon, authenticated, service_role, qxlayer_public_app;
  GRANT SELECT,INSERT ON qxlayer_acceptance_catalog.pricing_publication_versions TO qxlayer_runtime;
  CREATE POLICY acceptance_versions_read ON qxlayer_acceptance_catalog.pricing_publication_versions FOR SELECT TO qxlayer_runtime
   USING (session_user = 'qxlayer_app' AND current_setting('app.is_super_admin',true) = 'true');
  CREATE POLICY acceptance_versions_insert ON qxlayer_acceptance_catalog.pricing_publication_versions FOR INSERT TO qxlayer_runtime
   WITH CHECK (session_user = 'qxlayer_app' AND current_setting('app.is_super_admin',true) = 'true' AND current_setting('app.can_write',true) = 'true');
 END IF;
END $$;

-- Immutable customer contract snapshots.
ALTER TABLE public.tenant_subscriptions ADD COLUMN IF NOT EXISTS contract_snapshot jsonb NULL;
ALTER TABLE public.tenant_subscriptions ADD COLUMN IF NOT EXISTS contract_frozen_at timestamptz NULL;
UPDATE public.tenant_subscriptions s SET
 contract_snapshot = jsonb_build_object(
  'planId', p.id, 'planName', p.name, 'currency', p.currency,
  'pricingConfigured', p.pricing_configured,
  'monthlyPrice', CASE WHEN p.pricing_configured THEN p.monthly_price::text END,
  'yearlyPrice', CASE WHEN p.pricing_configured THEN p.yearly_price::text END,
  'setupFee', CASE WHEN p.pricing_configured THEN p.setup_fee::text END,
  'discountPercent', p.discount_percent::text,
  'billingPeriods', (SELECT to_jsonb(array_remove(ARRAY[CASE WHEN COALESCE(o.monthly,true) THEN 'monthly' END, CASE WHEN COALESCE(o.yearly,true) THEN 'yearly' END], NULL))
     FROM (SELECT 1) one LEFT JOIN qxlayer_commerce.offer_settings o ON o.plan_id=p.id),
  'profile', (p.profile - 'internalNotes' - 'internalName'),
  'publishedRevision', NULL,
  'entitlements', COALESCE((SELECT jsonb_agg(jsonb_build_object('key',e.key,'value',e.value) ORDER BY e.key) FROM public.plan_entitlements e WHERE e.plan_id=p.id),'[]'::jsonb),
  'source', 'migration:plan-management-profiles'),
 contract_frozen_at = now()
FROM public.plans p WHERE p.id = s.plan_id AND s.contract_snapshot IS NULL;

COMMIT;
