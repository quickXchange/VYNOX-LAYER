// Explicit, reviewed operator release. Never imported by startup or CI builds.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { protectedOperator, protectedState, encryptedSnapshot, hash, REPORT } from "./plan-entitlements-operator.mjs";

const apply = process.argv.includes("--apply-approved-public-plans");
assert(apply || process.argv.includes("--rehearse"), "Explicit apply or rehearsal required");
assert.equal(process.env.QXLAYER_OPERATOR_WRITE_SCOPE, "public");
assert.equal(process.env.QXLAYER_PUBLIC_GLOBAL_WRITES_APPROVED, "true");
const ctx = await protectedOperator();
const c = ctx.client;
const file = "0011_plan_feature_rows.sql";
const sql = await readFile(new URL(`../../deploy/migrations/${file}`, import.meta.url), "utf8");
const marker = "approved_public_exchange_plans";
const tiers = [
  ["a4000000-0000-4000-8000-000000000001", "Starter", 39, 390, 149, 3, 2, 2, 1, 100, 10000],
  ["a4000000-0000-4000-8000-000000000002", "Standard", 99, 990, 399, 10, 10, 5, 5, 1000, 1000000],
  ["a4000000-0000-4000-8000-000000000003", "Premium", 249, 2490, 999, 25, 25, 15, 15, 10000, 10000000],
];
const ids = tiers.map(t => t[0]);
const preserved = async () => {
  const state = await protectedState(c);
  for (const schema of ["public", "qxlayer_acceptance_catalog"]) {
    for (const [table, key] of [["plans", "id"], ["plan_entitlements", "plan_id"]]) {
      state.records[`${schema}.${table}`] = hash((await c.query(
        `SELECT to_jsonb(t)-'feature_rows' AS row FROM ${schema}.${table} t WHERE ${key}<>ALL($1::uuid[]) ORDER BY to_jsonb(t)::text`, [ids])).rows);
    }
  }
  // Only the three approved offer-settings rows may change.
  state.records["qxlayer_commerce.offer_settings"] = hash((await c.query(
    "SELECT * FROM qxlayer_commerce.offer_settings WHERE plan_id<>ALL($1::uuid[]) ORDER BY plan_id", [ids])).rows);
  return state;
};
let committed = false;
try {
  await c.connect();
  const backup = apply ? await encryptedSnapshot(ctx) : null;
  await c.query("BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='90s'");
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('approved-public-exchange-plans',0)),pg_advisory_xact_lock(hashtextextended('pricing-publication',0))");
  const before = await preserved();
  const migration = (await c.query("SELECT sha256 FROM qxlayer_migrations.versions WHERE file=$1", [file])).rows[0];
  if (migration) assert.equal(migration.sha256, hash(sql), "Immutable schema migration checksum");
  else {
    await c.query(sql);
    await c.query("INSERT INTO qxlayer_migrations.versions(file,sha256) VALUES($1,$2)", [file, hash(sql)]);
  }
  const done = (await c.query("SELECT sha256 FROM qxlayer_migrations.versions WHERE file=$1", [marker])).rows[0];
  if (done) assert.equal(done.sha256, hash(tiers), "Reviewed data release checksum");
  else {
    assert.equal((await c.query("SELECT count(*)::int n FROM public.tenant_subscriptions WHERE plan_id=ANY($1::uuid[])", [ids])).rows[0].n, 0,
      "Never replace entitlements of existing subscribers during initial catalog publication");
    const featureRows = new Map();
    for (const [order, tier] of tiers.entries()) {
      const [id, name, monthly, yearly, setup, assets, networks, methods, staff, orders, volume] = tier;
      const expected = { max_supported_assets: assets, max_supported_networks: networks, max_payment_methods: methods,
        max_staff: staff, max_monthly_transactions: orders, max_monthly_volume: volume, max_api_keys: 0, max_webhooks: 0 };
      const source = (await c.query("SELECT * FROM qxlayer_acceptance_catalog.plans WHERE id=$1", [id])).rows[0];
      assert(source && source.currency === "EUR" && source.pricing_configured);
      featureRows.set(id, source.feature_rows);
      assert.deepEqual([+source.monthly_price, +source.yearly_price, +source.setup_fee], [monthly, yearly, setup]);
      const entries = (await c.query("SELECT key,value FROM qxlayer_acceptance_catalog.plan_entitlements WHERE plan_id=$1 ORDER BY key", [id])).rows;
      const definitions = (await c.query("SELECT key,kind FROM public.entitlement_definitions ORDER BY key")).rows;
      assert.equal(entries.length, definitions.length);
      for (const d of definitions) {
        const entry = entries.find(x => x.key === d.key); assert(entry);
        if (d.kind === "feature") assert.equal(entry.value, ["website", "crypto_exchange", "swap", "convert"].includes(d.key));
        else { assert(d.key in expected); assert.equal(Number(entry.value), expected[d.key]); }
      }
      const changed = await c.query(`UPDATE public.plans SET name=$2,description=$3,monthly_price=$4,yearly_price=$5,setup_fee=$6,
        currency='EUR',pricing_configured=true,discount_percent=0,status='enabled',display_order=$7,feature_rows=$8,updated_at=now()
        WHERE id=$1 RETURNING id`, [id, name, "White Label Exchange with Swap and Convert. Limits and included features are shown below.",
        monthly, yearly, setup, order, JSON.stringify(source.feature_rows)]);
      assert.equal(changed.rowCount, 1);
      await c.query("DELETE FROM public.plan_entitlements WHERE plan_id=$1", [id]);
      for (const entry of entries) await c.query("INSERT INTO public.plan_entitlements(plan_id,key,value) VALUES($1,$2,$3)", [id, entry.key, JSON.stringify(entry.value)]);
      await c.query(`INSERT INTO qxlayer_commerce.offer_settings(plan_id,monthly,yearly) VALUES($1,true,true)
        ON CONFLICT(plan_id) DO UPDATE SET monthly=true,yearly=true`, [id]);
      await c.query("UPDATE qxlayer_acceptance_catalog.plans SET name=$2,updated_at=now() WHERE id=$1", [id, name]);
    }
    // Construct only the approved display snapshot, not a broad publish of test plans.
    const old = (await c.query("SELECT payload FROM qxlayer_acceptance_catalog.pricing_publication WHERE singleton=true")).rows[0]?.payload;
    assert.deepEqual(old.plans.map(p => p.id).sort(), [...ids].sort());
    const payload = { plans: old.plans.map(p => ({ ...p, name: tiers.find(t => t[0] === p.id)[1],
      description: "White Label Exchange with Swap and Convert. Limits and included features are shown below.",
      featureRows: featureRows.get(p.id) })), addons: [], methods: [], purchaseAvailable: false };
    const stable = v => Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ?
      Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
    for (const schema of ["qxlayer_commerce", "qxlayer_acceptance_catalog"]) {
      const display = schema === "qxlayer_commerce" ? payload :
        { ...old, plans: old.plans.map(p => ({ ...p, name: tiers.find(t => t[0] === p.id)[1], featureRows: p.featureRows ?? [] })), methods: [], purchaseAvailable: false };
      await c.query(`INSERT INTO ${schema}.pricing_publication(singleton,payload,revision) VALUES(true,$1,$2)
        ON CONFLICT(singleton) DO UPDATE SET payload=EXCLUDED.payload,revision=EXCLUDED.revision,published_at=now()`, [JSON.stringify(display), hash(stable(display))]);
    }
    await c.query("INSERT INTO qxlayer_migrations.versions(file,sha256) VALUES($1,$2)", [marker, hash(tiers)]);
  }
  assert.deepEqual(await preserved(), before, "Unrelated data and all RLS/grants must remain unchanged");
  await c.query(apply ? "COMMIT" : "ROLLBACK"); committed = apply;
  const receipt = { applied: apply, schema: file, publicPlans: tiers.map(t => t[1]), unrelatedDataPreserved: true,
    paymentsActivated: false, backup, checkedAt: new Date().toISOString() };
  if (apply) await writeFile(new URL("public-exchange-plans.json", REPORT), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} catch (e) {
  await c.query("ROLLBACK").catch(() => {});
  console.error(JSON.stringify({ failed: true, committed, code: e.code ?? "RELEASE_VERIFICATION_FAILED",
    message: e.code === "ERR_ASSERTION" ? e.message.split("\n")[0] : "Operator release failed; sensitive diagnostics withheld" }));
  process.exitCode = 1;
} finally { await c.end(); }
