import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, copyFile, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const { Client } = createRequire(new URL("../../lib/db/package.json", import.meta.url))("pg");
const base = "0001_base.sql", next = "0002_next.sql", last = "0003_last.sql";
const baseSql = "CREATE SCHEMA fixture; CREATE TABLE fixture.kept (id integer PRIMARY KEY); INSERT INTO fixture.kept VALUES (1);";
const nextSql = "ALTER TABLE fixture.kept ADD COLUMN pending text; CREATE TABLE fixture.pending (id integer);";
const lastSql = "CREATE TABLE fixture.last (id integer);";
const hash = sql => createHash("sha256").update(sql).digest("hex");

// Run an unchanged copy of the real runner, with its relative manifest directory
// containing only synthetic SQL. No production test hooks or deployed files change.
// Neither PostgreSQL nor the child runner inherits credentials or PG* settings.
test("migration history and atomic rollback in disposable local PostgreSQL", { timeout: 120000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "migration-regression-"));
  const data = join(root, "data");
  const env = { PATH: process.env.PATH, HOME: root, LANG: "C", LC_ALL: "C" };
  const run = (bin, args) => execFileSync(bin, args, { env, stdio: "pipe", timeout: 30000 });
  let started = false, client;
  try {
    run("initdb", ["-D", data, "-U", "postgres", "--auth=trust", "--no-locale"]);
    run("pg_ctl", ["-D", data, "-l", join(root, "postgres.log"), "-o",
      `-c listen_addresses='' -c unix_socket_directories='${root}'`, "-w", "start"]);
    started = true;
    client = new Client({ host: root, port: 5432, database: "postgres", user: "postgres", password: "", ssl: false });
    await client.connect();
    await client.query("CREATE ROLE supabase_admin NOLOGIN");
    for (const dir of ["scripts/external-postgres", "scripts/external-hosting", "deploy/migrations", "lib"])
      await mkdir(join(root, dir), { recursive: true });
    for (const file of ["external-postgres/migrate.mjs", "external-postgres/legacy-data-receipts.mjs", "external-hosting/staging-targets.mjs",
      "external-hosting/target-scope-preflight.mjs"])
      await copyFile(new URL(`../${file}`, import.meta.url), join(root, "scripts", file));
    await symlink(fileURLToPath(new URL("../../lib/db", import.meta.url)), join(root, "lib/db"));
    const entrypoint = join(root, "run.mjs");
    await writeFile(entrypoint, `import { migrate } from "./scripts/external-postgres/migrate.mjs";
try { await migrate(); } catch (error) {
  console.error(JSON.stringify({ message: error.message, code: error.code }));
  process.exitCode = 1;
}`);
    // pg resolves this explicit host to our private Unix socket. There is no TCP
    // listener and no URL/env input from the caller or a hosted database.
    const url = new URL("postgresql://postgres@localhost/postgres");
    url.searchParams.set("host", root);
    const migrationEnv = { ...env, NODE_ENV: "test", QXLAYER_MIGRATION_TEST: "true",
      QXLAYER_EXTERNAL_MIGRATIONS_APPROVED: "true", MIGRATION_DATABASE_URL: url.href };
    const migrate = () => {
      try {
        return { ok: true, stdout: execFileSync(process.execPath, [entrypoint],
          { env: migrationEnv, encoding: "utf8", stdio: "pipe", timeout: 15000 }) };
      } catch (error) {
        assert.equal(error.status, 1, "runner must reject, not time out or crash");
        let failure;
        try { failure = JSON.parse(error.stderr.trim()); }
        catch { assert.fail(`Migration child failed before returning a structured error:\n${error.stderr}`); }
        return { ok: false, stdout: error.stdout, ...failure };
      }
    };
    async function manifest(entries) {
      for (const [file, sql] of entries)
        await writeFile(join(root, "deploy/migrations", file), sql);
      await writeFile(join(root, "deploy/migrations/manifest.json"),
        JSON.stringify(entries.map(([file, sql]) => ({ file, sha256: hash(sql) }))));
    }
    async function reset() {
      await client.query("DROP SCHEMA IF EXISTS fixture CASCADE; DROP SCHEMA IF EXISTS qxlayer_migrations CASCADE");
    }
    async function snapshot() {
      return {
        columns: (await client.query(`SELECT table_schema,table_name,column_name,data_type
          FROM information_schema.columns WHERE table_schema IN ('fixture','qxlayer_migrations')
          ORDER BY table_schema,table_name,ordinal_position`)).rows,
        ledger: (await client.query("SELECT file,sha256,applied_at::text FROM qxlayer_migrations.versions ORDER BY file")).rows,
        data: (await client.query("SELECT * FROM fixture.kept ORDER BY id")).rows,
      };
    }
    async function seed() {
      await reset();
      await manifest([[base, baseSql]]);
      assert.equal(migrate().ok, true);
      return snapshot();
    }
    const all = [[base, baseSql], [next, nextSql], [last, lastSql]];

    await t.test("successful ordered migrations are committed and replay is a no-op", async () => {
      await seed();
      await manifest(all);
      assert.equal(migrate().ok, true);
      const before = await snapshot();
      assert.deepEqual(before.ledger.map(row => row.file), [base, next, last]);
      assert.ok(before.columns.some(row => row.column_name === "pending"));
      assert.equal(migrate().ok, true);
      assert.deepEqual(await snapshot(), before);
    });
    await t.test("rejects a matching-checksum history with a missing earlier version", async () => {
      await reset();
      // Commit a genuine later migration, then introduce an earlier manifest entry.
      await manifest([[next, baseSql]]);
      assert.equal(migrate().ok, true);
      const before = await snapshot();
      await manifest([[base, "CREATE TABLE fixture.earlier (id integer);"], [next, baseSql], [last, lastSql]]);
      const result = migrate();
      assert.equal(result.ok, false);
      assert.match(result.message, /history is not an ordered prefix/);
      assert.deepEqual(await snapshot(), before);
    });
    await t.test("rejects changed applied SQL even when its new manifest checksum is valid", async () => {
      const before = await seed();
      await manifest([[base, `${baseSql}\n-- changed after application`], [next, nextSql]]);
      const result = migrate();
      assert.equal(result.ok, false);
      assert.match(result.message, /Unknown or changed applied migration/);
      assert.deepEqual(await snapshot(), before);
    });
    await t.test("competing lock holder blocks migration without changes, then allows retry", async () => {
      const before = await seed();
      await manifest(all);
      await client.query("SELECT pg_advisory_lock(hashtextextended('qxlayer-external-migrations',0))");
      try {
        const result = migrate();
        assert.equal(result.ok, false);
        assert.match(result.message, /Another migration job holds the lock/);
        assert.deepEqual(await snapshot(), before);
      } finally {
        await client.query("SELECT pg_advisory_unlock(hashtextextended('qxlayer-external-migrations',0))");
      }
      assert.equal(migrate().ok, true);
      assert.deepEqual((await snapshot()).ledger.map(row => row.file), [base, next, last]);
    });
    await t.test("later SQL failure rolls back pending DDL and ledger, preserving prior commit", async () => {
      const before = await seed();
      await manifest([[base, baseSql], [next, nextSql], [last,
        `${lastSql} INSERT INTO fixture.kept(id) VALUES (1);`]]);
      const result = migrate();
      assert.equal(result.ok, false);
      assert.equal(result.code, "23505");
      assert.match(result.stdout, /Prepared migration applied: 0002_next.sql/);
      assert.deepEqual(await snapshot(), before);
      // Same SQL for the rolled-back earlier migration must be runnable again;
      // the failed job must also have released its session advisory lock.
      await manifest(all);
      assert.equal(migrate().ok, true);
      assert.deepEqual((await snapshot()).ledger.map(row => row.file), [base, next, last]);
    });
    await t.test("deferred COMMIT failure rolls back all prepared versions and schema changes", async () => {
      const before = await seed();
      await manifest([[base, baseSql], [next, nextSql], [last, `${lastSql}
        ALTER TABLE fixture.last ADD CONSTRAINT deferred_parent FOREIGN KEY(id)
          REFERENCES fixture.kept(id) DEFERRABLE INITIALLY DEFERRED;
        INSERT INTO fixture.last VALUES (999);`]]);
      const result = migrate();
      assert.equal(result.ok, false);
      assert.equal(result.code, "23503");
      assert.match(result.stdout, /Prepared migration applied: 0003_last.sql/);
      assert.deepEqual(await snapshot(), before);
      await manifest(all);
      assert.equal(migrate().ok, true);
    });
    await t.test("first-run failure removes the newly created ledger schema as well as DDL", async () => {
      await reset();
      await manifest([[base, baseSql], [next, `${nextSql} SELECT 1/0;`]]);
      const result = migrate();
      assert.equal(result.ok, false);
      assert.equal(result.code, "22012");
      assert.match(result.stdout, /Prepared migration applied: 0001_base.sql/);
      assert.deepEqual((await client.query(`SELECT nspname FROM pg_namespace
        WHERE nspname IN ('fixture','qxlayer_migrations')`)).rows, []);
      await manifest(all);
      assert.equal(migrate().ok, true);
    });
  } finally {
    try { await client?.end(); }
    finally {
      try { if (started) run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]); }
      finally { await rm(root, { recursive: true, force: true }); }
    }
  }
});
