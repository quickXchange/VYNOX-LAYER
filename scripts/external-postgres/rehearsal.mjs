import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { migrate, targetConfiguration } from "./migrate.mjs";
import { verifyTarget } from "./verify-target.mjs";
const require = createRequire(new URL("../../lib/db/package.json", import.meta.url));
const { Client } = require("pg");
if (process.env.NODE_ENV !== "test" || process.env.QXLAYER_MIGRATION_TEST !== "true")
  throw new Error("Rehearsal only runs against disposable local PostgreSQL.");
const admin = new Client(targetConfiguration(process.env));
await admin.connect();
let runtime;
try {
  const existing = await admin.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'");
  assert.equal(existing.rows[0].n, 0, "Disposable database must start empty.");
  // Local stand-ins test SQL syntax/semantics; they are NOT cloud Supabase proof.
  await admin.query("CREATE ROLE supabase_admin NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN");
  await migrate();
  await migrate(); // Idempotent ledger, not repeated schema creation.
  await verifyTarget(admin, { planManagement: true });
  // This role exists only in the guarded disposable database. Never reuse a
  // published/shared fixture credential; base64url contains no SQL quote characters.
  const disposablePassword = randomBytes(32).toString("base64url");
  await admin.query(`ALTER ROLE qxlayer_app LOGIN PASSWORD '${disposablePassword}'`);
  const a = "10000000-0000-4000-8000-000000000001", b = "10000000-0000-4000-8000-000000000002";
  await admin.query("INSERT INTO tenants(id,name,slug,status) VALUES ($1,'Synthetic A','synthetic-a','active'),($2,'Synthetic B','synthetic-b','active')", [a,b]);
  await admin.query("INSERT INTO tenant_branding(tenant_id,brand_name) VALUES ($1,'Synthetic A'),($2,'Synthetic B')", [a,b]);
  await admin.query("INSERT INTO tenant_memberships(tenant_id,clerk_user_id,role) VALUES ($1,'synthetic-a','client_admin'),($2,'synthetic-b','client_admin')", [a,b]);
  const url = new URL(process.env.MIGRATION_DATABASE_URL);
  url.username = "qxlayer_app"; url.password = disposablePassword;
  runtime = new Client({ connectionString: url.toString() });
  await runtime.connect();
  await assert.rejects(runtime.query("SELECT * FROM tenant_branding"), e => e.code === "42501");
  async function scope(context, operation) {
    await runtime.query(context.write ? "BEGIN" : "BEGIN READ ONLY");
    try {
      await runtime.query("SET LOCAL ROLE qxlayer_runtime");
      await runtime.query("SET LOCAL search_path=pg_catalog,public");
      await runtime.query("SET LOCAL row_security=on");
      await runtime.query(`SELECT set_config('app.actor_id',$1,true),set_config('app.tenant_id',$2,true),
        set_config('app.is_super_admin',$3,true),set_config('app.can_write',$4,true),
        set_config('app.public_slug',$5,true),set_config('app.public_domain','',true),
        set_config('app.can_manage_staff',$6,true)`,
        [context.actor??"",context.tenant??"",String(!!context.root),String(!!context.write),context.slug??"",String(!!context.staff)]);
      const flags = await runtime.query("SELECT session_user,current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
      assert.deepEqual(flags.rows[0], { session_user: "qxlayer_app", current_user: "qxlayer_runtime", rolsuper: false, rolbypassrls: false });
      const value = await operation(runtime);
      await runtime.query("COMMIT"); return value;
    } catch (error) { await runtime.query("ROLLBACK"); throw error; }
  }
  assert.equal((await scope({}, c => c.query("SELECT * FROM tenant_branding"))).rowCount, 0);
  assert.equal((await scope({tenant:a}, c => c.query("SELECT * FROM tenant_branding"))).rows[0].tenant_id, a);
  assert.equal((await scope({actor:"synthetic-a"}, c => c.query("SELECT * FROM tenants"))).rowCount, 1);
  assert.equal((await scope({slug:"synthetic-a"}, c => c.query("SELECT * FROM tenant_branding"))).rowCount, 1);
  assert.equal((await scope({root:true}, c => c.query("SELECT * FROM tenant_branding"))).rowCount, 2);
  await scope({tenant:a,write:true}, async c => {
    assert.equal((await c.query("UPDATE tenant_branding SET brand_name='Synthetic A edited' WHERE tenant_id=$1",[a])).rowCount,1);
    assert.equal((await c.query("UPDATE tenant_branding SET brand_name='Denied' WHERE tenant_id=$1",[b])).rowCount,0);
    assert.equal((await c.query("DELETE FROM tenant_branding WHERE tenant_id=$1",[b])).rowCount,0);
  });
  await assert.rejects(scope({tenant:a,write:true}, c => c.query(
    "INSERT INTO tenant_branding(tenant_id,brand_name) VALUES ($1,'Denied')",[b])), e => e.code==="42501");
  await assert.rejects(scope({tenant:a,write:true}, c => c.query(
    "INSERT INTO tenant_memberships(tenant_id,clerk_user_id,role) VALUES ($1,'synthetic-staff','staff')",[a])), e => e.code==="42501");
  await scope({tenant:a,write:true,staff:true}, c => c.query(
    "INSERT INTO tenant_memberships(tenant_id,clerk_user_id,role) VALUES ($1,'synthetic-staff','staff')",[a]));
  await assert.rejects(scope({tenant:a}, c => c.query("UPDATE tenant_branding SET brand_name='Denied' WHERE tenant_id=$1",[a])), e => e.code==="25006");
  await assert.rejects(scope({root:true,write:false}, c => c.query("INSERT INTO tenants(name,slug) VALUES ('Denied','denied')")), e => e.code==="25006");
  await assert.rejects(scope({tenant:a,write:true}, async c => { await c.query("SELECT 1"); throw new Error("synthetic rollback"); }));
  const cleared = await runtime.query("SELECT current_user,current_setting('app.tenant_id',true) AS tenant,current_setting('app.is_super_admin',true) AS root");
  assert.equal(cleared.rows[0].current_user,"qxlayer_app");
  assert.ok(!cleared.rows[0].tenant); assert.notEqual(cleared.rows[0].root,"true");
  assert.equal((await scope({tenant:b}, c => c.query("SELECT * FROM tenant_branding"))).rows[0].tenant_id,b);
  console.info("Restricted-login RLS rehearsal passed: own/foreign CRUD, staff, public, root, read-only and context cleanup.");
} finally { if (runtime) await runtime.end(); await admin.end(); }
