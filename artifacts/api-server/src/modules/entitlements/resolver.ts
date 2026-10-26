import { withDatabase, type DatabaseClient } from "@workspace/db";
import { HttpError } from "../../lib/errors";
import { contextFor, type Principal } from "../authentication/service";
import { definitions, readAddon, readPlan, validateEntries, type Entry } from "./catalog";
import { decimal, decimalString } from "./decimal";
import { applyDependencies, readRegistry } from "../product-registry/service";
import { recurringEstimate } from "./commercial-pricing";
import { applyServiceDependencies } from "./service-policy";
import { readSnapshot } from "../plan-management/contracts";
import { applyPlanPolicy } from "../plan-management/effective-policy";

export function currentPeriod(now = new Date()) { return now.toISOString().slice(0, 7); }
export async function lockTenant(client: DatabaseClient, tenantId: string) {
  const r = await client.query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE", [tenantId]);
  if (!r.rowCount) throw new HttpError(404, "Tenant not found.");
}

export async function resolveEntitlements(client: DatabaseClient, tenantId: string) {
  const tenant = await client.query("SELECT status FROM tenants WHERE id=$1", [tenantId]);
  if (!tenant.rowCount) throw new HttpError(404, "Tenant not found.");
  const sub = await client.query("SELECT * FROM tenant_subscriptions WHERE tenant_id=$1", [tenantId]);
  const catalogPlan = sub.rowCount ? await readPlan(client, sub.rows[0].plan_id, true) : null;
  // A frozen contract preserves the customer's agreed access and prices; later
  // catalog edits apply only after an explicit, audited subscription migration.
  const contract = readSnapshot(sub.rows[0]);
  const plan = catalogPlan && contract && contract.planId === catalogPlan.id ? {
    ...catalogPlan, entitlements: contract.entitlements as Entry[], pricingConfigured: contract.pricingConfigured,
    monthlyPrice: contract.monthlyPrice, yearlyPrice: contract.yearlyPrice, setupFee: contract.setupFee, currency: contract.currency,
    discountPercent: contract.discountPercent, profile: (contract as any).profile ?? {},
  } : catalogPlan;
  const assigned = await client.query("SELECT addon_id,contract_snapshot FROM tenant_addons WHERE tenant_id=$1 ORDER BY addon_id", [tenantId]);
  const addons = [];
  for (const row of assigned.rows) {
    const current = await readAddon(client, row.addon_id, true);
    addons.push(row.contract_snapshot ? { ...current, ...row.contract_snapshot } as typeof current : current);
  }
  const overridesResult = await client.query("SELECT key,value,reason FROM tenant_entitlement_overrides WHERE tenant_id=$1 ORDER BY key", [tenantId]);
  const overrides = overridesResult.rows as (Entry & { reason: string })[];
  const defs = await definitions(client);
  const features: Record<string, boolean> = {};
  const limits: Record<string, string> = {};
  const sources: Record<string, string> = {};
  for (const def of defs) {
    if (def.kind === "feature") features[def.key] = false;
    else limits[def.key] = "0";
    sources[def.key] = "default: deny / zero";
  }
  const apply = async (entries: Entry[], source: string, additive: boolean) => {
    for (const e of await validateEntries(client, entries)) {
      if (typeof e.value === "boolean") features[e.key] = additive ? features[e.key] || e.value : e.value;
      else limits[e.key] = additive ? decimalString(decimal(limits[e.key]) + decimal(e.value)) : e.value;
      sources[e.key] = additive ? `${sources[e.key]} + ${source}` : source;
    }
  };
  // Catalog lifecycle blocks NEW assignments, never silently revokes an existing contract.
  if (plan) {
    await apply(plan.entitlements, `plan: ${plan.name}`, false);
    for (const addon of addons) await apply(addon.entitlements, `add-on: ${addon.name}`, true);
    await apply(overrides, "super-admin override", false);
  }
  const status = !plan ? "unassigned" : sub.rows[0].cancelled ? "cancelled" : tenant.rows[0].status === "suspended" || sub.rows[0].status === "suspended" ? "suspended" : "active";
  applyPlanPolicy(plan?.profile, features, limits, sources);
  if (status !== "active") {
    for (const key of Object.keys(features)) features[key] = false;
    for (const key of Object.keys(limits)) limits[key] = "0";
    for (const key of Object.keys(sources)) sources[key] = `${status}: denied`;
  }
  const registry = await readRegistry(client);
  applyDependencies(features, sources, registry);
  applyServiceDependencies(features, sources);
  const resource = await client.query(
    `SELECT
      (SELECT count(DISTINCT c.asset_id) FROM tenant_asset_networks t JOIN asset_network_catalog c ON c.id=t.asset_network_id WHERE t.tenant_id=$1)::text AS max_supported_assets,
      (SELECT count(DISTINCT c.network_id) FROM tenant_asset_networks t JOIN asset_network_catalog c ON c.id=t.asset_network_id WHERE t.tenant_id=$1)::text AS max_supported_networks,
      (SELECT count(*) FROM tenant_memberships WHERE tenant_id=$1 AND role='staff' AND active=true)::text AS max_staff,
      (SELECT count(*) FROM api_keys WHERE tenant_id=$1 AND revoked_at IS NULL)::text AS max_api_keys,
      (SELECT count(*) FROM webhook_endpoints WHERE tenant_id=$1)::text AS max_webhooks,
      (SELECT count(*) FROM tenant_payment_methods WHERE tenant_id=$1)::text AS max_payment_methods`, [tenantId],
  );
  const counters = await client.query("SELECT key,used::text FROM tenant_usage_counters WHERE tenant_id=$1 AND period=$2", [tenantId, currentPeriod()]);
  const counts: Record<string, string> = { ...Object.fromEntries(counters.rows.map((r) => [r.key, r.used])), ...resource.rows[0] };
  const usage = defs.filter((d) => d.kind === "limit").map((d) => ({
    key: d.key, label: d.label, used: counts[d.key] ?? "0", limit: limits[d.key] ?? "0",
    exceeded: decimal(counts[d.key] ?? "0") > decimal(limits[d.key] ?? "0"),
  }));
  return {
    tenantId, tenantStatus: tenant.rows[0].status as string, status: status as "active" | "suspended" | "cancelled" | "unassigned",
    billingPeriod: (sub.rows[0]?.billing_period ?? "monthly") as "monthly" | "yearly",
    discountPercent: sub.rows[0]?.discount_percent as string ?? "0",
    operatorNote: sub.rows[0]?.operator_note as string ?? "",
    recurringEstimate: plan ? recurringEstimate([plan, ...addons], sub.rows[0].billing_period, sub.rows[0].discount_percent) : null,
    currency: plan?.currency ?? null, billingConnected: false,
    plan, addons, overrides, features, limits, sources, usage,
    enabledModules: registry.filter((m) => features[m.key]).map((m) => m.key),
    overLimit: usage.some((u) => u.exceeded),
  };
}
export type EffectiveEntitlements = Awaited<ReturnType<typeof resolveEntitlements>>;
export function assertOperational(effective: EffectiveEntitlements) {
  if (effective.status !== "active") throw new HttpError(403, `Tenant subscription is ${effective.status}.`);
}
export function requireFeature(effective: EffectiveEntitlements, key: string) {
  assertOperational(effective);
  if (effective.features[key] !== true) throw new HttpError(403, `Feature '${key}' is not included in this tenant's effective entitlements.`);
}
export function enforceLimit(effective: EffectiveEntitlements, key: string, projectedUsage: string) {
  assertOperational(effective);
  if (!(key in effective.limits)) throw new HttpError(403, `Limit '${key}' is unconfigured; operation denied.`);
  if (decimal(projectedUsage) > decimal(effective.limits[key])) throw new HttpError(409, `Limit '${key}' exceeded (${projectedUsage} requested; ${effective.limits[key]} allowed).`);
}
export function getSubscription(principal: Principal, tenantId: string) {
  return withDatabase(contextFor(principal, tenantId), async client => {
    const sub = await resolveEntitlements(client, tenantId);
    return principal.role === "super_admin" ? sub : { ...sub, operatorNote: "" };
  });
}

