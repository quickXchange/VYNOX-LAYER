-- Additive master-code migration. No automatic release or draft-data imports.
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS live_release_id uuid;
CREATE TABLE IF NOT EXISTS public.tenant_releases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 version integer NOT NULL CHECK(version>0), config jsonb NOT NULL,
 checksum text NOT NULL CHECK(checksum ~ '^[0-9a-f]{64}$'), draft_checksum text, created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT tenant_release_version UNIQUE(tenant_id,version), CONSTRAINT tenant_release_owner UNIQUE(id,tenant_id)
);
CREATE TABLE IF NOT EXISTS public.tenant_release_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 object_key text NOT NULL, checksum text NOT NULL, extension text NOT NULL, content_type text NOT NULL,
 size integer NOT NULL, published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT tenant_release_asset_hash UNIQUE(tenant_id,checksum)
);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='tenant_live_release_owner') THEN
 ALTER TABLE public.tenants ADD CONSTRAINT tenant_live_release_owner FOREIGN KEY(live_release_id,id)
 REFERENCES public.tenant_releases(id,tenant_id) DEFERRABLE INITIALLY DEFERRED;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.protect_site_release() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=OLD.tenant_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Website release snapshots are immutable' USING ERRCODE='23514';
END $$;
DROP TRIGGER IF EXISTS immutable_site_release ON public.tenant_releases;
CREATE TRIGGER immutable_site_release BEFORE UPDATE OR DELETE ON public.tenant_releases
 FOR EACH ROW EXECUTE FUNCTION public.protect_site_release();
DO $security$
DECLARE name text; role_name text; policy_role text := 'PUBLIC';
 read_scope text := '(coalesce(current_setting(''app.is_super_admin'',true),'''')=''true'' OR (tenant_id::text=coalesce(current_setting(''app.tenant_id'',true),'''') AND coalesce(current_setting(''app.tenant_id'',true),'''')<>''''))';
 write_scope text;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tenants' AND policyname='qx_read' AND roles=ARRAY['qxlayer_runtime']::name[]) THEN policy_role := 'qxlayer_runtime'; END IF;
 write_scope := '('||read_scope||' AND coalesce(current_setting(''app.can_write'',true),'''')=''true'')';
 FOREACH name IN ARRAY ARRAY['tenant_releases','tenant_release_assets'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY qx_read ON public.%I FOR SELECT TO %s USING (%s)',name,policy_role,read_scope);
  EXECUTE format('CREATE POLICY qx_write ON public.%I FOR ALL TO %s USING (%s) WITH CHECK (%s)',name,policy_role,write_scope,write_scope);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',name);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',name,role_name); END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='qxlayer_runtime') THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO qxlayer_runtime',name);
  END IF;
 END LOOP;
END $security$;
