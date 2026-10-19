import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { readSchema } from "../external-postgres/schema-reference.mjs";
import { targetScopePreflight } from "./target-scope-preflight.mjs";

const { Client } = createRequire(new URL("../../lib/db/package.json", import.meta.url))("pg");
export const TABLES = ["module_catalog", "entitlement_definitions", "asset_catalog", "network_catalog",
  "provider_catalog", "plans", "addons", "landing_products", "asset_network_catalog",
  "plan_entitlements", "addon_entitlements"];
const PACKAGE = "deploy/configuration/vynox-reference.json";
const OUTPUT = "generated-artifacts/external-finalization";
const PROJECT = "qcgvhlphalxqzzsxqjhi";
const GROUP = "evg-db936g3bc2fs73cmm5dg";
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const quote = name => { assert.match(name, /^[a-z_][a-z0-9_]*$/); return `"${name}"`; };

export function appliedVersionMatches(record, payload) {
  if (!record) return false;
  assert.equal(record.sha256, payload.dataSha256, "Applied reference versions are immutable; review and increment the package version");
  return true;
}
export function previouslyAppliedDataMatches(record,payload) {
  return !!record && Number.isSafeInteger(record.version) && record.version<payload.version && record.sha256===payload.dataSha256;
}

export function productionReferences(source) {
  assert.deepEqual(Object.keys(source).sort(), [...TABLES].sort());
  const result = structuredClone(source);
  // Retained customer-review fixtures must never be exported to Production.
  result.plans = result.plans.filter(p => !/temporary development only|not for real customers|not.*production/i.test(p.description));
  const retained = new Set(result.plans.map(p => p.id));
  result.plan_entitlements = result.plan_entitlements.filter(p => retained.has(p.plan_id));
  // Development demonstration plans are reference material, NOT commercial offers.
  for (const plan of result.plans) {
    assert.equal(plan.pricing_configured, false, "A newly priced plan needs explicit commercial review");
    plan.status = "disabled";
  }
  for (const addon of result.addons) {
    assert.equal(addon.pricing_confirmed, false, "A confirmed commercial add-on needs explicit review");
    addon.enabled = false;
  }
  for (const table of TABLES)
    for (const row of result[table])
      assert(!Object.hasOwn(row, "tenant_id"), "Tenant configuration is not global reference data");
  return result;
}

export async function captureDevelopment(version = 1) {
  assert(Number.isSafeInteger(version) && version > 0);
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await c.connect(); await c.query("BEGIN READ ONLY");
    const identity = (await c.query("SELECT current_database() db,current_user actor")).rows[0];
    assert.equal(identity.db, "heliumdb"); assert.equal(identity.actor, "postgres");
    await c.query("SELECT set_config('app.is_super_admin','true',true)");
    const schema = await readSchema(c), source = {};
    for (const table of TABLES) {
      // Retain exact decimals and timestamp precision, rather than JS numeric/Date rounding.
      const numbers = schema.columns.filter(x => x.table_name === table && /numeric|bigint/.test(x.type));
      const override = numbers.length ? " || jsonb_build_object(" +
        numbers.map(x => `'${x.name}',t.${quote(x.name)}::text`).join(",") + ")" : "";
      source[table] = (await c.query(`SELECT coalesce(jsonb_agg(r ORDER BY r::text),'[]') rows
        FROM (SELECT to_jsonb(t)${override} r FROM public.${quote(table)} t) s`)).rows[0].rows;
    }
    const data = productionReferences(source);
    await c.query("COMMIT");
    await mkdir("deploy/configuration", { recursive: true });
    const payload = { version, sourceSha256: digest(source), dataSha256: digest(data),
      policy: "Global reference data only; retained Development customer fixtures excluded; sample plans/add-ons disabled; no approved commercial prices invented",
      schema, data };
    await writeFile(PACKAGE, JSON.stringify(payload, null, 2) + "\n");
    return { captured: true, counts: Object.fromEntries(TABLES.map(t => [t, data[t].length])),
      excludedDevelopmentOnlyPlans: source.plans.length - data.plans.length };
  } finally { await c.query("ROLLBACK").catch(() => {}); await c.end(); }
}

async function fingerprint(c, table) {
  const { rows } = await c.query(`SELECT count(*)::int n,
    md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) digest
    FROM ${table} t`);
  return rows[0];
}

