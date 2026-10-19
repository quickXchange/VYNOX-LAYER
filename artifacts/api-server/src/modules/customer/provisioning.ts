import { withDatabase } from "@workspace/db";
import { assertCatalogOperationAllowed } from "../../lib/catalog-scope";
import { contextFor, requireSuperAdmin, type Principal } from "../authentication/service";
import { requestContext, requestColumns, isSandboxRequest } from "./order-model";
import { HttpError } from "../../lib/errors";
import { audit } from "../../lib/audit";
import { readTenant, activateTenant } from "../tenants/service";
import { deliveryLinks } from "./delivery-links";
import { prepareReviewedWebsite } from "./preparation";
import { catalogSelection } from "./order-catalog";

const eligible = new Set(["approved", "in_setup", "customization", "ready"]);
export function safeProvisioningError(error: unknown) {
  // Never persist raw database/network errors, stack traces, credentials or URLs.
  return error instanceof HttpError && error.status < 500 ? error.message.slice(0, 600)
    : "Provisioning could not finish. Retry; if it fails again, the operator must inspect server diagnostics.";
}
export async function recordProvisioningFailure(p: Principal, id: string, error: unknown) {
  assertCatalogOperationAllowed("provisioning failure recording");
  try {
    await withDatabase(requestContext(p, true), c => audit(c, p, null, "white_label.provisioning_failed",
      "Provisioning attempt failed; preparation transaction rolled back", { requestId: id, message: safeProvisioningError(error) }));
  } catch { /* Preserve the original failure if the database itself is unavailable. */ }
}
export function getProvisioning(p: Principal, id: string) {
  requireSuperAdmin(p);
  return withDatabase(contextFor(p), async c => {
    const result = await c.query(`SELECT id,status,tenant_id,configuration FROM white_label_requests WHERE id=$1`, [id]);
    const row = result.rows[0];
    if (!row || isSandboxRequest(row.configuration)) throw new HttpError(404, "White Label order not found.");
    const tenant = row.tenant_id ? await readTenant(c, row.tenant_id) : null;
    const recent = await c.query(`SELECT event_type,metadata FROM audit_events
      WHERE metadata->>'requestId'=$1 AND event_type IN
      ('white_label.provisioning_failed','white_label.request.prepared','white_label.provisioned','white_label.provisioning_resumed')
      ORDER BY created_at DESC,id DESC LIMIT 1`, [id]);
    const lastError = recent.rows[0]?.event_type === "white_label.provisioning_failed" ? recent.rows[0].metadata.message as string : null;
    const delivered = row.status === "delivered";
    const approved = !!tenant || eligible.has(row.status) || delivered;
    const blockers: string[] = [];
    if (!approved) blockers.push("Review final pricing and approve this order before preparing its website.");
    if (tenant && !tenant.configurationComplete) blockers.push(...tenant.activationBlockers,
      ...(tenant.provisioningStep !== "ready" ? [`Complete the ${tenant.provisioningStep.replaceAll("_", " ")} setup step.`] : []));
    if (row.status !== "ready" && !delivered) blockers.push("Super Admin must mark this website Ready after reviewing its configuration.");
    if (tenant && tenant.status !== "active" && !delivered) blockers.push("Activate the configured Sandbox before final delivery.");
    if (["rejected", "cancelled"].includes(row.status)) blockers.splice(0, blockers.length, "This order is closed and cannot be provisioned.");
    const step = (key: string, label: string, complete: boolean, message: string) => ({
      key, label, state: complete ? "complete" as const : lastError && key === "website" && !tenant ? "failed" as const
        : blockers.length && (key === "setup" || key === "delivery") ? "blocked" as const : "waiting" as const, message,
    });
    const steps = [
      step("approval", "Order approval", approved, approved ? "Reviewed plan and quotation accepted." : "Awaiting Super Admin approval."),
      step("tenant", "Isolated customer tenant", !!tenant, tenant ? "Separate tenant and configuration created." : "Created transactionally on approval."),
      step("website", "NovaX master website", !!tenant, tenant ? "Shared NovaX renderer; only this order's branding, no copied demo data." : "Waiting for tenant preparation."),
      step("setup", "Exchange configuration", !!tenant?.configurationComplete, tenant?.configurationComplete ? "Required setup passes readiness checks." : "Configure this tenant's assets, networks, actions, routes, rates and limits."),
      step("activation", "Sandbox activation", tenant?.status === "active", tenant?.status === "active" ? "Activated in Sandbox; no financial execution enabled." : "Waiting for valid setup and operator activation."),
      step("delivery", "Customer website and Admin Panel", delivered, delivered ? "Delivered to the original customer's existing account." : "No customer or public access before successful delivery."),
    ];
    return { requestId: id, tenantId: row.tenant_id ?? null, steps,
      completedCount: steps.filter(s => s.state === "complete").length, totalCount: steps.length,
      blockers: [...new Set(blockers)], lastError,
      canRetry: eligible.has(row.status), ...deliveryLinks({ status: row.status, tenantId: row.tenant_id }, tenant?.slug) };
  });
}
export async function retryProvisioning(p: Principal, id: string) {
  assertCatalogOperationAllowed("provisioning");
  requireSuperAdmin(p);
  try {
    const row = await withDatabase(contextFor(p, undefined, true), async c => {
      const r = await c.query(`SELECT ${requestColumns} FROM white_label_requests WHERE id=$1 FOR UPDATE`, [id]);
      if (!r.rowCount) throw new HttpError(404, "White Label order not found.");
      const current = r.rows[0];
      if (isSandboxRequest(current.configuration)) throw new HttpError(404, "White Label order not found.");
      if (current.status === "delivered") return current;
      if (!eligible.has(current.status)) throw new HttpError(409, "Approve this order before retrying provisioning.");
      if (!current.tenantId) {
        const selection = await catalogSelection(c, current.approvedConfiguration?.plan?.id ?? current.configuration.requestedPlanId,
          current.approvedConfiguration?.addons?.map((a: { id: string }) => a.id) ?? [], true);
        // Read current pricing under the row lock, never resubmit a stale snapshot.
        const prepared = await prepareReviewedWebsite(c, p, current, selection);
        return { ...current, tenantId: prepared.tenantId };
      }
      return current;
    });
    if (row.status === "delivered") return getProvisioning(p, id);
    if (row.tenantId) {
      const tenant = await withDatabase(contextFor(p, row.tenantId), c => readTenant(c, row.tenantId));
      if (tenant.configurationComplete) await activateTenant(p, row.tenantId);
      // Never regenerate existing branding, routes, assets or prices on retries.
    }
    await withDatabase(contextFor(p, undefined, true), c => audit(c, p, row.tenantId, "white_label.provisioning_resumed",
      "Resumed provisioning without replacing tenant configuration", { requestId: id }));
    return getProvisioning(p, id);
  } catch (error) {
    if ((error as {status?: number})?.status !== 404)
      await recordProvisioningFailure(p, id, error);
    throw error;
  }
}
