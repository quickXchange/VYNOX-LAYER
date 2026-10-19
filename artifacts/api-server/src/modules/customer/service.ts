import { withDatabase, type DatabaseClient } from "@workspace/db";
import { SubmitWhiteLabelRequestBody, ReviewWhiteLabelRequestBody, AddWhiteLabelNoteBody, type WhiteLabelNoteInput, type WhiteLabelRequestInput, type WhiteLabelReviewInput } from "@workspace/api-zod";
import { createHash } from "node:crypto";
import { contextFor, requireSuperAdmin, type Principal } from "../authentication/service";
import { HttpError } from "../../lib/errors";
import { audit } from "../../lib/audit";
import { acceptanceCatalog, assertCatalogOperationAllowed } from "../../lib/catalog-scope";
import { requireFeature, resolveEntitlements } from "../entitlements/resolver";
import { requestColumns as columns, orderView, event, eventColumns, requestContext, assertTransition, assertFinalPricing, isSandboxRequest } from "./order-model";
import { catalogSelection } from "./order-catalog";
import { prepareReviewedWebsite } from "./preparation";
import { assertPaid } from "../commerce/service";
import { recordProvisioningFailure } from "./provisioning";
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  return value;
}

export function myAdminPanels(p: Principal) {
  if (p.role === "super_admin") return Promise.resolve([]);
  return Promise.all(p.memberships.map(m => withDatabase(contextFor(p, m.tenantId), async c => {
    const r = await c.query(`SELECT t.id AS "tenantId",t.name,coalesce(b.brand_name,t.name) AS "brandName",t.slug,t.status
      FROM tenants t LEFT JOIN tenant_branding b ON b.tenant_id=t.id
       WHERE t.id=$1 AND ('exchange_provisioned'=ANY(t.completed_steps) OR EXISTS
         (SELECT 1 FROM white_label_requests ready WHERE ready.tenant_id=t.id AND ready.status='delivered'))
         AND t.status IN ('active','suspended')
        AND NOT EXISTS (SELECT 1 FROM white_label_requests w WHERE w.tenant_id=t.id AND w.status<>'delivered')`, [m.tenantId]);
    return r.rows.map(row => ({ ...row, role: m.role }));
  }))).then(rows => rows.flat());
}
export function assertDeliveredExchangeAccess(p: Principal, tenantId: string) {
  if (p.role === "super_admin") return Promise.resolve();
  return withDatabase(contextFor(p, tenantId), async c => {
    const r = await c.query(`SELECT id FROM tenants t WHERE id=$1 AND
      ('exchange_provisioned'=ANY(completed_steps) OR EXISTS
        (SELECT 1 FROM white_label_requests ready WHERE ready.tenant_id=t.id AND ready.status='delivered'))
      AND status IN ('active','suspended')
      AND NOT EXISTS (SELECT 1 FROM white_label_requests w WHERE w.tenant_id=t.id AND w.status<>'delivered')`, [tenantId]);
    if (!r.rowCount) throw new HttpError(403, "This Exchange has not been provisioned for your account.");
  });
}
export function listRequests(p: Principal, operator = false) {
  if (operator) requireSuperAdmin(p);
  return withDatabase(requestContext(p), async c => {
    const r = await c.query(`SELECT ${columns} FROM white_label_requests
      WHERE ${operator ? "configuration->>'sandboxOnly' IS DISTINCT FROM 'true'" : "customer_user_id=$1"}
      ORDER BY created_at DESC`, operator ? [] : [p.userId]);
    const orders = [];
    for (const row of r.rows) orders.push(await orderView(c, row));
    return orders;
  });
}
export function submitRequest(p: Principal, raw: WhiteLabelRequestInput, sandboxOnly = false) {
  if (!sandboxOnly) assertCatalogOperationAllowed("customer request submission");
  else if (acceptanceCatalog()) {
    const expected = (process.env.QXLAYER_ACCEPTANCE_SANDBOX_REQUESTER_EMAIL_SHA256 ?? "").trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected) || p.authenticationProvider !== "supabase" ||
        p.demo === true || p.verifiedEmailSha256 !== expected)
      throw new HttpError(403, "Preparation mode: this request is not authorized.");
  }
  if (p.role === "super_admin") throw new HttpError(403, "Super Admin reviews customer requests; use a customer account to submit.");
  const input = SubmitWhiteLabelRequestBody.parse(raw);
  if(input.actions.some(action=>!["swap","convert"].includes(action)))
    throw new HttpError(400,"Only Crypto/Fiat Swap and Crypto/Crypto Convert can be ordered. Buy and Sell are retired.");
  const { idempotencyKey, ...fields } = input;
  const configuration = { ...fields, projectName: fields.projectName.trim(), brandName: fields.brandName.trim(), preferredDomain: fields.preferredDomain?.trim() || null };
  if (configuration.projectName.length < 2 || configuration.brandName.length < 2 || new Set(input.actions).size !== input.actions.length) throw new HttpError(400, "Provide project and brand names and distinct Exchange actions.");
  return withDatabase(requestContext(p, true), async c => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`order-submit:${p.userId}:${idempotencyKey}`]);
    const fingerprint = createHash("sha256").update(JSON.stringify(stable(configuration))).digest("hex");
    const previous = await c.query(`SELECT ${columns} FROM white_label_requests WHERE customer_user_id=$1 AND idempotency_key=$2`, [p.userId, idempotencyKey]);
    if (previous.rowCount) {
      const old = previous.rows[0];
      if (isSandboxRequest(old.configuration) !== sandboxOnly)
        throw new HttpError(409, "This submission key belongs to a request in a different preparation mode.");
      if (old.configuration.inputFingerprint ? old.configuration.inputFingerprint !== fingerprint :
          Object.keys(configuration).some(k => JSON.stringify(old.configuration[k]) !== JSON.stringify(configuration[k as keyof typeof configuration]))) throw new HttpError(409, "This submission key belongs to another request.");
      return orderView(c, old);
    }
    if (configuration.design?.referenceWebsiteUrl) {
      let url: URL;
      try { url = new URL(configuration.design.referenceWebsiteUrl); }
      catch { throw new HttpError(400, "Enter a valid reference website URL."); }
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new HttpError(400, "Use a normal http or https reference website URL without credentials.");
    }
    if (configuration.design && !configuration.requestedPlanId) throw new HttpError(400, "Choose an available plan for this White Label request.");
    const snapshot = await catalogSelection(c, configuration.requestedPlanId ?? null, configuration.requestedAddonIds ?? []);
    if (snapshot.plan && !snapshot.plan.billingPeriods.includes(configuration.billingPeriod ?? "monthly"))
      throw new HttpError(409, "This billing period is no longer available for the selected plan.");
    const design = configuration.design;
    const ids = [...new Set([...(configuration.attachmentIds ?? []), ...(design?.referenceAttachmentIds ?? []), design?.logoAttachmentId, design?.faviconAttachmentId].filter((x): x is string => !!x))];
    if (ids.length > 20) throw new HttpError(400, "An order accepts up to 20 attachments.");
    const files = await c.query("SELECT id,size,category FROM white_label_attachments WHERE id=ANY($1::uuid[]) AND owner_user_id=$2 AND request_id IS NULL FOR UPDATE", [ids, p.userId]);
    if (files.rows.length !== ids.length) throw new HttpError(400, "An attachment is unavailable, already submitted, or does not belong to your account.");
    if (files.rows.reduce((n, f) => n + f.size, 0) > 40 * 1024 * 1024) throw new HttpError(400, "Total order attachments cannot exceed 40 MB.");
    const categoryFor = (id: string | null | undefined, category: string) => {
      if (id && files.rows.find(f => f.id === id)?.category !== category) throw new HttpError(400, "Attachment category does not match its requested use.");
    };
    categoryFor(design?.logoAttachmentId, "logo"); categoryFor(design?.faviconAttachmentId, "favicon");
    design?.referenceAttachmentIds.forEach(id => categoryFor(id, "design_reference"));
    configuration.attachmentIds?.forEach(id => categoryFor(id, "requirement"));
    const storedConfiguration = { ...configuration, ...(sandboxOnly ? { sandboxOnly: true } : {}),
      catalogSnapshot: snapshot, inputFingerprint: fingerprint };
    const inserted = await c.query(`INSERT INTO white_label_requests (customer_user_id,idempotency_key,configuration)
      VALUES ($1,$2,$3) ON CONFLICT (customer_user_id,idempotency_key) DO NOTHING RETURNING ${columns}`, [p.userId, idempotencyKey, JSON.stringify(storedConfiguration)]);
    const row = inserted.rows[0] ?? (await c.query(`SELECT ${columns} FROM white_label_requests WHERE customer_user_id=$1 AND idempotency_key=$2`, [p.userId, idempotencyKey])).rows[0];
    if (!row || row.configuration.inputFingerprint !== fingerprint) throw new HttpError(409, "This submission key belongs to another request.");
    if (inserted.rowCount) {
      await c.query("UPDATE white_label_attachments SET request_id=$1 WHERE id=ANY($2::uuid[]) AND owner_user_id=$3 AND request_id IS NULL", [row.id, ids, p.userId]);
      if (!sandboxOnly)
        await event(c, p, row.id, "status", "White Label request submitted. Configuration and attachments await Super Admin review.", "customer", "new");
    }
    return orderView(c, row);
  });
}
export function reviewRequest(p: Principal, id: string, raw: WhiteLabelReviewInput) {
  assertCatalogOperationAllowed("request review");
  requireSuperAdmin(p);
  const input = ReviewWhiteLabelRequestBody.parse(raw);
  return withDatabase(requestContext(p, true), async c => {
    const existing = await c.query(`SELECT ${columns} FROM white_label_requests WHERE id=$1 FOR UPDATE`, [id]);
    if (!existing.rowCount) throw new HttpError(404, "White Label request not found.");
    const old = existing.rows[0];
    if (isSandboxRequest(old.configuration)) throw new HttpError(404, "White Label request not found.");
    assertTransition(old.status, input.status);
    const selection = ["rejected", "cancelled"].includes(input.status) ? (old.approvedConfiguration ?? { plan: null, addons: [] }) :
      await catalogSelection(c, input.approvedPlanId !== undefined ? input.approvedPlanId : (old.approvedConfiguration?.plan?.id ?? old.configuration.catalogSnapshot?.plan?.id ?? null),
        input.approvedAddonIds ?? old.approvedConfiguration?.addons?.map((a: { id: string }) => a.id) ?? old.configuration.requestedAddonIds ?? [], true);
    if (old.configuration.requestedPlanId && !selection.plan && !["rejected", "cancelled"].includes(input.status)) throw new HttpError(400, "Choose an approved plan for this order.");
    if (input.status === "approved" && !selection.plan) throw new HttpError(409, "Select a White Label Exchange plan before approving and preparing this order.");
    const next = { ...old, monthlyPrice: input.monthlyPrice, setupPrice: input.setupPrice, currency: input.currency,
      customizationPrice: input.customizationPrice === undefined ? old.customizationPrice : input.customizationPrice,
      customDesignDecision: input.customDesignDecision ?? old.customDesignDecision };
    if (["approved", "in_setup", "customization", "ready"].includes(input.status)) {
      assertFinalPricing(next);
      await assertPaid(c, id, next, selection);
    }
    if (input.status === "quote_ready" && (next.monthlyPrice == null || next.setupPrice == null ||
      (old.configuration.design?.type === "custom" && next.customizationPrice == null))) throw new HttpError(409, "Set the complete quotation before marking it Quote Ready.");
    const r = await c.query(`UPDATE white_label_requests SET status=$2,monthly_price=$3,setup_price=$4,currency=$5,
      customization_price=$6,custom_design_decision=$7,approved_configuration=$8,updated_at=now() WHERE id=$1 RETURNING ${columns}`,
      [id, input.status, input.monthlyPrice, input.setupPrice, input.currency, next.customizationPrice, next.customDesignDecision, JSON.stringify(selection)]);
    if (old.status !== input.status) await event(c, p, id, "status", `Status changed to ${input.status.replaceAll("_", " ")}.`, "customer", input.status);
    if (old.monthlyPrice !== input.monthlyPrice || old.setupPrice !== input.setupPrice || old.customizationPrice !== next.customizationPrice || old.currency !== input.currency) {
      await event(c, p, id, "note", `Quotation updated: recurring ${input.monthlyPrice ?? "requires review"}, setup ${input.setupPrice ?? "requires review"}, customization ${next.customizationPrice ?? "not quoted"} (${input.currency}).`);
    }
    if (input.operatorNote.trim() && input.operatorNote.trim() !== old.operatorNote) {
      await event(c, p, id, "note", input.operatorNote.trim());
      await c.query("UPDATE white_label_requests SET operator_note=$2 WHERE id=$1", [id, input.operatorNote.trim()]);
      r.rows[0].operatorNote = input.operatorNote.trim();
    }
    await audit(c, p, null, "white_label.request.reviewed", "Reviewed Exchange White Label request", { requestId: id, status: input.status });
    if (input.status === "approved" && !old.tenantId && selection.plan) {
      return prepareReviewedWebsite(c, p, r.rows[0], selection);
    }
    // Ready is a review milestone, not permission to hand over customer access.
    // Only the explicit Super Admin delivery endpoint may deliver a request.
    return orderView(c, r.rows[0]);
  }).catch(async error => {
    if (input.status === "approved" && (error as {status?: number})?.status !== 404)
      await recordProvisioningFailure(p, id, error);
    throw error;
  });
}
export async function deliverLinkedRequest(c: DatabaseClient, p: Principal, id: string, tenantId: string) {
  assertCatalogOperationAllowed("linked request delivery");
    requireSuperAdmin(p);
    const request = await c.query(`SELECT ${columns} FROM white_label_requests WHERE id=$1 FOR UPDATE`, [id]);
    if (!request.rowCount) throw new HttpError(404, "White Label request not found.");
    const row = request.rows[0];
    if (isSandboxRequest(row.configuration)) throw new HttpError(404, "White Label request not found.");
    if (row.status === "delivered" && row.tenantId === tenantId) return orderView(c, row);
    await assertPaid(c, id, row, row.approvedConfiguration);
    if (row.tenantId && row.tenantId !== tenantId) throw new HttpError(409, "This request is linked to a different Exchange.");
    // Custom designs are never generated by the approval step: the operator must mark them ready.
    if (row.status !== "ready") return null;
    assertFinalPricing(row);
    const tenant = await c.query("SELECT id,status,completed_steps FROM tenants WHERE id=$1 FOR UPDATE", [tenantId]);
    if (!tenant.rowCount || tenant.rows[0].status !== "active" || !tenant.rows[0].completed_steps.includes("exchange_provisioned")) throw new HttpError(409, "Finish Exchange setup and activate this tenant before handing it to the customer.");
    const effective = await resolveEntitlements(c, tenantId);
    requireFeature(effective, "website"); requireFeature(effective, "crypto_exchange");
    if (effective.overLimit) throw new HttpError(409, "Resolve this Exchange's plan limits before provisioning.");
    const approved = row.approvedConfiguration;
    if (approved?.plan && approved.plan.id !== effective.plan?.id) throw new HttpError(409, "Assign the reviewed plan to the prepared tenant before delivery.");
    const actualAddons = await c.query("SELECT ta.addon_id FROM tenant_addons ta JOIN public.addons a ON a.id=ta.addon_id AND a.enabled WHERE ta.tenant_id=$1", [tenantId]);
    if (approved?.addons?.some((a: { id: string }) => !actualAddons.rows.some(r => r.addon_id === a.id))) throw new HttpError(409, "Assign the reviewed add-ons to the prepared tenant before delivery.");
    const configured = await c.query("SELECT configuration FROM tenant_product_configuration WHERE tenant_id=$1 AND module_key='crypto_exchange'", [tenantId]);
    const settings = configured.rows[0]?.configuration;
    if (!settings || settings.referenceCurrency !== effective.plan?.currency) throw new HttpError(409, "Review and save the Exchange reference rates for the assigned plan before provisioning.");
    for (const action of row.configuration.actions as string[]) {
      if(!["swap","convert"].includes(action))continue; // Historical requested offerings are retained, not reactivated.
      requireFeature(effective, action);
      if (!settings.actions?.[action] || !settings.routes?.some((r: { action: string; enabled: boolean }) => r.enabled && r.action === action)) throw new HttpError(409, `Configure the requested ${action} action and its route before provisioning.`);
    }
    const owner = await c.query("SELECT clerk_user_id FROM tenant_memberships WHERE tenant_id=$1 AND role='client_admin' AND active AND clerk_user_id<>$2", [tenantId, row.customerUserId]);
    if (owner.rowCount) throw new HttpError(409, "This Exchange is already owned by another customer.");
    const used = await c.query("SELECT id FROM white_label_requests WHERE tenant_id=$1 AND id<>$2", [tenantId, id]);
    if (used.rowCount) throw new HttpError(409, "This Exchange has already been delivered.");
    await c.query("INSERT INTO tenant_memberships (tenant_id,clerk_user_id,role,label,active) VALUES ($1,$2,'client_admin','Customer account owner',true) ON CONFLICT (tenant_id,clerk_user_id) DO UPDATE SET role='client_admin',active=true", [tenantId, row.customerUserId]);
    const r = await c.query(`UPDATE white_label_requests SET status='delivered',tenant_id=$2,updated_at=now() WHERE id=$1 RETURNING ${columns}`, [id, tenantId]);
    await event(c, p, id, "status", "White Label delivered to your existing VYNOX LAYER account. Your authorized Admin Panel is available.", "customer", "delivered");
    await audit(c, p, tenantId, "white_label.provisioned", "Delivered Exchange into the existing VYNOX LAYER customer account", { requestId: id });
    return orderView(c, r.rows[0]);
}
export function deliverRequest(p: Principal, id: string, tenantId: string) {
  assertCatalogOperationAllowed("request delivery");
  requireSuperAdmin(p);
  return withDatabase(contextFor(p, tenantId, true), async c => {
    // Request -> tenant lock order matches review and sandbox activation.
    const result = await deliverLinkedRequest(c, p, id, tenantId);
    if (!result) throw new HttpError(409, "Finish approval and setup before delivery. Custom designs must be marked Ready.");
    return result;
  });
}