/**
 * Shared admission guard for future transaction engines. The caller MUST invoke
 * inside the same transaction as its product write; locking prevents races.
 * Volume is normalized to the plan currency BEFORE admission, not crypto units.
 * No current product endpoint executes or consumes financial usage.
 */
export async function consumeMonthlyUsage(client: DatabaseClient, tenantId: string, feature: string, volumeInPlanCurrency: string) {
  await lockTenant(client, tenantId);
  const effective = await resolveEntitlements(client, tenantId);
  requireFeature(effective, feature);
  const current = Object.fromEntries(effective.usage.map((u) => [u.key, u.used]));
  const increments = [
    { key: "max_monthly_transactions", increment: "1" },
    { key: "max_monthly_volume", increment: volumeInPlanCurrency },
  ];
  for (const { key, increment } of increments) {
    const next = decimalString(decimal(current[key] ?? "0") + decimal(increment));
    enforceLimit(effective, key, next);
    await client.query(
      "INSERT INTO tenant_usage_counters (tenant_id,key,period,used) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,key,period) DO UPDATE SET used=EXCLUDED.used",
      [tenantId, key, currentPeriod(), next],
    );
  }
}

/** Extension point for future trusted modules' monthly meters.
 * Call in the SAME transaction as the admitted product write. No public meter API.
 */
export async function recordMonthlyUsage(client: DatabaseClient, tenantId: string, feature: string, key: string, increment: string) {
  await lockTenant(client, tenantId);
  const effective = await resolveEntitlements(client, tenantId);
  requireFeature(effective, feature);
  const current = effective.usage.find((u) => u.key === key)?.used ?? "0";
  const next = decimalString(decimal(current) + decimal(increment));
  await validateEntries(client, [{ key, value: next }]);
  enforceLimit(effective, key, next);
  await client.query("INSERT INTO tenant_usage_counters (tenant_id,key,period,used) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,key,period) DO UPDATE SET used=EXCLUDED.used", [tenantId, key, currentPeriod(), next]);
}