export async function synchronize({ apply = false, rehearse = false } = {}) {
  assert(!(apply && rehearse));
  assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "0");
  const payload = JSON.parse(await readFile(PACKAGE, "utf8"));
  assert(Number.isSafeInteger(payload.version) && payload.version > 0);
  assert.equal(digest(payload.data), payload.dataSha256);
  assert.deepEqual(Object.keys(payload.data).sort(), [...TABLES].sort());
  const response = await fetch(`https://api.render.com/v1/env-groups/${GROUP}`, {
    headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY}` }, signal: AbortSignal.timeout(20000) });
  assert(response.ok); const group = await response.json();
  const groupEnv = Object.fromEntries(group.envVars.map(v => [v.key, v.value]));
  const { env } = await targetScopePreflight({
    connectionString: process.env.QXLAYER_PRODUCTION_SUPABASE_DATABASE_URL ?? groupEnv.QXLAYER_PRODUCTION_SUPABASE_DATABASE_URL,
    scope: process.env.QXLAYER_OPERATOR_WRITE_SCOPE ?? "acceptance-only",
    publicWriteApproved: process.env.QXLAYER_PUBLIC_GLOBAL_WRITES_APPROVED === "true",
  });
  assert.equal(env.QXLAYER_PRODUCTION_SUPABASE_AUTH_PROJECT_REF, PROJECT);
  assert.equal(env.QXLAYER_EXTERNAL_ACCEPTANCE_APPROVED, "true");
  assert.equal(env.QXLAYER_PRODUCTION_SUPABASE_AUTH_CUTOVER_APPROVED, "false");
  const u = new URL(process.env.QXLAYER_PRODUCTION_SUPABASE_DATABASE_URL ?? env.QXLAYER_PRODUCTION_SUPABASE_DATABASE_URL);
  assert(u.toString() === new URL(env.QXLAYER_PRODUCTION_SUPABASE_DATABASE_URL).toString(), "Operator connection must match effective configuration");
  assert.equal(u.hostname, env.DB_EXPECTED_HOST);
  assert.equal(decodeURIComponent(u.username), `postgres.${PROJECT}`); u.search = "";
  const ca = group.secretFiles.find(f => f.name === "supabase-ca.crt")?.content;
  assert(ca?.includes("BEGIN CERTIFICATE"));
  const c = new Client({ connectionString: u.toString(), ssl: { ca, rejectUnauthorized: true,
    servername: u.hostname }, enableChannelBinding: true, connectionTimeoutMillis: 15000 });
  try {
    await c.connect();
    assert(c.connection.stream.encrypted && c.connection.stream.authorized);
    await c.query(apply || rehearse ? "BEGIN" : "BEGIN READ ONLY");
    await c.query("SELECT set_config('app.is_super_admin','true',true),set_config('lock_timeout','5s',true),set_config('TimeZone','UTC',true)");
    assert.deepEqual(await readSchema(c), payload.schema, "Schema/constraint/index drift requires separate review");
    const ledgerExists = (await c.query("SELECT to_regclass('qxlayer_migrations.reference_configuration') present")).rows[0].present;
    if (ledgerExists) {
      const previous = await c.query("SELECT sha256 FROM qxlayer_migrations.reference_configuration WHERE version=$1", [payload.version]);
      if (appliedVersionMatches(previous.rows[0], payload)) {
        await c.query("ROLLBACK");
        return { mode: "already-applied", version: payload.version, dataSha256: payload.dataSha256,
          operatorChangesAndDeletionsPreserved: true, publicLiveChanged: false, dnsChanged: false };
      }
      // A reviewed additive schema release may carry the exact same immutable
      // seed data. Never reapply that data over subsequent operator edits.
      const priorData=await c.query("SELECT version,sha256 FROM qxlayer_migrations.reference_configuration WHERE version<$1 AND sha256=$2 ORDER BY version DESC LIMIT 1",
        [payload.version,payload.dataSha256]);
      if(previouslyAppliedDataMatches(priorData.rows[0],payload)) {
        if(apply)await c.query("INSERT INTO qxlayer_migrations.reference_configuration(version,sha256) VALUES($1,$2)",[payload.version,payload.dataSha256]);
        await c.query(apply?"COMMIT":"ROLLBACK");
        return {mode:"reviewed-schema-data-already-applied",version:payload.version,dataSha256:payload.dataSha256,
          operatorChangesAndDeletionsPreserved:true,referenceRowsWritten:0,publicLiveChanged:false,dnsChanged:false};
      }
    }
    if (apply || rehearse)
      await c.query(`LOCK TABLE ${TABLES.map(t => `public.${quote(t)}`).join(",")},public.platform_admins IN SHARE ROW EXCLUSIVE MODE`);
    const excluded = [...new Set(payload.schema.columns.map(c => c.table_name))].filter(t => !TABLES.includes(t));
    const protectedTables = [...excluded.map(t => `public.${quote(t)}`), "vynox_supabase_auth.identity_links"];
    const before = {};
    for (const table of protectedTables) before[table] = await fingerprint(c, table);
    assert(before["public.\"platform_admins\""].n >= 1, "Existing accepted administrator access is required");
    await mkdir(OUTPUT, { recursive: true });
    const backup = {}, report = { mode: apply ? "applied" : rehearse ? "rollback-rehearsal" : "read-only",
      dataSha256: payload.dataSha256, counts: {}, protectedRecordsPreserved: false,
      publicLiveChanged: false, dnsChanged: false, samplePlansDisabled: true, commercialPricesApproved: false };
    for (const table of TABLES) {
      const pk = payload.schema.constraints.find(c => c.table_name === table && c.type === "p");
      assert(pk);
      const keys = pk.definition.match(/^PRIMARY KEY \(([^)]+)\)$/)[1].split(", ").map(s => s.replaceAll('"', ""));
      const match = keys.map(k => `p.${quote(k)}=s.${quote(k)}`).join(" AND ");
      const typed = `jsonb_populate_recordset(NULL::public.${quote(table)},$1::jsonb)`;
      const data = JSON.stringify(payload.data[table]);
      const conflicts = await c.query(`SELECT count(*)::int n FROM ${typed} s JOIN public.${quote(table)} p ON ${match}
        WHERE to_jsonb(p) IS DISTINCT FROM to_jsonb(s)`, [data]);
      assert.equal(conflicts.rows[0].n, 0, `Existing configuration conflict in ${table}; no overwrite allowed`);
      backup[table] = (await c.query(`SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') rows FROM public.${quote(table)} t`)).rows[0].rows;
      let inserted = 0;
      if (apply || rehearse)
        inserted = (await c.query(`INSERT INTO public.${quote(table)} SELECT * FROM ${typed} ON CONFLICT DO NOTHING`, [data])).rowCount;
      report.counts[table] = { source: payload.data[table].length, before: backup[table].length, inserted };
      if (apply || rehearse) {
        const found = await c.query(`SELECT count(*)::int n FROM ${typed} s JOIN public.${quote(table)} p ON ${match}
          WHERE to_jsonb(p)=to_jsonb(s)`, [data]);
        assert.equal(found.rows[0].n, payload.data[table].length, `Readback failed for ${table}`);
      }
    }
    for (const table of protectedTables) assert.deepEqual(await fingerprint(c, table), before[table], `Protected data changed: ${table}`);
    report.protectedRecordsPreserved = true;
    if (apply) {
      await writeFile(`${OUTPUT}/reference-configuration-before.json`, JSON.stringify(backup, null, 2),
        { mode: 0o600, flag: "wx" }).catch(error => { if (error.code !== "EEXIST") throw error; });
      await c.query(`CREATE TABLE IF NOT EXISTS qxlayer_migrations.reference_configuration
        (version integer PRIMARY KEY,sha256 text NOT NULL CHECK(length(sha256)=64),applied_at timestamptz NOT NULL DEFAULT now())`);
      await c.query("REVOKE ALL ON qxlayer_migrations.reference_configuration FROM PUBLIC,anon,authenticated,qxlayer_app,qxlayer_auth_app");
      await c.query("INSERT INTO qxlayer_migrations.reference_configuration(version,sha256) VALUES($1,$2)",
        [payload.version, payload.dataSha256]);
    }
    await c.query(apply ? "COMMIT" : "ROLLBACK");
    await writeFile(`${OUTPUT}/reference-configuration-${report.mode}.json`, JSON.stringify(report, null, 2));
    return report;
  } finally { await c.query("ROLLBACK").catch(() => {}); await c.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = process.argv.includes("--capture-development") ? await captureDevelopment(Number(process.argv.find(a => a.startsWith("--version="))?.split("=")[1] ?? 1))
      : await synchronize({ apply: process.argv.includes("--apply-approved-reference"), rehearse: process.argv.includes("--rehearse") });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ synchronizationBlocked: true, code: error.code ?? "REVIEW_REQUIRED",
      reason: error.code === "ERR_ASSERTION" ? error.message.split("\n")[0] : "Private details suppressed" }));
    process.exitCode = 1;
  }
}
