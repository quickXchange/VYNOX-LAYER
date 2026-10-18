-- Server-only authority projection. No public-table grant, RLS weakening,
-- account creation, identity rebinding or credential changes.
CREATE OR REPLACE FUNCTION vynox_supabase_auth.active_admin_subjects()
RETURNS TABLE(subject uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT DISTINCT COALESCE(l.subject,
    CASE WHEN a.clerk_user_id ~ '^supabase:[a-f0-9-]{36}$'
      THEN substring(a.clerk_user_id from 10)::uuid END)
  FROM public.platform_admins a
  LEFT JOIN vynox_supabase_auth.identity_links l ON l.business_id=a.clerk_user_id
  WHERE a.active=true
$$;
REVOKE ALL ON FUNCTION vynox_supabase_auth.active_admin_subjects() FROM PUBLIC;
-- The infrastructure operator grants EXECUTE only to the existing private Auth
-- login and the separate public API's private Auth login. Never to tenant/app
-- runtime roles. These environment-specific grants are verified on installation.
