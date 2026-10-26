import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { STAGING_SUPABASE_PROJECT } from "../external-hosting/staging-targets.mjs";
import { targetScopePreflight } from "../external-hosting/target-scope-preflight.mjs";
import { schemaLedger } from "./legacy-data-receipts.mjs";
const require = createRequire(new URL("../../lib/db/package.json", import.meta.url));
const { Client } = require("pg");

export function targetConfiguration(env) {
  if (env.QXLAYER_EXTERNAL_MIGRATIONS_APPROVED !== "true" || !env.MIGRATION_DATABASE_URL)
    throw new Error("Explicit external migration approval and separate operator connection are required.");
  let url;
  try { url = new URL(env.MIGRATION_DATABASE_URL); }
  catch { throw new Error("Invalid external connection URL; credentials are not logged."); }
  const isolated = env.QXLAYER_MIGRATION_TEST === "true" && env.NODE_ENV === "test";
  if (isolated) {
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/postgres")
      throw new Error("Test migrations require disposable local PostgreSQL.");
    return { connectionString: url.toString() };
  }
  const ref = env.SUPABASE_PROJECT_REF;
  if (!ref || !/^[a-z0-9]+$/.test(ref) || url.hostname !== env.MIGRATION_EXPECTED_HOST ||
      !["", "5432"].includes(url.port) || url.pathname !== "/postgres" ||
      !(url.hostname === `db.${ref}.supabase.co` && decodeURIComponent(url.username) === "postgres" ||
        /^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(url.hostname) && decodeURIComponent(url.username) === `postgres.${ref}`) ||
      !env.DB_TLS_CA_FILE)
    throw new Error("Migration target must be the pinned Supabase project, administrator and direct/session endpoint.");
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(key);
  return { connectionString: url.toString(), caFile: env.DB_TLS_CA_FILE };
}
export async function migrate(env = process.env) {
  const options = targetConfiguration(env);
  // Only the validated disposable localhost test target is exempt from provider scope checks.
  if (!(env.QXLAYER_MIGRATION_TEST === "true" && env.NODE_ENV === "test")) {
    await targetScopePreflight({
      connectionString: options.connectionString,
      serviceId: env.QXLAYER_OPERATOR_SERVICE_ID,
      scope: env.QXLAYER_OPERATOR_WRITE_SCOPE ?? "acceptance-only",
      publicWriteApproved: env.QXLAYER_PUBLIC_GLOBAL_WRITES_APPROVED === "true",
      token: env.RENDER_API_KEY,
    });
  }
  if (options.caFile) {
    options.ssl = { rejectUnauthorized: true, ca: await readFile(options.caFile, "utf8"),
      servername: new URL(options.connectionString).hostname };
    options.enableChannelBinding = true;
    options.connectionTimeoutMillis = 15000;
    delete options.caFile;
  }
  const production = env.QXLAYER_EXTERNAL_ENVIRONMENT === "production";
  if (production && (env.SUPABASE_PROJECT_REF !== "qcgvhlphalxqzzsxqjhi" ||
      env.VYNOX_PRODUCTION_INITIALIZATION_APPROVED !== "true"))
    throw new Error("Explicit isolated Production initialization approval required");
  const dir = new URL(production ? "../../deploy/production-candidate/" : "../../deploy/migrations/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", dir), "utf8"));
  // Verify the entire ordered manifest before any connection or DDL.
  const migrations = [];
  let previous = "";
  for (const entry of manifest) {
    if (!/^\d{4}_[a-z_]+\.sql$/.test(entry.file) || entry.file <= previous)
      throw new Error("Invalid/unsorted migration manifest.");
    const planSchemaSource = ["../../lib/db/migrations/plan-management-profiles.sql", "../../lib/db/migrations/plan-management-release-safety.sql"].includes(entry.source);
    if (entry.source && !planSchemaSource && entry.source !== "../migrations/0004_phase1_commerce.sql" && (!production || ![
      "../migrations/0001_application_schema.sql", "../migrations/0002_runtime_security.sql",
      "0004_latest-schema-PREPARED.sql", "0005_auth_runtime.sql", "../migrations/0007_global_exchange_catalog.sql",
      "../migrations/0008_tenant_site_releases.sql", "../migrations/0010_acceptance_catalog.sql",
      "../migrations/0011_plan_feature_rows.sql"].includes(entry.source)))
      throw new Error("Unreviewed Production migration source");
    const sql = await readFile(new URL(entry.source ?? entry.file, dir), "utf8");
    if (createHash("sha256").update(sql).digest("hex") !== entry.sha256)
      throw new Error("Migration checksum mismatch.");
    // These reusable files own a transaction for standalone Development use.
    // The external runner owns ONE transaction including its migration ledger.
    const executable = planSchemaSource ? sql.replace(/^BEGIN;\s*$/m, "").replace(/^COMMIT;\s*$/m, "") : sql;
    migrations.push({ ...entry, sql: executable }); previous = entry.file;
  }
  const c = new Client(options);
  await c.connect();
  try {
    const identity = await c.query("SELECT current_database() AS db,current_user AS actor,EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_admin') AS managed");
    if (identity.rows[0].db !== "postgres" || identity.rows[0].actor !== "postgres" || !identity.rows[0].managed)
      throw new Error("Unexpected external target identity.");
    const lock = await c.query("SELECT pg_try_advisory_lock(hashtextextended('qxlayer-external-migrations',0)) AS locked");
    if (!lock.rows[0].locked) throw new Error("Another migration job holds the lock.");
    await c.query("BEGIN");
    await c.query("SET LOCAL lock_timeout='5s'");
    await c.query("SET LOCAL statement_timeout='60s'");
    await c.query("SET LOCAL qxlayer.external_migration_authorized='yes'");
    if ((env.QXLAYER_EXTERNAL_ENVIRONMENT === "staging" && env.SUPABASE_PROJECT_REF === STAGING_SUPABASE_PROJECT &&
        env.QXLAYER_OWNED_AUTH_SCHEMA_APPROVED === "true") ||
        (env.QXLAYER_MIGRATION_TEST === "true" && env.NODE_ENV === "test")) {
      await c.query("SET LOCAL qxlayer.auth_schema_approved='yes'");
    }
    await c.query("CREATE SCHEMA IF NOT EXISTS qxlayer_migrations");
    await c.query("REVOKE ALL ON SCHEMA qxlayer_migrations FROM PUBLIC");
    await c.query("CREATE TABLE IF NOT EXISTS qxlayer_migrations.versions (file text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const applied = await c.query("SELECT file,sha256 FROM qxlayer_migrations.versions ORDER BY file");
    const schemaRows = schemaLedger(applied.rows, production);
    for (const row of schemaRows)
      if (!migrations.some(m => m.file === row.file && m.sha256 === row.sha256))
        throw new Error("Unknown or changed applied migration.");
    const appliedNames = schemaRows.map(r => r.file);
    if (appliedNames.some((name, i) => migrations[i]?.file !== name))
      throw new Error("Migration history is not an ordered prefix.");
    for (const m of migrations) {
      if (appliedNames.includes(m.file)) continue;
      await c.query(m.sql);
      await c.query("INSERT INTO qxlayer_migrations.versions(file,sha256) VALUES ($1,$2)", [m.file, m.sha256]);
      console.info(`Prepared migration applied: ${m.file}`);
    }
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { await c.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  migrate().catch(() => { console.error("External migration failed; no connection strings or provider errors are logged."); process.exitCode = 1; });
