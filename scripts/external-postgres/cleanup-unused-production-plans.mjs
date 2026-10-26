/** Explicit operator maintenance; never invoked by startup or deployment. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash, randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { targetScopePreflight } from "../external-hosting/target-scope-preflight.mjs";

const apply = process.argv.includes("--apply");
assert(process.argv.slice(2).every(x => x === "--apply"), "Unknown option");
const expected = new Map([
  ["09f6f7a7-115b-4336-84c9-21462974d182", "NovaX Sandbox Demo"],
  ["08f13544-ce05-4dfe-8e4f-76d7bd4a7b1c", "Parity QA a5279f11 plan"],
  ["0a3dd0b9-d656-4658-a044-f42a48469ed6", "Sample Plan A"],
  ["56b96789-c67e-4ae4-86f3-34c9dd69feb0", "Sample Plan B"],
  ["bddfd0b5-5ec2-442b-914f-3786be9e0aca", "White Label Exchange Sandbox Demo"],
]);
const retained = ["Starter", "Standard", "Premium"];
const hash = x => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const quote = x => `"${x.replaceAll('"', '""')}"`;
const url = new URL(process.env.QXLAYER_PRODUCTION_SUPABASE_DATABASE_URL);
assert.equal(url.pathname, "/postgres");
assert(url.hostname === "db.qcgvhlphalxqzzsxqjhi.supabase.co" ||
  (url.hostname.endsWith(".pooler.supabase.com") && decodeURIComponent(url.username) === "postgres.qcgvhlphalxqzzsxqjhi"));
assert(["", "5432"].includes(url.port));
if (apply) {
  assert.equal(process.env.CONFIRM_UNUSED_PLAN_CLEANUP, "delete-unused-archive-history");
  assert(process.env.QXLAYER_BACKUP_PASSPHRASE?.length >= 24);
  await targetScopePreflight({
    connectionString: url.toString(), serviceId: "srv-dba0q0gm7kps73f1k9fg",
    scope: "public", publicWriteApproved: true,
  });
}
for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(key);
const { Client } = createRequire(new URL("../../lib/db/package.json", import.meta.url))("pg");
const c = new Client({
  connectionString: url.toString(), connectionTimeoutMillis: 15000, enableChannelBinding: true,
  ssl: { rejectUnauthorized: true, servername: url.hostname,
    ca: await readFile(new URL("../../generated-artifacts/qxlayer-staging-setup/supabase-auth/linking-flow-test/supabase-ca.crt", import.meta.url), "utf8") },
});
try {
  await c.connect();
  await c.query(apply ? "BEGIN" : "BEGIN READ ONLY");
  await c.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='20s'");
  assert.equal((await c.query("SELECT current_user actor")).rows[0].actor, "postgres");
  const tables = (await c.query(`SELECT schemaname,tablename FROM pg_tables
    WHERE schemaname IN ('public','qxlayer_commerce','qxlayer_acceptance_catalog')
    ORDER BY 1,2`)).rows.map(t => ({
      name: `${t.schemaname}.${t.tablename}`, sql: `${quote(t.schemaname)}.${quote(t.tablename)}`,
    }));
  if (apply) {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('pricing-publication',0))");
    await c.query(`LOCK TABLE ${tables.map(t => t.sql).join(",")} IN SHARE ROW EXCLUSIVE MODE`);
    await c.query("SET LOCAL app.is_super_admin='true'; SET LOCAL app.can_write='true'");
  }
  const plans = (await c.query("SELECT * FROM public.plans ORDER BY id")).rows;
  for (const p of plans) {
    if (retained.includes(p.name)) assert(!expected.has(p.id));
    else assert.equal(expected.get(p.id), p.name, "Unknown plan; refuse broader cleanup");
  }
  assert.deepEqual(plans.filter(p => retained.includes(p.name)).map(p => p.name).sort(), [...retained].sort());
  const publication = (await c.query("SELECT * FROM qxlayer_commerce.pricing_publication")).rows;
  assert.equal(publication.length, 1);
  assert.deepEqual(publication[0].payload.plans.map(p => p.name).sort(), [...retained].sort());
  const protectedPlans = plans.filter(p => retained.includes(p.name));
  const changes = [];
  for (const p of plans.filter(p => expected.has(p.id))) {
    const references = [];
    for (const t of tables.filter(t => !["public.plans", "public.plan_entitlements"].includes(t.name))) {
      // Includes JSON snapshots, historical publications, audit trails and non-FK references.
      const count = (await c.query(`SELECT count(*)::int n FROM ${t.sql} t
        WHERE strpos(to_jsonb(t)::text,$1)>0`, [p.id])).rows[0].n;
      if (count) references.push({ table: t.name, count });
    }
    changes.push({ id: p.id, name: p.name, action: references.length ? "archive" : "delete", references });
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "read-only", changes }, null, 2));
  if (apply) {
    assert.equal((await c.query(`SELECT count(*)::int n FROM public.tenant_subscriptions
      WHERE plan_id=ANY($1::uuid[]) AND contract_snapshot IS NULL`, [[...expected.keys()]])).rows[0].n, 0,
    "Referenced subscriptions must have frozen contracts");
    const entitlements = (await c.query("SELECT * FROM public.plan_entitlements ORDER BY plan_id,key")).rows;
    const protectedTables = tables.filter(t => !["public.plans", "public.plan_entitlements", "public.audit_events"].includes(t.name));
    async function fingerprint() {
      const result = {};
      for (const t of protectedTables) result[t.name] = (await c.query(
        `SELECT md5(COALESCE(string_agg(v,E'\\n' ORDER BY v),'')) digest
         FROM (SELECT to_jsonb(t)::text v FROM ${t.sql} t) x`)).rows[0].digest;
      return hash(result);
    }
    const before = await fingerprint();
    const plaintext = Buffer.from(JSON.stringify({ plans, entitlements, publication }));
    const salt = randomBytes(32), iv = randomBytes(12);
    const key = scryptSync(process.env.QXLAYER_BACKUP_PASSPHRASE, salt, 32);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const backup = { version: 1, salt: salt.toString("base64"), iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
    const directory = "generated-artifacts/plan-cleanup";
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = `${directory}/backup-${Date.now()}.aes-gcm.json`;
    await writeFile(file, JSON.stringify(backup), { mode: 0o600, flag: "wx" });
    const saved = JSON.parse(await readFile(file, "utf8"));
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(saved.iv, "base64"));
    decipher.setAuthTag(Buffer.from(saved.tag, "base64"));
    const restored = Buffer.concat([decipher.update(Buffer.from(saved.ciphertext, "base64")), decipher.final()]);
    assert(plaintext.equals(restored), "Backup verification failed");
    plaintext.fill(0); restored.fill(0); key.fill(0);
    for (const change of changes) {
      if (change.action === "delete") {
        await c.query("DELETE FROM public.plan_entitlements WHERE plan_id=$1", [change.id]);
        await c.query("DELETE FROM public.plans WHERE id=$1", [change.id]);
      } else {
        await c.query(`UPDATE public.plans SET status='archived',revision=revision+1,
          updated_at=now(),updated_by='operator:approved-plan-cleanup'
          WHERE id=$1 AND status<>'archived'`, [change.id]);
      }
      await c.query(`INSERT INTO public.audit_events(actor_id,event_type,description,metadata)
        VALUES('operator:approved-plan-cleanup',$1,$2,$3)`,
      [change.action === "delete" ? "plan.deleted" : "plan.archived",
        "Explicitly approved legacy plan cleanup; customer records and published tiers preserved",
        JSON.stringify(change)]);
    }
    assert.equal(await fingerprint(), before, "Protected business records changed");
    const after = (await c.query("SELECT * FROM public.plans ORDER BY id")).rows;
    assert.equal(hash(after.filter(p => retained.includes(p.name))), hash(protectedPlans));
    assert(after.filter(p => expected.has(p.id)).every(p => p.status === "archived"));
    assert.equal(hash((await c.query("SELECT * FROM public.plan_entitlements WHERE NOT(plan_id=ANY($1::uuid[])) ORDER BY plan_id,key",
      [changes.filter(x => x.action === "delete").map(x => x.id)])).rows),
    hash(entitlements.filter(x => !changes.some(y => y.action === "delete" && y.id === x.plan_id))));
    await c.query("COMMIT");
    console.log("Committed: published tiers and all protected business tables unchanged; encrypted backup verified.");
  } else await c.query("ROLLBACK");
} catch (error) {
  await c.query("ROLLBACK").catch(() => {});
  console.error("Plan cleanup stopped safely:", error.code ?? error.name);
  process.exitCode = 1;
} finally { await c.end(); }
