/** Read-only, additive metadata capture. Does not rewrite the original baseline. */
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { readSchema } from "./schema-reference.mjs";
const require = createRequire(new URL("../../lib/db/package.json", import.meta.url));
const { Client } = require("pg");
if (process.env.NODE_ENV !== "development") throw new Error("Development-only metadata capture.");
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
try {
  const schema = await readSchema(c), names = ["tenant_releases", "tenant_release_assets"];
  const supplement = {
    columns: schema.columns.filter(r => names.includes(r.table_name) || r.table_name === "tenants" && r.name === "live_release_id"),
    constraints: schema.constraints.filter(r => names.includes(r.table_name) || r.table_name === "tenants" && r.name === "tenant_live_release_owner"),
    indexes: schema.indexes.filter(r => names.includes(r.table_name)),
    tables: (await c.query(`SELECT c.relname AS name,c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced,
      (SELECT jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname)
       FROM pg_policy p WHERE p.polrelid=c.oid) AS policies FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname`, [names])).rows,
  };
  await writeFile(new URL("../../deploy/migrations/site-release-reference.json", import.meta.url), JSON.stringify(supplement, null, 2) + "\n");
} finally { await c.end(); }
