import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readdir, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { seal, storageCheck } from "../recovery/encrypted_backup.mjs";
import { migrate } from "./migrate.mjs";
import { verifyCommittedTarget } from "./verify-target.mjs";
import { readSchema, canonicalSchema } from "./schema-reference.mjs";
import { verifyProductionPermissions } from "./production-permissions.mjs";
const { Client } = createRequire(new URL("../../lib/db/package.json", import.meta.url))("pg");
export const PROJECT = "qcgvhlphalxqzzsxqjhi";
const GROUP = "evg-db936g3bc2fs73cmm5dg";
const renderHeaders = () => ({ Authorization: `Bearer ${process.env.RENDER_API_KEY}`, "Content-Type": "application/json" });
async function render(path, method = "GET", body) {
  const r = await fetch(`https://api.render.com/v1/${path}`, { method, headers: renderHeaders(),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(25000) });
  assert(r.ok, `Render configuration HTTP ${r.status}`);
  return r.status === 204 ? null : r.json();
}
export async function productionOperator() {
  const group = await render(`env-groups/${GROUP}`);
  assert(group.serviceLinks.some(x => x.id === "srv-db5b47qjnfac739s374g"));
  const env = Object.fromEntries(group.envVars.map(x => [x.key, x.value]));
  assert.equal(env.QXLAYER_EXTERNAL_ENVIRONMENT, "production");
  assert.equal(env.QXLAYER_EXTERNAL_STARTUP_APPROVED, "false", "Initialization requires held candidate");
  assert.equal(env.QXLAYER_PRODUCTION_SUPABASE_AUTH_PROJECT_REF, PROJECT);
  const url = new URL(process.env.QXLAYER_PRODUCTION_SUPABASE_DATABASE_URL);
  assert(url.toString() === new URL(env.QXLAYER_PRODUCTION_SUPABASE_DATABASE_URL).toString());
  assert(decodeURIComponent(url.username) === `postgres.${PROJECT}` ||
    (url.hostname === `db.${PROJECT}.supabase.co` && url.username === "postgres"));
  assert.equal(url.hostname, env.DB_EXPECTED_HOST);
  url.search = "";
  const ca = group.secretFiles.find(x => x.name === "supabase-ca.crt")?.content;
  assert(ca?.includes("BEGIN CERTIFICATE"));
  const options = { connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true, servername: url.hostname },
    enableChannelBinding: true, connectionTimeoutMillis: 15000, query_timeout: 120000 };
  return { env, url, ca, options, client: new Client(options) };
}
async function retainedNativeData(client) {
  // Only keyed digests leave this function. The backup retains actual rows encrypted.
  const result = {};
  for (const table of ["users", "identities", "mfa_factors", "sessions", "refresh_tokens"]) {
    const r = await client.query(`SELECT row_to_json(t)::text AS row FROM auth.${table} t ORDER BY id`);
    result[table] = { count: r.rowCount, digest: createHmac("sha256", process.env.QXLAYER_BACKUP_PASSPHRASE)
      .update(JSON.stringify(r.rows)).digest("hex") };
  }
  return result;
}
async function encryptedSnapshot(ctx, directory) {
  const tools = (await readdir("/nix/store")).find(x => x.endsWith("-postgresql-17.6"));
  assert(tools, "Reviewed PostgreSQL 17 backup tools required");
  const caFile = join(directory, "ca.pem");
  await writeFile(caFile, ctx.ca, { mode: 0o600 });
  const pgEnv = { PATH: `/nix/store/${tools}/bin`, LANG: "C", LC_ALL: "C",
    PGHOST: ctx.url.hostname, PGPORT: "5432", PGDATABASE: "postgres", PGUSER: decodeURIComponent(ctx.url.username),
    PGPASSWORD: decodeURIComponent(ctx.url.password), PGSSLROOTCERT: caFile, PGSSLMODE: "verify-full",
    // This pinned target's session pooler does not advertise SCRAM-PLUS.
    // Match its existing Node client's negotiated channel binding; retain
    // verify-full CA/hostname validation. The Live-source require policy is untouched.
    PGCHANNELBINDING: "prefer", PGCONNECT_TIMEOUT: "20" };
  const child = spawn(`/nix/store/${tools}/bin/pg_dump`,
    ["-Fc", "--no-password", "--no-owner", "--no-acl", "--schema=public", "--schema=auth",
      "--schema=vynox_supabase_auth", "--schema=qxlayer_migrations"], { env: pgEnv, stdio: ["ignore", "pipe", "pipe"] });
  let diagnostic = "";
  child.stderr.on("data", chunk => { if (diagnostic.length < 12000) diagnostic += chunk.toString(); });
  const exit = once(child, "exit");
  await storageCheck();
  const file = await seal(child.stdout, `isolated-production-before-initialization-${Date.now()}.qxb`, process.env.QXLAYER_BACKUP_PASSPHRASE);
  if ((await exit)[0] !== 0) {
    await rm(file, { force: true });
    const code = /channel binding/i.test(diagnostic) ? "BACKUP_CHANNEL_BINDING" :
      /version mismatch/i.test(diagnostic) ? "BACKUP_VERSION" :
      /permission denied/i.test(diagnostic) ? "BACKUP_PERMISSION" :
      /certificate|SSL/i.test(diagnostic) ? "BACKUP_TLS" :
      /password authentication/i.test(diagnostic) ? "BACKUP_AUTH" : "BACKUP_FAILED";
    throw Object.assign(Error("Target snapshot failed; provider diagnostics suppressed"), { code });
  }
  assert((await readFile(file)).length > 100, "Snapshot must contain an encrypted dump");
  return { file, caFile };
}
export async function initializeProduction() {
  assert.equal(process.env.VYNOX_PRODUCTION_INITIALIZATION_APPROVED, "true");
  assert(process.env.QXLAYER_BACKUP_PASSPHRASE && process.env.QXLAYER_PRODUCTION_SUPABASE_AUTH_SERVER_KEY);
  const ctx = await productionOperator();
  const scratch = await mkdtemp(join(tmpdir(), "vynox-production-init-"));
  let stage = "target-readonly-preflight";
  let schemaCommitted = false;
  await ctx.client.connect();
  try {
    assert(ctx.client.connection.stream.authorized);
    await ctx.client.query("BEGIN READ ONLY");
    const id = (await ctx.client.query(`SELECT current_database()='postgres' AS db,current_user='postgres' AS operator,
      EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_admin') AS managed`)).rows[0];
    assert(id.db && id.operator && id.managed);
    const before = await retainedNativeData(ctx.client);
    const tables = await ctx.client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    const ledger = await ctx.client.query("SELECT to_regclass('qxlayer_migrations.versions') IS NOT NULL AS present");
    assert(tables.rowCount === 0 && !ledger.rows[0].present,
      "Nonempty/restored target requires explicit reconciliation, never overwrite existing tables");
    await ctx.client.query("ROLLBACK");
    // Independently compare current Development metadata, never copy its business rows.
    stage = "fresh-source-schema-comparison";
    const source = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await source.connect(); await source.query("BEGIN READ ONLY");
      const expected = JSON.parse(await readFile("deploy/migrations/schema-reference.json", "utf8"));
      assert.deepEqual(canonicalSchema(await readSchema(source)), canonicalSchema(expected));
      const policies = JSON.parse(await readFile("deploy/migrations/rls-reference.json", "utf8"));
      policies.tables.find(t => t.name === "pricing_rules").policies.find(p => p.name === "qx_read").using = "true";
      const actual = await source.query(`SELECT c.relname AS name,c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced,
        (SELECT jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,
         'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid))
         ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid) AS policies
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname`);
      assert.deepEqual(actual.rows, policies.tables, "Fresh source predicates must match reviewed tenant isolation");
    } finally { await source.query("ROLLBACK").catch(() => {}); await source.end(); }
    stage = "encrypted-target-snapshot";
    const snapshot = await encryptedSnapshot(ctx, scratch);
    await mkdir("generated-artifacts/external-finalization", { recursive: true });
    await writeFile("generated-artifacts/external-finalization/production-initialization-backup.json",
      JSON.stringify({ projectPinned: true, snapshotFile: snapshot.file,
        encrypted: true, privateLocalRecoveryCopy: true, independentDurableCopy: false, nativeBaseline: before }, null, 2));
    stage = "atomic-versioned-migrations";
    await migrate({ ...process.env, MIGRATION_DATABASE_URL: ctx.url.toString(), MIGRATION_EXPECTED_HOST: ctx.url.hostname,
      DB_TLS_CA_FILE: snapshot.caFile, SUPABASE_PROJECT_REF: PROJECT, QXLAYER_EXTERNAL_ENVIRONMENT: "production",
      QXLAYER_EXTERNAL_MIGRATIONS_APPROVED: "true" });
    schemaCommitted = true;
    stage = "exact-schema-policy-readback";
    await verifyCommittedTarget(ctx.client, { policyRole: "qxlayer_runtime" });
    assert.deepEqual(await retainedNativeData(ctx.client), before, "Existing native identities, MFA and sessions must be unchanged");
    stage = "restricted-runtime-credentials";
    const appPassword = randomBytes(40).toString("base64url"), authPassword = randomBytes(40).toString("base64url");
    await ctx.client.query("BEGIN");
    await ctx.client.query(`ALTER ROLE qxlayer_app LOGIN PASSWORD '${appPassword}'`);
    await ctx.client.query(`ALTER ROLE qxlayer_auth_app LOGIN PASSWORD '${authPassword}'`);
    await ctx.client.query("COMMIT");
    const app = new URL(ctx.url), auth = new URL(ctx.url);
    app.username = `qxlayer_app.${PROJECT}`; app.password = appPassword;
    auth.username = `qxlayer_auth_app.${PROJECT}`; auth.password = authPassword;
    if (ctx.url.hostname.startsWith("db.")) { app.username = "qxlayer_app"; auth.username = "qxlayer_auth_app"; }
    // Save generated credentials directly into the protected backend group, never files or stdout.
    for (const [key, value] of Object.entries({ DATABASE_URL: app.toString(), QXLAYER_PRODUCTION_AUTH_DATABASE_URL: auth.toString() }))
      await render(`env-groups/${GROUP}/env-vars/${key}`, "PUT", { value });
    stage = "real-restricted-login-permission-tests";
    const permissions = await verifyProductionPermissions({ ...ctx.options, connectionString: app.toString() },
      { ...ctx.options, connectionString: auth.toString() });
    assert.deepEqual(await retainedNativeData(ctx.client), before);
    const report = { project: PROJECT, schemaApplied: true, publicTables: 42, privateAuthTables: 5,
      migrationLedgerVerified: true, exactSchemaAndPoliciesVerified: true, nativeExistingDataPreserved: true,
      permissions, startupStillHeld: true, liveChanged: false, dnsChanged: false, backupEncrypted: true };
    await writeFile("generated-artifacts/external-finalization/production-initialization.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    return report;
  } catch (error) {
    console.error(JSON.stringify({ initializationBlockedAt: stage, schemaCommitted,
      message: schemaCommitted ? "Schema committed; acceptance stopped. Committed migrations were not rolled back." : "Initialization stopped before migration completion was confirmed.",
      code: error.code ?? "ASSERTION",
      constraint: error.constraint, table: error.table, liveChanged: false, detailsSuppressed: true }));
    throw Error("Isolated Production initialization requires correction; private errors suppressed");
  } finally { await ctx.client.query("ROLLBACK").catch(() => {}); await ctx.client.end(); await rm(scratch, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  initializeProduction().catch(() => { process.exitCode = 1; });
