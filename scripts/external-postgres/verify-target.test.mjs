import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { verifyTarget, verifyCommittedTarget } from "./verify-target.mjs";

const { Client } = createRequire(new URL("../../lib/db/package.json", import.meta.url))("pg");
const quote = value => `"${value.replaceAll('"', '""')}"`;

// No connection URL or inherited PG* settings: this suite owns a private socket,
// a fresh data directory and all synthetic roles. No TCP listener is opened.
test("exact external policy targets and least privilege in disposable PostgreSQL", { timeout: 120000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "verify-target-"));
  const data = join(root, "data");
  const env = { PATH: process.env.PATH, HOME: root, LANG: "C", LC_ALL: "C" };
  const run = (bin, args) => execFileSync(bin, args, { env, stdio: "pipe" });
  let started = false, client;
  try {
    run("initdb", ["-D", data, "-U", "postgres", "--auth=trust", "--no-locale"]);
    run("pg_ctl", ["-D", data, "-l", join(root, "log"), "-o",
      `-c listen_addresses='' -c unix_socket_directories='${root}'`, "-w", "start"]);
    started = true;
    client = new Client({ host: root, port: 5432, database: "postgres", user: "postgres", password: "", ssl: false });
    await client.connect();
    await client.query(`CREATE ROLE supabase_admin; CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE ROLE service_role; CREATE ROLE fixture_extra;
      SET qxlayer.external_migration_authorized='yes'`);
    // Load reviewed application DDL, not captured business data or hosted credentials.
    for (const file of ["0001_application_schema.sql", "0002_runtime_security.sql",
      "0007_global_exchange_catalog.sql", "0008_tenant_site_releases.sql", "0011_plan_feature_rows.sql"]) {
      await client.query(await readFile(new URL(`../../deploy/migrations/${file}`, import.meta.url), "utf8"));
    }
    await client.query("SET search_path=public,pg_catalog");
    await t.test("default PUBLIC policy mode still passes", () => verifyTarget(client));
    // Match the external runtime policy mode, keeping ONLY the two reviewed exceptions.
    await client.query(`DO $$ DECLARE p record; BEGIN
      FOR p IN SELECT tablename,policyname FROM pg_policies WHERE schemaname='public'
        AND tablename NOT IN ('global_exchange_catalog','global_exchange_catalog_links')
      LOOP EXECUTE format('ALTER POLICY %I ON public.%I TO qxlayer_runtime',p.policyname,p.tablename); END LOOP;
      END $$;
      ALTER POLICY qx_read ON pricing_rules USING (true)`);
    const verify = () => verifyTarget(client, { policyRole: "qxlayer_runtime" });
    await t.test("runtime mode permits exactly the reviewed PUBLIC exceptions", verify);
    await t.test("name[] metadata may remain a string; role comparisons stay inside PostgreSQL", async () => {
      const metadata = await client.query("SELECT roles FROM pg_policies WHERE schemaname='public'");
      assert.equal(typeof metadata.rows[0].roles, "string");
      await verify();
    });
    async function rejectsDrift(name, sql, message) {
      await t.test(name, async () => {
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await assert.rejects(verify, message);
        } finally {
          await client.query("ROLLBACK");
          await verify();
        }
      });
    }
    for (const role of ["qxlayer_app", "qxlayer_runtime"]) {
      for (const flag of ["SUPERUSER", "BYPASSRLS", "INHERIT", "CREATEDB", "CREATEROLE", "REPLICATION"]) {
        const column = flag === "SUPERUSER" ? "rolsuper" : `rol${flag.toLowerCase()}`;
        await rejectsDrift(`restricted ${role} rejects ${flag}`,
          `ALTER ROLE ${quote(role)} ${flag}`, new RegExp(`Restricted ${role} ${column}`));
      }
      await rejectsDrift(`unexpected membership for ${role}`,
        `GRANT fixture_extra TO ${quote(role)}`, assert.AssertionError);
      // Keep effective table grants identical to the baseline so ownership,
      // rather than the earlier excess-grant check, causes this rejection.
      await rejectsDrift(`application table owned by ${role}`,
        `ALTER TABLE tenants OWNER TO ${quote(role)};
         REVOKE ALL ON tenants FROM ${quote(role)};
         GRANT SELECT,INSERT,UPDATE,DELETE ON tenants TO qxlayer_runtime`,
        error => {
          assert.ok(error instanceof assert.AssertionError);
          assert.equal(error.actual, true);
          assert.equal(error.expected, false);
          assert.equal(error.message.includes("Application login"), false);
          return true;
        });
    }
    await rejectsDrift("required runtime membership is missing",
      "REVOKE qxlayer_runtime FROM qxlayer_app", assert.AssertionError);
    await rejectsDrift("runtime membership must not inherit privileges",
      "GRANT qxlayer_runtime TO qxlayer_app WITH INHERIT TRUE", assert.AssertionError);
    await rejectsDrift("runtime membership must permit explicit SET ROLE",
      "GRANT qxlayer_runtime TO qxlayer_app WITH SET FALSE", assert.AssertionError);
    for (const table of ["tenants", "tenant_releases"]) {
      await rejectsDrift(`disabled RLS on ${table}`,
        `ALTER TABLE ${quote(table)} DISABLE ROW LEVEL SECURITY`, /Exact tables, RLS\/FORCE/);
      await rejectsDrift(`disabled FORCE RLS on ${table}`,
        `ALTER TABLE ${quote(table)} NO FORCE ROW LEVEL SECURITY`, /Exact tables, RLS\/FORCE/);
    }
    const targetError = /Policy role targets\/permissiveness/;
    for (const table of ["tenants", "tenant_releases"]) {
      await rejectsDrift(`unrelated PUBLIC policy on ${table}`,
        `ALTER POLICY qx_read ON ${quote(table)} TO PUBLIC`, targetError);
    }
    for (const table of ["tenants", "global_exchange_catalog", "global_exchange_catalog_links"]) {
      const role = table === "tenants" ? "qxlayer_runtime" : "PUBLIC";
      // PostgreSQL normalizes TO PUBLIC,other_role to PUBLIC alone. Use a
      // genuine multi-role target, rather than expecting nonexistent metadata.
      await rejectsDrift(`extra role on ${table}`,
        `ALTER POLICY qx_read ON ${quote(table)} TO qxlayer_runtime,fixture_extra`, targetError);
      // Recreate with identical predicate/command so only permissiveness differs.
      const policy = (await client.query(`SELECT pg_get_expr(polqual,polrelid) AS predicate
        FROM pg_policy WHERE polrelid=$1::regclass AND polname='qx_read'`, [table])).rows[0];
      await rejectsDrift(`nonpermissive policy on ${table}`,
        `DROP POLICY qx_read ON ${quote(table)}; CREATE POLICY qx_read ON ${quote(table)}
        AS RESTRICTIVE FOR SELECT TO ${role} USING (${policy.predicate})`, targetError);
      await rejectsDrift(`changed USING on ${table}`,
        `ALTER POLICY qx_read ON ${quote(table)} USING (false)`, /all predicates must match/);
      await rejectsDrift(`changed WITH CHECK on ${table}`,
        `ALTER POLICY qx_write ON ${quote(table)} WITH CHECK (true)`, /all predicates must match/);
    }
    for (const table of ["global_exchange_catalog", "global_exchange_catalog_links"]) {
      await rejectsDrift(`exception must remain PUBLIC on ${table}`,
        `ALTER POLICY qx_read ON ${quote(table)} TO qxlayer_runtime`, targetError);
    }
    for (const priv of ["TRUNCATE", "REFERENCES", "TRIGGER"]) {
      await rejectsDrift(`excess runtime ${priv}`, `GRANT ${priv} ON tenants TO qxlayer_runtime`, assert.AssertionError);
    }
    for (const role of ["qxlayer_app", "PUBLIC", "anon", "authenticated", "service_role"]) {
      await rejectsDrift(`excess table access for ${role}`, `GRANT SELECT ON tenants TO ${role}`, assert.AssertionError);
    }
    await rejectsDrift("excess schema CREATE", "GRANT CREATE ON SCHEMA public TO qxlayer_runtime", assert.AssertionError);
    const reference = JSON.parse(await readFile(new URL("../../deploy/migrations/rls-reference.json", import.meta.url), "utf8"));
    assert.ok(reference.sequences.length);
    await rejectsDrift("excess sequence UPDATE",
      `GRANT UPDATE ON SEQUENCE ${quote(reference.sequences[0])} TO qxlayer_runtime`, assert.AssertionError);
    await t.test("pre-commit verification failure can roll back without claiming a commit", async () => {
      await client.query("BEGIN; ALTER POLICY qx_read ON tenants TO PUBLIC");
      try {
        await assert.rejects(verify, error => {
          assert.match(error.message, targetError);
          assert.equal(error.schemaCommitted, undefined);
          return true;
        });
      } finally { await client.query("ROLLBACK"); }
      await verify();
    });
    await t.test("post-commit failure reports committed schema, stops acceptance and does not roll back", async () => {
      await client.query("BEGIN; ALTER POLICY qx_read ON tenants TO PUBLIC; COMMIT");
      const queries = [];
      const observed = { query: (...args) => { queries.push(args[0]); return client.query(...args); } };
      await assert.rejects(() => verifyCommittedTarget(observed, { policyRole: "qxlayer_runtime" }), error => {
        assert.equal(error.code, "POST_COMMIT_VERIFICATION_FAILED");
        assert.equal(error.schemaCommitted, true);
        assert.match(error.message, /Schema is committed.*Acceptance stopped; no rollback was performed/);
        assert.match(error.cause.message, targetError);
        return true;
      });
      assert.equal(queries.some(sql => /\bROLLBACK\b/i.test(sql)), false);
      assert.equal((await client.query(`SELECT polroles=ARRAY[0::oid] AS committed
        FROM pg_policy WHERE polrelid='tenants'::regclass AND polname='qx_read'`)).rows[0].committed, true);
      await client.query("ALTER POLICY qx_read ON tenants TO qxlayer_runtime");
      await verifyCommittedTarget(client, { policyRole: "qxlayer_runtime" });
    });
    await t.test("plan schema matches its additive reference and public login cannot assume operator history access", async () => {
      await client.query(`CREATE SCHEMA IF NOT EXISTS qxlayer_commerce;
        CREATE TABLE IF NOT EXISTS qxlayer_commerce.offer_settings(plan_id uuid PRIMARY KEY,monthly boolean,yearly boolean);
        DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='qxlayer_public_app') THEN CREATE ROLE qxlayer_public_app; END IF; END $$;
        GRANT qxlayer_runtime TO qxlayer_public_app;
        GRANT USAGE ON SCHEMA qxlayer_commerce TO qxlayer_runtime;`);
      for (const file of ["plan-management-profiles.sql", "plan-management-release-safety.sql"])
        await client.query(await readFile(new URL(`../../lib/db/migrations/${file}`, import.meta.url), "utf8"));
      await verifyTarget(client, { policyRole: "qxlayer_runtime", planManagement: true });
      await client.query(`INSERT INTO qxlayer_commerce.pricing_publication_versions(revision,payload,reason,published_by)
        VALUES(repeat('a',64),'{}','synthetic','synthetic');
        SET row_security=on; SET SESSION AUTHORIZATION qxlayer_public_app; SET ROLE qxlayer_runtime;
        SET app.is_super_admin='true'; SET app.can_write='true'`);
      try {
        assert.equal((await client.query("SELECT count(*)::int AS n FROM qxlayer_commerce.pricing_publication_versions")).rows[0].n, 0);
        await assert.rejects(client.query(`INSERT INTO qxlayer_commerce.pricing_publication_versions(revision,payload,reason,published_by)
          VALUES(repeat('b',64),'{}','synthetic','synthetic')`), /row-level security/);
      } finally {
        await client.query("RESET ROLE; RESET SESSION AUTHORIZATION");
      }
    });
  } finally {
    await client?.end();
    try { if (started) run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]); }
    finally { await rm(root, { recursive: true, force: true }); }
  }
});
