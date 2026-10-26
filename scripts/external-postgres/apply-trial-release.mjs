/** Explicit, bounded operator action. Never called by application/deployment code. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { targetScopePreflight } from "../external-hosting/target-scope-preflight.mjs";
import { schemaLedger } from "./legacy-data-receipts.mjs";
import { readSchema, canonicalSchema } from "./schema-reference.mjs";

const hash = x => createHash("sha256").update(x).digest("hex");
const name = "0014_subscription_trials.sql";
const root = new URL("../../deploy/production-candidate/", import.meta.url);
const reportDir = new URL("../../generated-artifacts/trial-release/", import.meta.url);
let c, phase = "approval", committed = false;
try {
  assert.equal(process.env.CONFIRM_TRIAL_SCHEMA_RELEASE, "production-additive-only");
  assert(process.env.QXLAYER_BACKUP_PASSPHRASE?.length >= 24);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root)));
  assert.equal(manifest.at(-1).file, name);
  for (const m of manifest) {
    const sql = await readFile(new URL(m.source ?? m.file, root), "utf8");
    assert.equal(hash(sql), m.sha256, "Reviewed migration checksum mismatch");
  }
  const pending = manifest.at(-1);
  const expectedBefore = manifest.slice(0, -1).map(({ file, sha256 }) => ({ file, sha256 }));
  const expectedAfter = manifest.map(({ file, sha256 }) => ({ file, sha256 }));
  const sql = await readFile(new URL(name, root), "utf8");
  const url = new URL(process.env.QXLAYER_PRODUCTION_SUPABASE_DATABASE_URL);
  assert.equal(url.pathname, "/postgres");
  assert(["", "5432"].includes(url.port));
  assert(url.hostname === "db.qcgvhlphalxqzzsxqjhi.supabase.co" && decodeURIComponent(url.username) === "postgres" ||
    /^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
    decodeURIComponent(url.username) === "postgres.qcgvhlphalxqzzsxqjhi");
  phase = "target-scope";
  const { receipt } = await targetScopePreflight({
    connectionString: url.toString(), serviceId: "srv-dba0q0gm7kps73f1k9fg",
    scope: "public", publicWriteApproved: true,
  });
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(key);
  const { Client } = createRequire(new URL("../../lib/db/package.json", import.meta.url))("pg");
  c = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 15000,
    enableChannelBinding: true, ssl: { rejectUnauthorized: true, servername: url.hostname,
      ca: await readFile(new URL("../../generated-artifacts/qxlayer-staging-setup/supabase-auth/linking-flow-test/supabase-ca.crt", import.meta.url), "utf8") } });
  phase = "connect";
  await c.connect();
  assert.equal(c.connection.stream.authorized, true, "Verified client TLS required");
  assert.deepEqual((await c.query("SELECT current_database() db,current_user actor")).rows,
    [{ db: "postgres", actor: "postgres" }]);
  assert.equal((await c.query("SELECT pg_try_advisory_lock(hashtextextended('qxlayer-external-migrations',0)) locked")).rows[0].locked, true);
  const ledger = async () => schemaLedger((await c.query("SELECT file,sha256 FROM qxlayer_migrations.versions ORDER BY file")).rows, true);
  const begin = async () => {
    await c.query("BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'; SET LOCAL app.is_super_admin='true'; SET LOCAL app.can_write='true'");
    await c.query("LOCK TABLE public.tenant_subscriptions, qxlayer_migrations.versions IN SHARE ROW EXCLUSIVE MODE");
  };
  const rows = async () => (await c.query(`SELECT COALESCE(jsonb_agg(v ORDER BY v::text),'[]'::jsonb) rows
    FROM (SELECT to_jsonb(t)-'trial' AS v FROM public.tenant_subscriptions t) x`)).rows[0].rows;
  const security = async () => (await c.query(`SELECT n.nspname,c.relname,c.relowner,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text,
    (SELECT jsonb_agg(jsonb_build_object('name',p.polname,'cmd',p.polcmd,'roles',p.polroles,'permissive',p.polpermissive,
      'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname)
      FROM pg_policy p WHERE p.polrelid=c.oid) policies
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','qxlayer_commerce','qxlayer_acceptance_catalog','auth','vynox_supabase_auth')
      AND c.relkind='r' ORDER BY n.nspname,c.relname`)).rows;
  const schemaWithoutTrial = async () => {
    const schema = await readSchema(c);
    schema.columns = schema.columns.filter(x => !(x.table_name === "tenant_subscriptions" && x.name === "trial"));
    return canonicalSchema(schema);
  };
  const checkColumn = async () => {
    assert.deepEqual((await c.query(`SELECT format_type(atttypid,atttypmod) AS type,attnotnull,atthasdef,attidentity,attgenerated
      FROM pg_attribute WHERE attrelid='public.tenant_subscriptions'::regclass AND attname='trial' AND NOT attisdropped`)).rows,
      [{ type: "jsonb", attnotnull: false, atthasdef: false, attidentity: "", attgenerated: "" }]);
  };
  phase = "locked-preflight";
  await begin();
  const applied = await ledger();
  if (JSON.stringify(applied) === JSON.stringify(expectedAfter)) {
    await checkColumn();
    await c.query("ROLLBACK");
    console.log(JSON.stringify({ status: "already-applied", checksumVerified: true, columnVerified: true, codePublished: false }));
  } else {
    assert.deepEqual(applied, expectedBefore, "Unexpected ledger; no historical migration replay permitted");
    assert.equal((await c.query(`SELECT count(*)::int n FROM pg_attribute
      WHERE attrelid='public.tenant_subscriptions'::regclass AND attname='trial' AND NOT attisdropped`)).rows[0].n, 0,
      "Untracked trial column requires investigation");
    const beforeRows = await rows(), beforeSecurity = await security(), beforeSchema = await schemaWithoutTrial();
    phase = "encrypted-backup";
    const plaintext = Buffer.from(JSON.stringify({ rows: beforeRows, ledger: applied, security: beforeSecurity, schema: beforeSchema }));
    const salt = randomBytes(32), iv = randomBytes(12), key = scryptSync(process.env.QXLAYER_BACKUP_PASSPHRASE, salt, 32);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope = JSON.stringify({ version: 1, salt: salt.toString("base64"), iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
    await mkdir(reportDir, { recursive: true, mode: 0o700 });
    const backupName = `affected-data-${Date.now()}.aes-gcm.json`;
    await writeFile(new URL(backupName, reportDir), envelope, { mode: 0o600, flag: "wx" });
    const saved = JSON.parse(await readFile(new URL(backupName, reportDir), "utf8"));
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(saved.iv, "base64"));
    decipher.setAuthTag(Buffer.from(saved.tag, "base64"));
    const restored = Buffer.concat([decipher.update(Buffer.from(saved.ciphertext, "base64")), decipher.final()]);
    assert.equal(hash(restored), hash(plaintext));
    plaintext.fill(0); restored.fill(0); key.fill(0);
    const unchanged = async () => {
      assert.deepEqual(await rows(), beforeRows, "Original agreement fields changed");
      assert.deepEqual(await security(), beforeSecurity, "Security metadata changed");
      assert.deepEqual(await schemaWithoutTrial(), beforeSchema, "Unexpected schema change");
    };
    const applyAndVerify = async () => {
      assert.deepEqual(await ledger(), expectedBefore);
      await unchanged();
      await c.query(sql);
      await c.query("INSERT INTO qxlayer_migrations.versions(file,sha256) VALUES($1,$2)", [name, pending.sha256]);
      await checkColumn();
      await unchanged();
      assert.equal((await c.query("SELECT count(*)::int n FROM public.tenant_subscriptions WHERE trial IS NOT NULL")).rows[0].n, 0);
      assert.deepEqual(await ledger(), expectedAfter);
    };
    phase = "rollback-rehearsal";
    await applyAndVerify();
    await c.query("ROLLBACK");
    phase = "atomic-application";
    await begin();
    await applyAndVerify();
    await c.query("COMMIT");
    committed = true;
    phase = "committed-readback";
    await begin();
    await checkColumn();
    await unchanged();
    assert.deepEqual(await ledger(), expectedAfter);
    await c.query("ROLLBACK");
    const report = { status: "schema-applied", migration: name, checksum: pending.sha256,
      backup: backupName, encryptedBackupSha256: hash(envelope), authenticatedBackupVerified: true,
      externalBackupCopyVerified: false, rollbackRehearsalPassed: true, committedReadbackPassed: true,
      originalAgreementFieldsUnchanged: true, securityUnchanged: true, tlsVerified: true,
      targetVerified: receipt.targetVerified, catalogPublished: false, codePublished: false };
    await writeFile(new URL("schema-release-report.json", reportDir), JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(report));
  }
} catch {
  await c?.query("ROLLBACK").catch(() => {});
  console.error(JSON.stringify({ status: "stopped", phase, schemaCommitted: committed,
    message: committed ? "Schema committed; readback/report failed. Do not assume rollback." : "No schema commit confirmed; transaction rolled back.",
    privateDetailsSuppressed: true }));
  process.exitCode = 1;
} finally {
  await c?.end().catch(() => {});
}
