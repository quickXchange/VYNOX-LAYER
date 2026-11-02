import { mkdir, writeFile } from "node:fs/promises";
import { pool } from "../lib/db/src/index";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
assert.equal(process.env.QXLAYER_EXTERNAL_ENVIRONMENT, "development");
assert(!process.env.QXLAYER_DATABASE_PROVIDER || process.env.QXLAYER_DATABASE_PROVIDER === "replit");
const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.hostname, process.env.PGHOST);
assert(!/supabase|neon\.tech/.test(url.hostname));
const c = await pool.connect();
const q = async (sql: string) => (await c.query(sql)).rows;
let schemas = "'public','qxlayer_commerce','vynox_supabase_auth'";
const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
try {
  await c.query("BEGIN READ ONLY");
  await c.query("SET LOCAL statement_timeout='15s'");
  const namespaces = await q("SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'");
  schemas = namespaces.map(n => `'${String(n.nspname).replaceAll("'", "''")}'`).join(",");
  const tables = await q(`SELECT n.nspname AS schema,c.relname AS name,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,
    pg_total_relation_size(c.oid)::text AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN (${schemas}) AND c.relkind IN ('r','p') ORDER BY 1,2`);
  const columns = await q(`SELECT table_schema,table_name,column_name,data_type,is_nullable,column_default
    FROM information_schema.columns WHERE table_schema IN (${schemas}) ORDER BY 1,2,ordinal_position`);
  const constraints = await q(`SELECT n.nspname AS schema,c.relname AS table_name,con.conname AS name,con.contype AS type,
    con.convalidated AS validated,pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN (${schemas}) ORDER BY 1,2,3`);
  const indexes = await q(`SELECT n.nspname AS schema,c.relname AS table_name,ic.relname AS name,i.indisvalid AS valid,
    i.indisready AS ready,pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_class ic ON ic.oid=i.indexrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN (${schemas}) ORDER BY 1,2,3`);
  const fks = await q(`SELECT con.conname AS name,n.nspname AS child_schema,c.relname AS child_table,
    pn.nspname AS parent_schema,p.relname AS parent_table,
    ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(num,pos) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.num ORDER BY pos) AS child_cols,
    ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(num,pos) JOIN pg_attribute a ON a.attrelid=p.oid AND a.attnum=k.num ORDER BY pos) AS parent_cols
    FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_class p ON p.oid=con.confrelid JOIN pg_namespace pn ON pn.oid=p.relnamespace
    WHERE con.contype='f' AND n.nspname IN (${schemas})`);
  const orphanChecks = [];
  for (const fk of fks) {
    const nonnull = fk.child_cols.map((s: string) => `child.${quote(s)} IS NOT NULL`).join(" AND ");
    const join = fk.child_cols.map((s: string, i: number) => `child.${quote(s)}=parent.${quote(fk.parent_cols[i])}`).join(" AND ");
    const [{ count }] = await q(`SELECT count(*)::text AS count FROM ${quote(fk.child_schema)}.${quote(fk.child_table)} child
      WHERE ${nonnull} AND NOT EXISTS(SELECT 1 FROM ${quote(fk.parent_schema)}.${quote(fk.parent_table)} parent WHERE ${join})`);
    orphanChecks.push({ constraint: fk.name, table: `${fk.child_schema}.${fk.child_table}`, orphanCount: count });
  }
  const policies = await q(`SELECT schemaname,tablename,policyname,permissive,roles,cmd FROM pg_policies WHERE schemaname IN (${schemas}) ORDER BY 1,2,3`);
  const report = { checkedAt: new Date().toISOString(), source: "Development local database", productionWrites: false,
    readOnly: true, tables, columns, constraints, indexes, orphanChecks, policies,
    caveat: "Schema and declared-FK integrity checks only. Does not prove undeclared relationships, business invariants, query efficiency, RLS role enforcement or workflow persistence." };
  await c.query("COMMIT");
  await mkdir("generated-artifacts/backend-audit", { recursive: true });
  await writeFile("generated-artifacts/backend-audit/database-inventory.json", JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ tables: tables.length, columns: columns.length, constraints: constraints.length,
    indexes: indexes.length, foreignKeysChecked: orphanChecks.length, orphanedRelationships: orphanChecks.filter(x => x.orphanCount !== "0").length,
    invalidIndexes: indexes.filter(x => !x.valid || !x.ready).length, unvalidatedConstraints: constraints.filter(x => !x.validated).length }));
} finally { await c.query("ROLLBACK").catch(() => {}); c.release(); await pool.end(); }
