import { withDatabase, type DatabaseClient } from "@workspace/db";
import { contextFor, requireSuperAdmin, type Principal } from "../authentication/service";
import { HttpError } from "../../lib/errors";
import { audit } from "../../lib/audit";
import { assertCatalogOperationAllowed, catalogTable } from "../../lib/catalog-scope";
import { lockTenant, resolveEntitlements } from "../entitlements/resolver";
import { contractSnapshot } from "../plan-management/contracts";
import { effectiveTrial, type Trial } from "./trial-policy";
import type { StartTenantTrialBody, UpdateTenantTrialBody } from "@workspace/api-zod";
import type { z } from "zod";
import { effectiveRecurring } from "../entitlements/commercial-pricing";

export async function startTrial(p: Principal, tenantId: string, input: z.infer<typeof StartTenantTrialBody>) {
  return withDatabase(contextFor(p, tenantId, true), c => startTrialInTransaction(c, p, tenantId, input));
}

export async function startTrialInTransaction(c: DatabaseClient, p: Principal, tenantId: string, input: z.infer<typeof StartTenantTrialBody>) {
  assertCatalogOperationAllowed("subscription trial");
  requireSuperAdmin(p);
  if (input.reason.trim().length < 2) throw new HttpError(400, "A reason is required.");
    await lockTenant(c, tenantId);
    const existing = (await c.query("SELECT * FROM tenant_subscriptions WHERE tenant_id=$1", [tenantId])).rows[0];
    if (existing) {
      if (existing.trial?.id === input.idempotencyKey && existing.plan_id === input.planId &&
          existing.billing_period === input.billingPeriod && existing.trial.publishedRevision === input.publishedRevision)
        return resolveEntitlements(c, tenantId);
      throw new HttpError(409, "Trials are for new subscriptions only. Existing billing agreements cannot be replaced or restarted.");
    }
    // No draft fallback: the exact customer-visible publication must be reviewed.
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('pricing-publication',0))");
    const publication = (await c.query(`SELECT payload,revision FROM ${catalogTable("pricing_publication")} WHERE singleton=true`)).rows[0];
    if (!publication || publication.revision !== input.publishedRevision) throw new HttpError(409, "Published pricing changed. Refresh and review the terms.");
    const plan = publication.payload.plans.find((v: { id: string }) => v.id === input.planId);
    if (!plan || !plan.pricingConfigured || plan.profile?.pricingMode !== "paid" ||
        !Number.isInteger(plan.profile.trialDays) || plan.profile.trialDays < 1 ||
        plan.profile.trialDays > 365 || !plan.billingPeriods.includes(input.billingPeriod))
      throw new HttpError(409, "Select a published paid plan with a trial and an available billing period.");
    const now = new Date();
    const agreedRecurringPrice = effectiveRecurring(plan, input.billingPeriod, now);
    if (agreedRecurringPrice === null) throw new HttpError(409, "The published recurring price is not configured.");
    const trial: Trial = { id: input.idempotencyKey, state: "active", startedAt: now.toISOString(),
      endsAt: new Date(now.getTime() + plan.profile.trialDays * 86400000).toISOString(),
      renewalRule: "manual_agreement_required", renewalRequestedAt: null, cancelledAt: null,
      publishedRevision: publication.revision, agreedRecurringPrice };
    await c.query(`INSERT INTO tenant_subscriptions
      (tenant_id,plan_id,billing_period,contract_snapshot,contract_frozen_at,trial)
      VALUES($1,$2,$3,$4::jsonb,$5,$6::jsonb)`,
    [tenantId, plan.id, input.billingPeriod, JSON.stringify(contractSnapshot(plan, "trial", publication.revision)), now, JSON.stringify(trial)]);
    await audit(c, p, tenantId, "subscription.trial_started", input.reason.trim(), { trial, paymentCollected: false, financialHoldsPreserved: true });
    return resolveEntitlements(c, tenantId);
}

export async function expireTrial(c: DatabaseClient, p: Principal, tenantId: string, raw: Trial) {
  const trial = effectiveTrial(raw)!;
  if (trial.state === "expired" && raw.state === "active") {
    const changed = await c.query(`UPDATE tenant_subscriptions SET trial=$2::jsonb,updated_at=now()
      WHERE tenant_id=$1 AND trial->>'state'='active' RETURNING tenant_id`, [tenantId, JSON.stringify(trial)]);
    if (changed.rowCount) await audit(c, p, tenantId, "subscription.trial_expired", "Trial deadline reached; no renewal or charge", { trialId: trial.id, endsAt: trial.endsAt });
  }
  return trial;
}

export async function updateTrial(p: Principal, tenantId: string, input: z.infer<typeof UpdateTenantTrialBody>) {
  return withDatabase(contextFor(p, tenantId, true), c => updateTrialInTransaction(c, p, tenantId, input));
}
export async function updateTrialInTransaction(c: DatabaseClient, p: Principal, tenantId: string, input: z.infer<typeof UpdateTenantTrialBody>) {
  assertCatalogOperationAllowed("subscription trial");
  if (input.reason.trim().length < 2) throw new HttpError(400, "A reason is required.");
  if (p.role !== "super_admin" && !p.memberships.some(m => m.tenantId === tenantId && m.role === "client_admin"))
    throw new HttpError(403, "Only the tenant administrator can manage this trial.");
    await lockTenant(c, tenantId);
    const row = (await c.query("SELECT trial FROM tenant_subscriptions WHERE tenant_id=$1", [tenantId])).rows[0];
    if (!row?.trial || row.trial.id !== input.trialId) throw new HttpError(409, "Trial changed. Refresh before continuing.");
    const trial = await expireTrial(c, p, tenantId, row.trial);
    if (input.action === "cancel") {
      if (trial.state !== "active") return resolveEntitlements(c, tenantId);
      trial.state = "cancelled"; trial.cancelledAt = new Date().toISOString();
    } else {
      if (trial.state === "cancelled") throw new HttpError(409, "Cancelled trials cannot request renewal.");
      if (trial.renewalRequestedAt) return resolveEntitlements(c, tenantId);
      trial.renewalRequestedAt = new Date().toISOString();
    }
    await c.query("UPDATE tenant_subscriptions SET trial=$2::jsonb,updated_at=now() WHERE tenant_id=$1", [tenantId, JSON.stringify(trial)]);
    await audit(c, p, tenantId, `subscription.trial_${input.action}`, input.reason.trim(), { trialId: trial.id, paymentCollected: false, accessExtended: false });
    return resolveEntitlements(c, tenantId);
}

/** Restart-safe and multi-instance-safe; deadline admission checks do not depend on this worker. */
export async function sweepExpiredTrials() {
  const p: Principal = { userId: "system:trial-expiry", role: "super_admin", memberships: [] };
  return withDatabase(contextFor(p, undefined, true), async c => {
    const rows = await c.query(`SELECT tenant_id,trial FROM tenant_subscriptions
      WHERE trial->>'state'='active' AND (trial->>'endsAt')::timestamptz <= now()
      ORDER BY tenant_id LIMIT 100 FOR UPDATE SKIP LOCKED`);
    for (const row of rows.rows) await expireTrial(c, p, row.tenant_id, row.trial);
  });
}
