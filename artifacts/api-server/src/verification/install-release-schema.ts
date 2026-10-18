import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { rowPolicies } from "../../../../lib/db/src/row-security";
if (process.env.NODE_ENV !== "development" || process.env.QXLAYER_DATABASE_PROVIDER === "supabase")
  throw new Error("This installer is Development-only. Production requires reviewed external migration.");
try {
  const target = (await pool.query("SELECT current_database() AS db,current_user AS actor")).rows[0];
  if (target.db !== "heliumdb" || target.actor !== "postgres") throw new Error("Refusing an unrecognized Development database target.");
  await pool.query(await readFile("../../deploy/migrations/007-tenant-site-releases.sql", "utf8"));
  for (const name of ["tenant_releases", "tenant_release_assets"]) {
    const policy = rowPolicies(name, true);
    await pool.query(`ALTER TABLE public.${name} ENABLE ROW LEVEL SECURITY; ALTER TABLE public.${name} FORCE ROW LEVEL SECURITY;
      GRANT SELECT,INSERT,UPDATE,DELETE ON public.${name} TO pg_database_owner;
      DROP POLICY IF EXISTS qx_read ON public.${name}; DROP POLICY IF EXISTS qx_write ON public.${name};
      CREATE POLICY qx_read ON public.${name} FOR SELECT USING (${policy.read});
      CREATE POLICY qx_write ON public.${name} FOR ALL USING (${policy.write}) WITH CHECK (${policy.write});`);
  }
  process.stdout.write("PASS: additive Development release schema, immutable snapshot trigger and scoped RLS installed; no existing tenant released.\n");
} finally { await pool.end(); }
