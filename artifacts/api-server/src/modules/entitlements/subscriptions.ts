import { withDatabase } from "@workspace/db";
import { assertCatalogOperationAllowed } from "../../lib/catalog-scope";
import { SetTenantOverridesBody, UpdateSubscriptionCommercialBody } from "@workspace/api-zod";
import type { z } from "zod";
import { HttpError } from "../../lib/errors";
import { audit } from "../../lib/audit";
import { contextFor, requireSuperAdmin, type Principal } from "../authentication/service";
import { readAddon, readPlan, validateEntries } from "./catalog";
import { lockTenant, resolveEntitlements } from "./resolver";
import { discountBasisPoints } from "./commercial-pricing";
import { freezeContract } from "../plan-management/contracts";

export function changeTenantPlan(principal: Principal, tenantId: string, planId: string) {
  assertCatalogOperationAllowed("subscription plan assignment");
  requireSuperAdmin(principal);
  return withDatabase(contextFor(principal, tenantId, true), async (client) => {
    await lockTenant(client, tenantId);
    const before = await resolveEntitlements(client, tenantId);
    if (before.trial) throw new HttpError(409, "Trial agreements cannot be replaced through plan assignment.");
    const plan = await readPlan(client, planId);
    if (plan.status !== "enabled" && before.plan?.id !== planId) throw new HttpError(400, "Only enabled plans can receive new assignments.");
    if (before.addons.some(a => a.currency !== plan.currency)) throw new HttpError(409, "Remove add-ons in the old currency before changing the plan currency.");
    await client.query(
      "INSERT INTO tenant_subscriptions (tenant_id,plan_id,status) VALUES ($1,$2,$3) ON CONFLICT (tenant_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,updated_at=now()",
      [tenantId, planId, before.tenantStatus === "suspended" ? "suspended" : "active"],
    );
    if (before.plan?.id !== planId) await freezeContract(client, tenantId, plan, "assignment");
    await client.query("UPDATE tenants SET completed_steps=ARRAY(SELECT DISTINCT unnest(completed_steps || ARRAY['modules']::text[])),updated_at=now() WHERE id=$1", [tenantId]);
    const after = await resolveEntitlements(client, tenantId);
    await audit(client, principal, tenantId, "subscription.plan_changed", `Assigned plan ${plan.name}; no billing performed`, { before: before.plan?.id ?? null, after: planId, overridesRetained: true, overLimit: after.overLimit });
    return after;
  });
}
export function setTenantAddons(principal: Principal, tenantId: string, ids: string[]) {
  assertCatalogOperationAllowed("subscription add-on assignment");
  requireSuperAdmin(principal);
  return withDatabase(contextFor(principal, tenantId, true), async (client) => {
    await lockTenant(client, tenantId);
    const before = await resolveEntitlements(client, tenantId);
    if (before.trial) throw new HttpError(409, "Trial prices are frozen; add-ons require a separate agreement.");
    if (!before.plan) throw new HttpError(400, "Assign a plan before adding add-ons.");
    const unique = [...new Set(ids)];
    for (const id of unique) {
      const addon = await readAddon(client, id);
      if (!addon.enabled && !before.addons.some((a) => a.id === id)) throw new HttpError(400, "A disabled add-on cannot receive new assignments.");
      if (addon.currency !== before.plan.currency) throw new HttpError(400, "Add-ons must use the plan currency; no currency conversion is performed.");
    }
    // Retained assignments keep their original agreement, even when another
    // add-on is added or removed.
    await client.query("DELETE FROM tenant_addons WHERE tenant_id=$1 AND NOT (addon_id=ANY($2::uuid[]))", [tenantId, unique]);
    for (const id of unique) {
      const snapshot = await readAddon(client, id);
      await client.query("INSERT INTO tenant_addons (tenant_id,addon_id,contract_snapshot) VALUES ($1,$2,$3::jsonb) ON CONFLICT (tenant_id,addon_id) DO NOTHING", [tenantId, id, JSON.stringify(snapshot)]);
    }
    const after = await resolveEntitlements(client, tenantId);
    await audit(client, principal, tenantId, "subscription.addons_changed", "Updated tenant add-on assignments", { before: before.addons.map((a) => a.id), after: unique, overLimit: after.overLimit });
    return after;
  });
}
export function setTenantOverrides(principal: Principal, tenantId: string, overrides: z.infer<typeof SetTenantOverridesBody>["overrides"]) {
  assertCatalogOperationAllowed("subscription entitlement changes");
  requireSuperAdmin(principal);
  if (overrides.some((o) => o.reason.trim().length < 2)) throw new HttpError(400, "Every override needs a non-empty reason.");
  return withDatabase(contextFor(principal, tenantId, true), async (client) => {
    await lockTenant(client, tenantId);
    const before = await resolveEntitlements(client, tenantId);
    if (before.trial) throw new HttpError(409, "Trial entitlements are frozen; overrides require a separate agreement.");
    if (!before.plan) throw new HttpError(400, "Assign a plan before applying overrides.");
    const entries = await validateEntries(client, overrides);
    await client.query("DELETE FROM tenant_entitlement_overrides WHERE tenant_id=$1", [tenantId]);
    for (let i = 0; i < entries.length; i++) await client.query(
      "INSERT INTO tenant_entitlement_overrides (tenant_id,key,value,reason) VALUES ($1,$2,$3::jsonb,$4)",
      [tenantId, entries[i].key, JSON.stringify(entries[i].value), overrides[i].reason.trim()],
    );
    const after = await resolveEntitlements(client, tenantId);
    await audit(client, principal, tenantId, "subscription.overrides_changed", "Replaced tenant-only feature/limit overrides", { before: before.overrides, after: after.overrides, overLimit: after.overLimit });
    return after;
  });
}
export function setTenantSuspension(principal: Principal, tenantId: string, suspended: boolean, reason: string) {
  assertCatalogOperationAllowed("subscription suspension");
  requireSuperAdmin(principal);
  if (reason.trim().length < 2) throw new HttpError(400, "Suspension changes need a non-empty reason.");
  return withDatabase(contextFor(principal, tenantId, true), async (client) => {
    await lockTenant(client, tenantId);
    const before = await resolveEntitlements(client, tenantId);
    if (before.status === "cancelled") throw new HttpError(409, "Restore the cancelled subscription explicitly before changing suspension.");
    if (suspended && before.tenantStatus !== "suspended") {
      await client.query("UPDATE tenant_subscriptions SET resume_status=$2,status='suspended',updated_at=now() WHERE tenant_id=$1", [tenantId, before.tenantStatus]);
      await client.query("UPDATE tenants SET status='suspended',updated_at=now() WHERE id=$1", [tenantId]);
    } else if (!suspended && before.tenantStatus === "suspended") {
      const previous = await client.query("SELECT resume_status FROM tenant_subscriptions WHERE tenant_id=$1", [tenantId]);
      await client.query("UPDATE tenants SET status=$2,updated_at=now() WHERE id=$1", [tenantId, previous.rows[0]?.resume_status ?? "draft"]);
      await client.query("UPDATE tenant_subscriptions SET status='active',updated_at=now() WHERE tenant_id=$1", [tenantId]);
    }
    const after = await resolveEntitlements(client, tenantId);
    await audit(client, principal, tenantId, suspended ? "tenant.suspended" : "tenant.unsuspended", reason.trim(), { before: before.tenantStatus, after: after.tenantStatus });
    return after;
  });
}

