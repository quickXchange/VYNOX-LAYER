import type { DatabaseClient } from "@workspace/db";
import { assertCatalogOperationAllowed } from "../../lib/catalog-scope";
import { requireSuperAdmin, type Principal } from "../authentication/service";
import { HttpError } from "../../lib/errors";
import { audit } from "../../lib/audit";
import { requireFeature, resolveEntitlements } from "../entitlements/resolver";
import { prepareTenant } from "../tenants/service";
import { applyOrderBranding } from "./order-branding";
import { assertFinalPricing, requestColumns, orderView, event } from "./order-model";
import type { catalogSelection } from "./order-catalog";

const preparationServices = { prepareTenant, resolveEntitlements, applyOrderBranding, orderView, event, audit };

/** Caller holds the request row lock. Tenant + master + linkage commit together. */
export async function prepareReviewedWebsite(c: DatabaseClient, p: Principal, row: Record<string, any>,
  selection: Awaited<ReturnType<typeof catalogSelection>>, services = preparationServices) {
  assertCatalogOperationAllowed("website preparation");
  requireSuperAdmin(p);
  assertFinalPricing(row);
  if (!selection.plan) throw new HttpError(409, "Select a White Label Exchange plan before preparing this order.");
  if (row.tenantId) return services.orderView(c, row); // Never replace an existing customer's settings.
  const tenant = await services.prepareTenant(c, p, {
    name: row.configuration.brandName, slug: `wl-${row.id}`, planId: selection.plan.id,
  }, selection.addons.map(a => a.id));
  await c.query("UPDATE tenant_subscriptions SET billing_period=$2 WHERE tenant_id=$1",
    [tenant.id, row.configuration.billingPeriod === "yearly" ? "yearly" : "monthly"]);
  const effective = await services.resolveEntitlements(c, tenant.id);
  requireFeature(effective, "website"); requireFeature(effective, "crypto_exchange");
  for (const action of row.configuration.actions as string[]) requireFeature(effective, action);
  // Approval prepares a draft only. Activation/delivery must pass the existing
  // operational readiness checks before granting customer access.
  const status = "in_setup";
  await services.applyOrderBranding(c, tenant.id, tenant.slug, row as { id: string; configuration: Record<string, any> });
  const prepared = await c.query(`UPDATE white_label_requests SET tenant_id=$2,status=$3,updated_at=now()
    WHERE id=$1 RETURNING ${requestColumns}`, [row.id, tenant.id, status]);
  await services.event(c, p, row.id, "status", "Approved: your isolated website is being prepared. Admin Panel access will become available after the operator completes setup and delivery. All financial operations remain Sandbox; approval does not generate custom design work.", "customer", status);
  await services.audit(c, p, tenant.id, "white_label.request.prepared", "Approval prepared a draft master website; customer access remains withheld until readiness and delivery", { requestId: row.id });
  return services.orderView(c, prepared.rows[0]);
}
