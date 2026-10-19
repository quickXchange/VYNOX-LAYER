-- Operator-only additive migration. Execute inside the operator's transaction,
-- after target verification. Never register as an application startup migration.
-- Intentionally fail on an existing schema: never re-clone over private edits.
-- LIKE copies columns/defaults/checks/indexes, NOT source FKs, policies or triggers.
CREATE SCHEMA qxlayer_acceptance_catalog;
REVOKE ALL ON SCHEMA qxlayer_acceptance_catalog FROM PUBLIC, anon, authenticated, service_role, qxlayer_public_app;

CREATE TABLE qxlayer_acceptance_catalog.plans (LIKE public.plans INCLUDING ALL);
CREATE TABLE qxlayer_acceptance_catalog.addons (LIKE public.addons INCLUDING ALL);
CREATE TABLE qxlayer_acceptance_catalog.plan_entitlements (LIKE public.plan_entitlements INCLUDING ALL);
CREATE TABLE qxlayer_acceptance_catalog.addon_entitlements (LIKE public.addon_entitlements INCLUDING ALL);
CREATE TABLE qxlayer_acceptance_catalog.offer_settings (LIKE qxlayer_commerce.offer_settings INCLUDING ALL);
CREATE TABLE qxlayer_acceptance_catalog.pricing_publication (LIKE qxlayer_commerce.pricing_publication INCLUDING ALL);
CREATE TABLE qxlayer_acceptance_catalog.catalog_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  actor_id text NOT NULL,
  event_type text NOT NULL,
  description text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE qxlayer_acceptance_catalog.plan_entitlements
  ADD CONSTRAINT acceptance_plan_fk FOREIGN KEY (plan_id) REFERENCES qxlayer_acceptance_catalog.plans(id),
  ADD CONSTRAINT acceptance_plan_key_fk FOREIGN KEY (key) REFERENCES public.entitlement_definitions(key);
ALTER TABLE qxlayer_acceptance_catalog.addon_entitlements
  ADD CONSTRAINT acceptance_addon_fk FOREIGN KEY (addon_id) REFERENCES qxlayer_acceptance_catalog.addons(id),
  ADD CONSTRAINT acceptance_addon_key_fk FOREIGN KEY (key) REFERENCES public.entitlement_definitions(key);
ALTER TABLE qxlayer_acceptance_catalog.offer_settings
  ADD CONSTRAINT acceptance_offer_plan_fk FOREIGN KEY (plan_id) REFERENCES qxlayer_acceptance_catalog.plans(id) ON DELETE CASCADE;

-- One statement snapshot retains original IDs and all initial catalog metadata.
-- No public rows are updated and historical subscriptions continue to reference public.
WITH copied_plans AS (
  INSERT INTO qxlayer_acceptance_catalog.plans SELECT * FROM public.plans RETURNING id
), copied_addons AS (
  INSERT INTO qxlayer_acceptance_catalog.addons SELECT * FROM public.addons RETURNING id
), copied_plan_entitlements AS (
  INSERT INTO qxlayer_acceptance_catalog.plan_entitlements SELECT * FROM public.plan_entitlements RETURNING plan_id
), copied_addon_entitlements AS (
  INSERT INTO qxlayer_acceptance_catalog.addon_entitlements SELECT * FROM public.addon_entitlements RETURNING addon_id
), copied_offer_settings AS (
  INSERT INTO qxlayer_acceptance_catalog.offer_settings SELECT * FROM qxlayer_commerce.offer_settings RETURNING plan_id
)
INSERT INTO qxlayer_acceptance_catalog.pricing_publication SELECT * FROM qxlayer_commerce.pricing_publication;

-- No policy or grant is changed on any shared schema/table/role.
-- qxlayer_public_app can SET ROLE qxlayer_runtime, so CURRENT_USER alone is
-- insufficient: every private policy also pins the original SESSION_USER.
DO $acceptance_catalog$
DECLARE object_name text;
BEGIN
  FOREACH object_name IN ARRAY ARRAY['plans','addons','plan_entitlements','addon_entitlements','offer_settings','pricing_publication']
  LOOP
    EXECUTE format('ALTER TABLE qxlayer_acceptance_catalog.%I ENABLE ROW LEVEL SECURITY', object_name);
    EXECUTE format('ALTER TABLE qxlayer_acceptance_catalog.%I FORCE ROW LEVEL SECURITY', object_name);
    EXECUTE format('REVOKE ALL ON qxlayer_acceptance_catalog.%I FROM PUBLIC, anon, authenticated, service_role, qxlayer_public_app', object_name);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON qxlayer_acceptance_catalog.%I TO qxlayer_runtime', object_name);
    EXECUTE format('CREATE POLICY acceptance_read ON qxlayer_acceptance_catalog.%I FOR SELECT TO qxlayer_runtime USING (session_user = ''qxlayer_app'')', object_name);
    EXECUTE format('CREATE POLICY acceptance_write ON qxlayer_acceptance_catalog.%I FOR ALL TO qxlayer_runtime
      USING (session_user = ''qxlayer_app'' AND current_setting(''app.is_super_admin'',true) = ''true'' AND current_setting(''app.can_write'',true) = ''true'')
      WITH CHECK (session_user = ''qxlayer_app'' AND current_setting(''app.is_super_admin'',true) = ''true'' AND current_setting(''app.can_write'',true) = ''true'')', object_name);
  END LOOP;
END
$acceptance_catalog$;
ALTER TABLE qxlayer_acceptance_catalog.catalog_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE qxlayer_acceptance_catalog.catalog_audit_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON qxlayer_acceptance_catalog.catalog_audit_events FROM PUBLIC, anon, authenticated, service_role, qxlayer_public_app;
GRANT SELECT,INSERT ON qxlayer_acceptance_catalog.catalog_audit_events TO qxlayer_runtime;
CREATE POLICY acceptance_audit_read ON qxlayer_acceptance_catalog.catalog_audit_events FOR SELECT TO qxlayer_runtime
  USING (session_user = 'qxlayer_app' AND current_setting('app.is_super_admin',true) = 'true');
CREATE POLICY acceptance_audit_insert ON qxlayer_acceptance_catalog.catalog_audit_events FOR INSERT TO qxlayer_runtime
  WITH CHECK (session_user = 'qxlayer_app' AND current_setting('app.is_super_admin',true) = 'true' AND current_setting('app.can_write',true) = 'true');
GRANT USAGE ON SCHEMA qxlayer_acceptance_catalog TO qxlayer_runtime;
