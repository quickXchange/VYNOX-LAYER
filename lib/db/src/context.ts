import type { PoolClient } from "pg";
import { pool } from "./index";
import { publicPreparation } from "../../../lib/production-access-gate/public-preparation.mjs";
import { applicationTableNames } from "./schema-table-names";
import { runtimeRole } from "./connection-options";

export type DatabaseClient = PoolClient;
export interface DatabaseContext {
  repeatableRead?: boolean;
  actorId: string;
  tenantId?: string | null;
  isSuperAdmin?: boolean;
  canWrite?: boolean;
  publicSlug?: string;
  publicDomain?: string;
  canManageStaff?: boolean;
}

/**
 * Replit drops to the non-bypassing built-in owner group; external Supabase
 * uses its separately provisioned restricted transaction role. Server checks
 * remain authoritative for capabilities; RLS independently filters tenant rows.
 * No role/schema DDL runs here.
 * Read-only requests cannot execute database mutations.
 * ROLLBACK/COMMIT clear the context before the connection returns to the pool.
 */
export async function withDatabase<T>(
  context: DatabaseContext,
  work: (client: DatabaseClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    const role = runtimeRole();
    if (role === "qxlayer_runtime") {
      await client.query(context.repeatableRead ? "BEGIN ISOLATION LEVEL REPEATABLE READ" : context.canWrite === true ? "BEGIN" : "BEGIN READ ONLY");
      const expectedLogin = publicPreparation() ? "qxlayer_public_app" : "qxlayer_app";
      const login = await client.query(`SELECT session_user=$1 AND NOT r.rolsuper
        AND NOT r.rolbypassrls AND NOT r.rolinherit AND NOT r.rolcreaterole AND NOT r.rolcreatedb
        AND NOT EXISTS (SELECT 1 FROM pg_roles p WHERE p.rolname NOT IN ($1,'qxlayer_runtime')
          AND pg_has_role(r.oid,p.oid,'MEMBER')) AS safe
        FROM pg_roles r WHERE r.rolname=session_user`, [expectedLogin]);
      if (!login.rows[0]?.safe) throw new Error("External database login is not restricted.");
      await client.query("SET LOCAL ROLE qxlayer_runtime; SET LOCAL search_path=pg_catalog,public; SET LOCAL row_security=on");
    } else {
      // Static commands only: batch transport, not authorization or guard results.
      // Every transaction still performs the full schema/policy/grant readback.
      await client.query(`${context.repeatableRead ? "BEGIN ISOLATION LEVEL REPEATABLE READ" : context.canWrite === true ? "BEGIN" : "BEGIN READ ONLY"}; SET LOCAL ROLE pg_database_owner; SET LOCAL search_path=pg_catalog,public; SET LOCAL row_security=on`);
    }
    const security = await client.query<{ safe: boolean }>(`
      SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND
        NOT EXISTS (SELECT 1 FROM unnest($1::text[]) names(name)
          LEFT JOIN pg_class c ON c.relname=names.name
            AND c.relnamespace='public'::regnamespace
          WHERE c.oid IS NULL OR NOT c.relrowsecurity OR
            (c.relowner=r.oid AND NOT c.relforcerowsecurity) OR
            EXISTS (SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) priv(name)
              WHERE NOT has_table_privilege(current_user,c.oid,priv.name)) OR
            (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid)<>2 OR
            (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid AND
              ((p.polname='qx_read' AND p.polcmd='r' AND p.polqual IS NOT NULL) OR
               (p.polname='qx_write' AND p.polcmd='*' AND p.polqual IS NOT NULL AND p.polwithcheck IS NOT NULL
                AND position('app.can_write' in pg_get_expr(p.polqual,p.polrelid))>0
                AND position('app.can_write' in pg_get_expr(p.polwithcheck,p.polrelid))>0)))<>2)
        AS safe FROM pg_roles r WHERE r.rolname=current_user`, [applicationTableNames()]);
    if (!security.rows[0]?.safe) throw new Error("Database isolation is not ready: review the approved schema, policies and role grants before serving requests.");
    await client.query(
      `SELECT set_config('app.actor_id', $1, true),
              set_config('app.tenant_id', $2, true),
              set_config('app.is_super_admin', $3, true),
              set_config('app.can_write', $4, true),
              set_config('app.public_slug', $5, true),
              set_config('app.public_domain', $6, true),
              set_config('app.can_manage_staff', $7, true)`,
      [context.actorId, context.tenantId ?? "", String(context.isSuperAdmin === true), String(context.canWrite === true), context.publicSlug ?? "", context.publicDomain ?? "", String(context.canManageStaff === true || context.isSuperAdmin === true)],
    );
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}