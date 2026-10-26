import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const { Client } = createRequire(new URL("../../lib/db/package.json", import.meta.url))("pg");
const hash = text => createHash("sha256").update(text).digest("hex");
const directory = new URL("../../deploy/production-candidate/", import.meta.url);
const name = "0014_subscription_trials.sql";

test("Production trial migration is append-only, checksummed and schema-only", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", directory)));
  assert.equal(manifest.at(-1).file, name);
  assert.equal(manifest.filter(entry => entry.file === name).length, 1);
  for (const entry of manifest) {
    const sql = await readFile(new URL(entry.source ?? entry.file, directory), "utf8");
    assert.equal(hash(sql), entry.sha256, entry.file);
  }
  const sql = await readFile(new URL(name, directory), "utf8");
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|DROP|COMMIT|BEGIN;)\b/i);
});

test("trial migration preserves agreements/security and rolls back atomically in disposable PostgreSQL", { timeout: 120000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "trial-release-"));
  // No inherited credentials, PG settings or hosted endpoints.
  const env = { PATH: process.env.PATH, HOME: root, LANG: "C", LC_ALL: "C" };
  const run = (bin, args) => execFileSync(bin, args, { env, stdio: "pipe", timeout: 30000 });
  let started = false, client;
  try {
    run("initdb", ["-D", join(root, "data"), "-U", "postgres", "--auth=trust", "--no-locale"]);
    run("pg_ctl", ["-D", join(root, "data"), "-l", join(root, "postgres.log"), "-o",
      `-c listen_addresses='' -c unix_socket_directories='${root}'`, "-w", "start"]);
    started = true;
    client = new Client({ host: root, database: "postgres", user: "postgres", password: "", ssl: false });
    await client.connect();
    await client.query(`CREATE ROLE supabase_admin NOLOGIN;
      CREATE ROLE trial_runtime NOLOGIN;
      CREATE TABLE public.tenant_subscriptions (id integer PRIMARY KEY, agreement jsonb NOT NULL);
      INSERT INTO public.tenant_subscriptions VALUES (1, '{"amount":125,"status":"active"}');
      ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.tenant_subscriptions FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_only ON public.tenant_subscriptions USING (id = 1);
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_subscriptions TO trial_runtime;`);
    const security = async () => (await client.query(`SELECT relrowsecurity,relforcerowsecurity,relacl::text,
      (SELECT jsonb_agg(jsonb_build_object('name',polname,'using',pg_get_expr(polqual,polrelid)))
       FROM pg_policy WHERE polrelid=c.oid) AS policies
      FROM pg_class c WHERE c.oid='public.tenant_subscriptions'::regclass`)).rows;
    const beforeSecurity = await security();
    for (const dir of ["scripts/external-postgres", "scripts/external-hosting", "deploy/production-candidate", "lib"])
      await mkdir(join(root, dir), { recursive: true });
    for (const file of ["external-postgres/migrate.mjs", "external-postgres/legacy-data-receipts.mjs",
      "external-hosting/staging-targets.mjs", "external-hosting/target-scope-preflight.mjs"])
      await copyFile(new URL(`../${file}`, import.meta.url), join(root, "scripts", file));
    await symlink(fileURLToPath(new URL("../../lib/db", import.meta.url)), join(root, "lib/db"));
    const sql = await readFile(new URL(name, directory), "utf8");
    const fixtureDir = join(root, "deploy/production-candidate");
    await writeFile(join(fixtureDir, name), sql);
    const manifest = [{ file: name, sha256: hash(sql) }];
    const writeManifest = rows => writeFile(join(fixtureDir, "manifest.json"), JSON.stringify(rows));
    await writeManifest(manifest);
    const url = new URL("postgresql://postgres@localhost/postgres");
    url.searchParams.set("host", root);
    const migrationEnv = { ...env, NODE_ENV: "test", QXLAYER_MIGRATION_TEST: "true",
      QXLAYER_EXTERNAL_MIGRATIONS_APPROVED: "true", MIGRATION_DATABASE_URL: url.href,
      QXLAYER_EXTERNAL_ENVIRONMENT: "production", SUPABASE_PROJECT_REF: "qcgvhlphalxqzzsxqjhi",
      VYNOX_PRODUCTION_INITIALIZATION_APPROVED: "true" };
    const migrate = () => execFileSync(process.execPath, [join(root, "scripts/external-postgres/migrate.mjs")],
      { env: migrationEnv, stdio: "pipe", timeout: 15000 });
    await t.test("later failure rolls back both the column and migration ledger", async () => {
      const failure = "SELECT 1/0;";
      await writeFile(join(fixtureDir, "0015_failure.sql"), failure);
      await writeManifest([...manifest, { file: "0015_failure.sql", sha256: hash(failure) }]);
      assert.throws(migrate);
      assert.equal((await client.query(`SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema='public' AND table_name='tenant_subscriptions' AND column_name='trial'`)).rows[0].n, 0);
      assert.equal((await client.query("SELECT to_regclass('qxlayer_migrations.versions') AS ledger")).rows[0].ledger, null);
      await writeManifest(manifest);
    });
    await t.test("incompatible existing column is rejected without ledger writes", async () => {
      await client.query("ALTER TABLE public.tenant_subscriptions ADD COLUMN trial text");
      assert.throws(migrate);
      assert.equal((await client.query("SELECT to_regclass('qxlayer_migrations.versions') AS ledger")).rows[0].ledger, null);
      await client.query("ALTER TABLE public.tenant_subscriptions DROP COLUMN trial");
    });
    await t.test("success and rerun preserve data, trial state, policies and grants", async () => {
      migrate();
      assert.deepEqual((await client.query("SELECT * FROM public.tenant_subscriptions")).rows,
        [{ id: 1, agreement: { amount: 125, status: "active" }, trial: null }]);
      assert.deepEqual(await security(), beforeSecurity);
      const ledger = (await client.query("SELECT * FROM qxlayer_migrations.versions")).rows;
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0].sha256, hash(sql));
      await client.query(`UPDATE public.tenant_subscriptions SET trial='{"state":"cancelled"}'`);
      migrate();
      assert.deepEqual((await client.query("SELECT * FROM qxlayer_migrations.versions")).rows, ledger);
      assert.deepEqual((await client.query("SELECT trial FROM public.tenant_subscriptions")).rows[0].trial, { state: "cancelled" });
      assert.deepEqual(await security(), beforeSecurity);
    });
  } finally {
    await client?.end();
    if (started) run("pg_ctl", ["-D", join(root, "data"), "-m", "immediate", "-w", "stop"]);
    await rm(root, { recursive: true, force: true });
  }
});
