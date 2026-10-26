-- Add-on agreements belong to the assignment, not to the mutable catalog.
BEGIN;
ALTER TABLE public.tenant_addons ADD COLUMN IF NOT EXISTS contract_snapshot jsonb;
UPDATE public.tenant_addons t SET contract_snapshot=jsonb_build_object(
 'id',a.id,'name',a.name,'description',a.description,'enabled',a.enabled,
 'currency',a.currency,'pricingConfigured',a.pricing_configured AND a.pricing_confirmed,
 'monthlyPrice',CASE WHEN a.pricing_configured AND a.pricing_confirmed THEN a.monthly_price::text END,
 'yearlyPrice',CASE WHEN a.pricing_configured AND a.pricing_confirmed THEN a.yearly_price::text END,
 'setupFee',CASE WHEN a.pricing_configured AND a.pricing_confirmed THEN a.setup_fee::text END,
 'discountPercent',a.discount_percent::text,
 'entitlements',COALESCE((SELECT jsonb_agg(jsonb_build_object('key',e.key,'value',e.value) ORDER BY e.key)
   FROM public.addon_entitlements e WHERE e.addon_id=a.id),'[]'::jsonb))
FROM public.addons a WHERE a.id=t.addon_id AND t.contract_snapshot IS NULL;
-- New assignment paths, including provisioning, freeze atomically on insertion.
CREATE OR REPLACE FUNCTION public.freeze_addon_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.contract_snapshot IS NOT NULL THEN
   IF NEW.contract_snapshot IS DISTINCT FROM OLD.contract_snapshot THEN
     RAISE EXCEPTION 'Retained add-on agreements are immutable';
   END IF;
   RETURN NEW;
 END IF;
 SELECT jsonb_build_object(
 'id',a.id,'name',a.name,'description',a.description,'enabled',a.enabled,
 'currency',a.currency,'pricingConfigured',a.pricing_configured AND a.pricing_confirmed,
 'monthlyPrice',CASE WHEN a.pricing_configured AND a.pricing_confirmed THEN a.monthly_price::text END,
 'yearlyPrice',CASE WHEN a.pricing_configured AND a.pricing_confirmed THEN a.yearly_price::text END,
 'setupFee',CASE WHEN a.pricing_configured AND a.pricing_confirmed THEN a.setup_fee::text END,
 'discountPercent',a.discount_percent::text,
 'entitlements',COALESCE((SELECT jsonb_agg(jsonb_build_object('key',e.key,'value',e.value) ORDER BY e.key)
 FROM public.addon_entitlements e WHERE e.addon_id=a.id),'[]'::jsonb))
 INTO NEW.contract_snapshot FROM public.addons a WHERE a.id=NEW.addon_id;
 IF NEW.contract_snapshot IS NULL THEN RAISE EXCEPTION 'Cannot freeze missing add-on'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS freeze_addon_assignment ON public.tenant_addons;
CREATE TRIGGER freeze_addon_assignment BEFORE INSERT OR UPDATE ON public.tenant_addons
FOR EACH ROW EXECUTE FUNCTION public.freeze_addon_assignment();
-- SET ROLE must not turn the public login into an operator.
DROP POLICY IF EXISTS versions_read ON qxlayer_commerce.pricing_publication_versions;
CREATE POLICY versions_read ON qxlayer_commerce.pricing_publication_versions FOR SELECT
USING (session_user IN ('qxlayer_app','postgres') AND current_setting('app.is_super_admin',true)='true');
DROP POLICY IF EXISTS versions_insert ON qxlayer_commerce.pricing_publication_versions;
CREATE POLICY versions_insert ON qxlayer_commerce.pricing_publication_versions FOR INSERT
WITH CHECK (session_user IN ('qxlayer_app','postgres') AND current_setting('app.is_super_admin',true)='true' AND current_setting('app.can_write',true)='true');
COMMIT;
