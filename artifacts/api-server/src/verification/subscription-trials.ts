import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, withDatabase } from "@workspace/db";
import { contextFor, type Principal } from "../modules/authentication/service";
import { startTrialInTransaction, updateTrialInTransaction, expireTrial } from "../modules/commerce/trials";
import { resolveEntitlements, requireFeature } from "../modules/entitlements/resolver";
import { prepareTenant } from "../modules/tenants/service";

// All fixtures and the temporary publication are in ONE transaction which is
// deliberately rolled back. No identity creation, role changes or durable QA data.
if (process.env.NODE_ENV === "production" || process.env.QXLAYER_EXTERNAL_ENVIRONMENT !== "development")
  throw new Error("Development-only verification.");
const rollback = new Error("verification rollback");
const revision = "a".repeat(64);
const p: Principal = { userId: "verification:trial", role: "super_admin", memberships: [] };
try {
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, "heliumdb");
  try {
    await withDatabase(contextFor(p, undefined, true), async c => {
      const planId = randomUUID();
      const plan = { id: planId, name: "Disposable trial", currency: "USD", pricingConfigured: true,
        monthlyPrice: "50.00", yearlyPrice: "500.00", setupFee: "10.00", discountPercent: "0",
        billingPeriods: ["monthly", "yearly"], entitlements: [{ key: "website", value: true }],
        profile: { pricingMode: "paid", trialDays: 7 }, featureRows: [] };
      await c.query(`INSERT INTO plans(id,name,status,monthly_price,yearly_price,setup_fee,pricing_configured,profile)
        VALUES($1,$2,'enabled',50,500,10,true,$3)`, [planId, plan.name, JSON.stringify(plan.profile)]);
      await c.query("INSERT INTO plan_entitlements(plan_id,key,value) VALUES($1,'website','true')", [planId]);
      await c.query(`INSERT INTO qxlayer_commerce.pricing_publication(singleton,payload,revision) VALUES(true,$1,$2)
        ON CONFLICT(singleton) DO UPDATE SET payload=EXCLUDED.payload,revision=EXCLUDED.revision`,
      [JSON.stringify({ plans: [plan], addons: [], methods: [], purchaseAvailable: false }), revision]);
      const prepared = await prepareTenant(c, p, { name: "Trial verification", slug: `trial-${randomUUID()}`, planId, prepareTrial: true });
      const tenantId = prepared.id;
      assert.equal((await resolveEntitlements(c, tenantId)).status, "unassigned");
      const input = { planId, billingPeriod: "monthly" as const, publishedRevision: revision, idempotencyKey: randomUUID(), reason: "Test trial" };
      await assert.rejects(() => startTrialInTransaction(c, p, tenantId, { ...input, publishedRevision: "stale" }));
      const first = await startTrialInTransaction(c, p, tenantId, input);
      assert.equal(first.trial?.state, "active");
      assert.equal(first.trial?.agreedRecurringPrice, "50.00");
      assert.equal(new Date(first.trial!.endsAt).getTime() - new Date(first.trial!.startedAt).getTime(), 7 * 86400000);
      const frozen = (await c.query("SELECT contract_snapshot FROM tenant_subscriptions WHERE tenant_id=$1", [tenantId])).rows[0].contract_snapshot;
      assert.deepEqual((await startTrialInTransaction(c, p, tenantId, input)).trial, first.trial);
      await assert.rejects(() => startTrialInTransaction(c, p, tenantId, { ...input, idempotencyKey: randomUUID() }));
      await c.query("UPDATE plans SET monthly_price=999,profile='{}' WHERE id=$1", [planId]);
      assert.equal((await resolveEntitlements(c, tenantId)).recurringEstimate, "50.00");
      const owner: Principal = { userId: "verification:trial-owner", role: "client_admin", memberships: [{ tenantId, role: "client_admin" }] };
      const staff: Principal = { ...owner, role: "staff", memberships: [{ tenantId, role: "staff" }] };
      const request = { trialId: first.trial!.id, action: "request_renewal" as const, reason: "Review renewal" };
      await assert.rejects(() => startTrialInTransaction(c, owner, tenantId, input));
      await assert.rejects(() => updateTrialInTransaction(c, staff, tenantId, request));
      assert.throws(() => contextFor(owner, randomUUID(), true));
      await c.query("SELECT set_config('app.is_super_admin','false',true),set_config('app.tenant_id',$1,true),set_config('app.actor_id',$2,true)", [tenantId, owner.userId]);
      assert.equal((await c.query("SELECT count(*)::int n FROM tenants WHERE id<>$1", [tenantId])).rows[0].n, 0, "customer RLS must hide other tenants");
      const requested = await updateTrialInTransaction(c, owner, tenantId, request);
      assert.equal(requested.trial?.endsAt, first.trial?.endsAt);
      assert.deepEqual((await updateTrialInTransaction(c, owner, tenantId, request)).trial, requested.trial);
      const cancelled = await updateTrialInTransaction(c, owner, tenantId, { ...request, action: "cancel" });
      assert.equal(cancelled.status, "suspended");
      assert.equal(cancelled.trial?.state, "cancelled");
      assert.throws(() => requireFeature(cancelled, "website"));
      await updateTrialInTransaction(c, owner, tenantId, { ...request, action: "cancel" });
      await c.query("SELECT set_config('app.is_super_admin','true',true),set_config('app.tenant_id','',true),set_config('app.actor_id',$1,true)", [p.userId]);
      // Deadline enforcement precedes the audit worker and survives direct unsuspension.
      await c.query(`UPDATE tenant_subscriptions SET trial=jsonb_set(jsonb_set(trial,'{state}','"active"'),'{endsAt}',to_jsonb((now()-interval '1 second')::text)),status='active' WHERE tenant_id=$1`, [tenantId]);
      const expired = await resolveEntitlements(c, tenantId);
      assert.equal(expired.trial?.state, "expired");
      assert.equal(expired.status, "suspended");
      assert.throws(() => requireFeature(expired, "website"));
      let raw = (await c.query("SELECT trial FROM tenant_subscriptions WHERE tenant_id=$1", [tenantId])).rows[0].trial;
      await expireTrial(c, p, tenantId, raw);
      await expireTrial(c, p, tenantId, raw);
      const events = (await c.query("SELECT event_type,count(*)::int n FROM audit_events WHERE tenant_id=$1 GROUP BY event_type", [tenantId])).rows;
      for (const type of ["started", "request_renewal", "cancel", "expired"])
        assert.equal(events.find(e => e.event_type === `subscription.trial_${type}`)?.n, 1, type);
      assert.deepEqual((await c.query("SELECT contract_snapshot FROM tenant_subscriptions WHERE tenant_id=$1", [tenantId])).rows[0].contract_snapshot, frozen);
      const normal = await prepareTenant(c, p, { name: "Existing agreement", slug: `paid-${randomUUID()}`, planId });
      const before = (await c.query("SELECT * FROM tenant_subscriptions WHERE tenant_id=$1", [normal.id])).rows[0];
      await assert.rejects(() => startTrialInTransaction(c, p, normal.id, input));
      assert.deepEqual((await c.query("SELECT * FROM tenant_subscriptions WHERE tenant_id=$1", [normal.id])).rows[0], before);
      assert.equal((await c.query("SELECT count(*)::int n FROM qxlayer_commerce.invoices WHERE order_id IN (SELECT id FROM white_label_requests WHERE tenant_id=$1)", [tenantId])).rows[0].n, 0);
      throw rollback;
    });
  } catch (e) { if (e !== rollback) throw e; }
  process.stdout.write("PASS: trial creation, frozen prices, idempotency, permissions, cancellation, deadline enforcement, audit deduplication, existing agreement preservation; all fixtures rolled back.\n");
} finally { await pool.end(); }
