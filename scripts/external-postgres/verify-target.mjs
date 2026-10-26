import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readSchema, canonicalSchema } from "./schema-reference.mjs";

/** Only call after the migration has committed; failed readback cannot undo it. */
export async function verifyCommittedTarget(client, options) {
  try {
    await verifyTarget(client, options);
  } catch (cause) {
    const error = new Error("Schema is committed; post-commit verification failed. Acceptance stopped; no rollback was performed.", { cause });
    error.code = "POST_COMMIT_VERIFICATION_FAILED";
    error.schemaCommitted = true;
    throw error;
  }
}

/** Read-only schema/security readback, never repairs or silently accepts drift. */
export async function verifyTarget(client, { policyRole = "PUBLIC", planManagement = false } = {}) {
  const expected = JSON.parse(await readFile(new URL("../../deploy/migrations/rls-reference.json", import.meta.url), "utf8"));
  if (policyRole === "qxlayer_runtime") {
    // Approved public pricing rules are read-only public configuration, not tenant secrets.
    expected.tables.find(t => t.name === "pricing_rules").policies.find(p => p.name === "qx_read").using = "true";
  }
  const schema = JSON.parse(await readFile(new URL("../../deploy/migrations/schema-reference.json", import.meta.url), "utf8"));
  const site = JSON.parse(await readFile(new URL("../../deploy/migrations/site-release-reference.json", import.meta.url), "utf8"));
  if (planManagement) {
    const plans = JSON.parse(await readFile(new URL("../../deploy/migrations/plan-management-reference.json", import.meta.url), "utf8"));
    for (const key of ["columns", "constraints", "indexes"]) schema[key].push(...plans[key]);
  }
  for (const key of ["columns", "constraints", "indexes"])
    schema[key] = [...schema[key], ...site[key]].sort((a,b) => a.table_name.localeCompare(b.table_name) || (key === "columns" ? 0 : a.name.localeCompare(b.name)));
  expected.tables = [...expected.tables, ...site.tables].sort((a,b) => a.name.localeCompare(b.name));
  assert.deepEqual(canonicalSchema(await readSchema(client)), canonicalSchema(schema),
    "Actual columns, reviewed constant defaults, constraints and indexes must match.");
  const actual = await client.query(`SELECT c.relname AS name,c.relrowsecurity AS enabled,
    c.relforcerowsecurity AS forced,
    (SELECT jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,
      'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid))
      ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid) AS policies
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname`);
  assert.deepEqual(actual.rows, expected.tables, "Exact tables, RLS/FORCE and all predicates must match.");
  assert(["PUBLIC", "qxlayer_runtime"].includes(policyRole));
  const targets = await client.query(`SELECT bool_and(polpermissive AND polroles=ARRAY[
    CASE WHEN $1='PUBLIC' OR c.relname IN ('global_exchange_catalog','global_exchange_catalog_links')
      THEN 0::oid ELSE (SELECT oid FROM pg_roles WHERE rolname=$1) END]) AS safe
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public'`, [policyRole]);
  assert.equal(targets.rows[0]?.safe,true,"Policy role targets/permissiveness must match the source.");
  const roles = await client.query(`SELECT rolname,rolsuper,rolbypassrls,rolinherit,rolcreatedb,rolcreaterole,rolreplication
    FROM pg_roles WHERE rolname IN ('qxlayer_app','qxlayer_runtime') ORDER BY rolname`);
  assert.equal(roles.rowCount, 2);
  for (const role of roles.rows)
    for (const flag of ["rolsuper","rolbypassrls","rolinherit","rolcreatedb","rolcreaterole","rolreplication"])
      assert.equal(role[flag], false, `Restricted ${role.rolname} ${flag}`);
  const memberships = await client.query(`SELECT parent.rolname AS parent,child.rolname AS child,m.inherit_option,m.set_option
    FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles child ON child.oid=m.member
    WHERE child.rolname IN ('qxlayer_app','qxlayer_runtime')`);
  assert.deepEqual(memberships.rows, [{ parent: "qxlayer_runtime", child: "qxlayer_app", inherit_option: false, set_option: true }]);
  for (const { name } of expected.tables) {
    const grants = await client.query(`SELECT priv,
      has_table_privilege('qxlayer_runtime', $1, priv) AS allowed,
      has_table_privilege('qxlayer_app', $1, priv) AS login_allowed
      FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS priv`, [`public.${name}`]);
    for (const row of grants.rows) {
      assert.equal(row.allowed, ["SELECT","INSERT","UPDATE","DELETE"].includes(row.priv));
      assert.equal(row.login_allowed, false, "Application login must explicitly SET LOCAL ROLE.");
    }
    const owners = await client.query(`SELECT r.rolname FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner
      WHERE c.oid=$1::regclass`, [`public.${name}`]);
    assert.equal(["qxlayer_app","qxlayer_runtime"].includes(owners.rows[0].rolname), false);
    const apiRoles = await client.query(`SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')`);
    for (const { rolname } of apiRoles.rows) {
      const access = await client.query("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') AS allowed", [rolname, `public.${name}`]);
      assert.equal(access.rows[0].allowed, false, "Supabase API roles have no application-table access.");
    }
  }
  for (const name of expected.sequences) {
    const result = await client.query(`SELECT has_sequence_privilege('qxlayer_runtime',$1,'USAGE') AS usage,
      has_sequence_privilege('qxlayer_runtime',$1,'SELECT') AS read,
      has_sequence_privilege('qxlayer_runtime',$1,'UPDATE') AS write`, [`public.${name}`]);
    assert.deepEqual(result.rows[0], { usage: true, read: true, write: false });
  }
  const create = await client.query("SELECT has_schema_privilege('qxlayer_runtime','public','CREATE') AS allowed");
  assert.equal(create.rows[0].allowed, false);
  console.info(`Verified exact ${expected.tables.length} tables, ${expected.tables.length * 2} policies, FORCE and least-privilege grants.`);
}
