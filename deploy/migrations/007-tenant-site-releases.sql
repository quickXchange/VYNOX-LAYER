-- Additive presentation-only migration. Never seeds a live release from drafts.
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS live_release_id uuid;
CREATE TABLE IF NOT EXISTS public.tenant_releases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 version integer NOT NULL CHECK(version>0),
 config jsonb NOT NULL,
 checksum text NOT NULL CHECK(checksum ~ '^[0-9a-f]{64}$'),
 draft_checksum text,
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT tenant_release_version UNIQUE(tenant_id,version),
 CONSTRAINT tenant_release_owner UNIQUE(id,tenant_id)
);
CREATE TABLE IF NOT EXISTS public.tenant_release_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 object_key text NOT NULL,
 checksum text NOT NULL,
 extension text NOT NULL,
 content_type text NOT NULL,
 size integer NOT NULL,
 published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT tenant_release_asset_hash UNIQUE(tenant_id,checksum)
);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='tenant_live_release_owner') THEN
  ALTER TABLE public.tenants ADD CONSTRAINT tenant_live_release_owner FOREIGN KEY(live_release_id,id)
   REFERENCES public.tenant_releases(id,tenant_id) DEFERRABLE INITIALLY DEFERRED;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.protect_site_release() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 -- Parent-tenant deletion may cascade; a release cannot be independently
 -- rewritten/deleted while its tenant exists, even by a tenant administrator.
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=OLD.tenant_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Website release snapshots are immutable' USING ERRCODE='23514';
END $$;
DROP TRIGGER IF EXISTS immutable_site_release ON public.tenant_releases;
CREATE TRIGGER immutable_site_release BEFORE UPDATE OR DELETE ON public.tenant_releases
 FOR EACH ROW EXECUTE FUNCTION public.protect_site_release();