export function updateSubscriptionCommercial(principal: Principal, tenantId: string, input: z.infer<typeof UpdateSubscriptionCommercialBody>) {
  assertCatalogOperationAllowed("subscription commercial changes");
  requireSuperAdmin(principal);
  discountBasisPoints(input.discountPercent);
  if (input.reason.trim().length < 2) throw new HttpError(400, "A change reason is required.");
  return withDatabase(contextFor(principal, tenantId, true), async client => {
    await lockTenant(client, tenantId);
    const before = await resolveEntitlements(client, tenantId);
    if (before.trial) throw new HttpError(409, "Use trial controls. Commercial edits and restore cannot alter a trial agreement or bypass expiry.");
    if (!before.plan) throw new HttpError(409, "Assign a plan before managing this subscription.");
    await client.query("UPDATE tenant_subscriptions SET billing_period=$2,discount_percent=$3,operator_note=$4,updated_at=now() WHERE tenant_id=$1",
      [tenantId, input.billingPeriod, input.discountPercent, input.operatorNote.trim()]);
    if (input.action === "cancel" && before.status !== "cancelled") {
      await client.query(`UPDATE tenant_subscriptions SET cancelled=true,status='suspended',
        resume_status=CASE WHEN $2 IN ('draft','active') THEN $2 ELSE resume_status END,updated_at=now() WHERE tenant_id=$1`, [tenantId, before.tenantStatus]);
      await client.query("UPDATE tenants SET status='suspended',updated_at=now() WHERE id=$1", [tenantId]);
    }
    if (input.action === "restore" && before.status === "cancelled") {
      const previous = await client.query("SELECT resume_status FROM tenant_subscriptions WHERE tenant_id=$1", [tenantId]);
      await client.query("UPDATE tenant_subscriptions SET cancelled=false,status='active',updated_at=now() WHERE tenant_id=$1", [tenantId]);
      await client.query("UPDATE tenants SET status=$2,updated_at=now() WHERE id=$1", [tenantId, previous.rows[0].resume_status]);
    }
    const after = await resolveEntitlements(client, tenantId);
    await audit(client, principal, tenantId, `subscription.commercial_${input.action}`, input.reason.trim(),
      { before: { period: before.billingPeriod, discount: before.discountPercent, status: before.status },
        after: { period: after.billingPeriod, discount: after.discountPercent, status: after.status }, paymentCollected: false, recordsPreserved: true });
    return after;
  });
}