export function orderDetail(p: Principal, id: string, operator = false) {
  if (operator) requireSuperAdmin(p);
  return withDatabase(requestContext(p), async c => {
    const r = await c.query(`SELECT ${columns} FROM white_label_requests WHERE id=$1
      ${operator ? "AND configuration->>'sandboxOnly' IS DISTINCT FROM 'true'" : "AND customer_user_id=$2"}`,
      operator ? [id] : [id, p.userId]);
    if (!r.rowCount) throw new HttpError(404, "White Label order not found.");
    const history = await c.query(`SELECT ${eventColumns} FROM white_label_events WHERE request_id=$1 ${operator ? "" : "AND visibility='customer'"} ORDER BY created_at,id`, [id]);
    return { order: await orderView(c, r.rows[0]), history: history.rows.map(row =>
      row.kind === "status" && typeof row.message === "string"
        ? { ...row, message: row.message.replace(/\bQX\s?Layer\b/gi, "VYNOX LAYER") }
        : row) };
  });
}
export function appendNote(p: Principal, id: string, raw: WhiteLabelNoteInput) {
  requireSuperAdmin(p);
  const note = AddWhiteLabelNoteBody.parse(raw);
  if (!note.message.trim()) throw new HttpError(400, "Write a note message.");
  return withDatabase(requestContext(p, true), async c => {
    const r = await c.query("SELECT id,configuration FROM white_label_requests WHERE id=$1 FOR UPDATE", [id]);
    if (!r.rowCount) throw new HttpError(404, "White Label order not found.");
    if (isSandboxRequest(r.rows[0].configuration)) throw new HttpError(404, "White Label order not found.");
    const added = await event(c, p, id, "note", note.message.trim(), note.visibility);
    if (note.visibility === "customer") await c.query("UPDATE white_label_requests SET operator_note=$2,updated_at=now() WHERE id=$1", [id, note.message.trim()]);
    return added;
  });
}