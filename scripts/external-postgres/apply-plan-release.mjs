/** Explicit operator-only additive release. Never run at application startup. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { verifyTarget } from "./verify-target.mjs";
import { schemaLedger } from "./legacy-data-receipts.mjs";
const { Client } = createRequire(new URL("../../lib/db/package.json", import.meta.url))("pg");
const hash = x => createHash("sha256").update(x).digest("hex");
assert.equal(process.env.CONFIRM_PLAN_SCHEMA_RELEASE, "production-additive-only");
assert(process.env.QXLAYER_BACKUP_PASSPHRASE?.length >= 24, "Independent backup key required");
const url = new URL(process.env.QXLAYER_PRODUCTION_SUPABASE_DATABASE_URL);
assert(url.pathname === "/postgres" && (
  url.hostname === "db.qcgvhlphalxqzzsxqjhi.supabase.co" && decodeURIComponent(url.username) === "postgres" ||
  /\.pooler\.supabase\.com$/.test(url.hostname) && decodeURIComponent(url.username) === "postgres.qcgvhlphalxqzzsxqjhi"
), "Pinned operator target required");
for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(key);
assert(process.env.PLAN_RELEASE_CA_FILE, "Verified CA file required");
const c = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 15000, enableChannelBinding: true,
  ssl: { rejectUnauthorized: true, servername: url.hostname, ca: await readFile(process.env.PLAN_RELEASE_CA_FILE, "utf8") } });
const manifest = JSON.parse(await readFile(new URL("../../deploy/production-candidate/manifest.json", import.meta.url)));
const pending = manifest.filter(m => ["0012_plan_management_profiles.sql", "0013_plan_management_safety.sql"].includes(m.file));
assert.equal(pending.length, 2);
for (const m of pending) {
  const sql = await readFile(new URL(`../../deploy/production-candidate/${m.source}`, import.meta.url), "utf8");
  assert.equal(hash(sql), m.sha256);
  m.sql = sql.replace(/^BEGIN;\s*$/m, "").replace(/^COMMIT;\s*$/m, "");
}
// Original fields of every affected/critical table must remain identical.
const tables = ["public.plans", "public.tenant_subscriptions", "public.tenant_addons", "public.addons",
  "public.plan_entitlements", "public.addon_entitlements", "public.platform_admins", "public.white_label_requests",
  "qxlayer_commerce.pricing_publication", "qxlayer_commerce.invoices",
  "qxlayer_acceptance_catalog.plans", "qxlayer_acceptance_catalog.pricing_publication"];
async function capture(originalOnly = false) {
  const out = {};
  for (const table of tables) {
    const excluded = table.endsWith(".plans") ? ["profile","revision","updated_by"] :
      table === "public.tenant_subscriptions" ? ["contract_snapshot","contract_frozen_at"] :
      table === "public.tenant_addons" ? ["contract_snapshot"] : [];
    const expression = originalOnly ? `to_jsonb(t)-$1::text[]` : "to_jsonb(t)";
    out[table] = (await c.query(`SELECT COALESCE(jsonb_agg(v ORDER BY v::text),'[]'::jsonb) AS rows
      FROM (SELECT ${expression} AS v FROM ${table} t) x`, originalOnly ? [excluded] : [])).rows[0].rows;
  }
  return JSON.stringify(out);
}
async function begin() {
  await c.query("BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'; SET LOCAL app.is_super_admin='true'; SET LOCAL app.can_write='true'");
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('qxlayer-external-migrations',0))");
  await c.query(`LOCK TABLE ${tables.join(",")} IN SHARE ROW EXCLUSIVE MODE`);
}
async function applyAndVerify(baseline) {
  for (const m of pending) {
    await c.query(m.sql);
    await c.query("INSERT INTO qxlayer_migrations.versions(file,sha256) VALUES($1,$2)", [m.file, m.sha256]);
  }
  await verifyTarget(c, { policyRole: "qxlayer_runtime", planManagement: true });
  assert.equal(hash(await capture(true)), baseline, "Original business fields changed");
  assert.equal((await c.query("SELECT count(*)::int n FROM public.tenant_subscriptions WHERE contract_snapshot IS NULL")).rows[0].n, 0);
  assert.equal((await c.query("SELECT count(*)::int n FROM public.tenant_addons WHERE contract_snapshot IS NULL")).rows[0].n, 0);
}
let phase = "connect";
try {
  await c.connect();
  assert.equal((await c.query("SELECT current_database() db,current_user actor")).rows[0].actor, "postgres");
  await begin();
  const applied = schemaLedger((await c.query("SELECT file,sha256 FROM qxlayer_migrations.versions ORDER BY file")).rows, true);
  assert.deepEqual(applied, manifest.filter(m => !pending.includes(m)).map(({file,sha256}) => ({file,sha256})), "Unexpected live ledger; stop instead of replaying migrations");
  await verifyTarget(c, { policyRole: "qxlayer_runtime" });
  const baseline = hash(await capture(true));
  phase = "encrypted-backup";
  const plaintext = Buffer.from(await capture());
  const salt = randomBytes(32), iv = randomBytes(12), key = scryptSync(process.env.QXLAYER_BACKUP_PASSPHRASE, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope = JSON.stringify({ version: 1, salt: salt.toString("base64"), iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
  const dir = "generated-artifacts/plan-release";
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const backup = `${dir}/affected-data-${Date.now()}.aes-gcm.json`;
  await writeFile(backup, envelope, { mode: 0o600, flag: "wx" });
  const saved = JSON.parse(await readFile(backup, "utf8"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(saved.iv, "base64"));
  decipher.setAuthTag(Buffer.from(saved.tag, "base64"));
  const restored = Buffer.concat([decipher.update(Buffer.from(saved.ciphertext, "base64")), decipher.final()]);
  assert.equal(hash(restored), hash(plaintext), "Authenticated backup readback mismatch");
  plaintext.fill(0); restored.fill(0); key.fill(0);
  phase = "rollback-rehearsal";
  await applyAndVerify(baseline);
  await c.query("ROLLBACK");
  phase = "atomic-application";
  await begin();
  assert.equal(hash(await capture(true)), baseline, "Business data changed during rehearsal; capture a fresh backup");
  await applyAndVerify(baseline);
  await c.query("COMMIT");
  phase = "committed";
  await writeFile(`${dir}/schema-release-report.json`, JSON.stringify({
    status: "schema-applied", backup, encryptedBackupSha256: hash(envelope),
    authenticatedBackupVerified: true, rollbackRehearsalPassed: true, originalBusinessFieldsUnchanged: true,
    versions: pending.map(({file,sha256}) => ({file,sha256})), catalogPublished: false, codePublished: false,
  }, null, 2), { mode: 0o600 });
  console.log("Additive Production schema committed; affected-data backup authenticated, rollback rehearsal passed, original business fields unchanged. No catalog/code publication.");
} catch {
  await c.query("ROLLBACK").catch(() => {});
  console.error(`Plan schema release stopped at ${phase}; no credentials or records logged.`);
  process.exitCode = 1;
} finally { await c.end(); }
