import { withDatabase, type DatabaseClient } from "@workspace/db";
import { publishedOffers } from "./pricing-publication";
import { acceptanceCatalog, assertCatalogOperationAllowed, catalogTable } from "../../lib/catalog-scope";
import { z } from "zod";
import { requireSuperAdmin, type Principal } from "../authentication/service";
import { requestContext, event, isSandboxRequest } from "../customer/order-model";
import { catalogSelection, whiteLabelCatalog } from "../customer/order-catalog";
import { HttpError } from "../../lib/errors";
import { audit } from "../../lib/audit";
import { catalogLock } from "../entitlements/catalog";
import { invoicePricing, assertSettlement, cents } from "./pricing";

const methodColumns = `id,name,kind,currency,instructions,enabled,approved,created_at AS "createdAt"`;
const invoiceColumns = `id,order_id AS "orderId",amount::text,currency,status,method_name AS "methodName",instructions,reference,created_at AS "createdAt",confirmed_at AS "confirmedAt"`;
export const methodInput = z.object({ name: z.string().trim().min(2).max(100), kind: z.enum(["bank_transfer", "manual"]), currency: z.string().regex(/^[A-Z]{3}$/),
  instructions: z.string().trim().max(4000), enabled: z.boolean(), approved: z.boolean() }).refine(v => !v.approved || v.instructions.length >= 10, "Approved methods require actual payment instructions.");
export function methods(p: Principal) {
  requireSuperAdmin(p);
  return withDatabase(requestContext(p), async c => (await c.query(`SELECT ${methodColumns} FROM qxlayer_commerce.methods ORDER BY created_at,id`)).rows);
}
export function saveMethod(p: Principal, id: string | undefined, raw: unknown) {
  assertCatalogOperationAllowed("shared payment method changes");
  requireSuperAdmin(p); const v = methodInput.parse(raw);
  return withDatabase(requestContext(p, true), async c => {
    if (id) await catalogLock(c, `commerce-method:${id}`, true);
    const args = [v.name, v.kind, v.currency, v.instructions, v.enabled, v.approved];
    const result = id ? await c.query(`UPDATE qxlayer_commerce.methods SET name=$1,kind=$2,currency=$3,instructions=$4,enabled=$5,approved=$6,updated_at=now() WHERE id=$7 RETURNING ${methodColumns}`, [...args, id]) :
      await c.query(`INSERT INTO qxlayer_commerce.methods(name,kind,currency,instructions,enabled,approved) VALUES($1,$2,$3,$4,$5,$6) RETURNING ${methodColumns}`, args);
    if (!result.rowCount) throw new HttpError(404, "Payment method not found.");
    await audit(c, p, null, "commerce.method.saved", "Saved platform payment method", { id: result.rows[0].id, approved: v.approved, enabled: v.enabled });
    return result.rows[0];
  });
}
export function deleteMethod(p: Principal, id: string) {
  assertCatalogOperationAllowed("shared payment method deletion");
  requireSuperAdmin(p);
  return withDatabase(requestContext(p, true), async c => {
    await catalogLock(c, `commerce-method:${id}`, true);
    await c.query("SELECT id FROM qxlayer_commerce.methods WHERE id=$1 FOR UPDATE", [id]);
    if ((await c.query("SELECT 1 FROM qxlayer_commerce.invoices WHERE method_id=$1 LIMIT 1", [id])).rowCount) throw new HttpError(409, "This method has historical invoices. Disable it instead.");
    if (!(await c.query("DELETE FROM qxlayer_commerce.methods WHERE id=$1 RETURNING id", [id])).rowCount) throw new HttpError(404, "Payment method not found.");
    await audit(c, p, null, "commerce.method.deleted", "Deleted unreferenced platform payment method", { id });
    return { deleted: true };
  });
}
async function owned(c: DatabaseClient, p: Principal, id: string) {
  const q = await c.query(`SELECT id,customer_user_id,configuration,status,monthly_price,setup_price,currency,customization_price,custom_design_decision,approved_configuration FROM white_label_requests
    WHERE id=$1 AND (customer_user_id=$2 OR $3) FOR UPDATE`, [id, p.userId, p.role === "super_admin"]);
  if (!q.rowCount) throw new HttpError(404, "Order not found.");
  if (isSandboxRequest(q.rows[0].configuration)) throw new HttpError(404, "Order not found.");
  return q.rows[0];
}
async function billing(c: DatabaseClient, row: any) {
  if (acceptanceCatalog()) return { invoice: null, methods: [], purchasable: false, blockedReason: "Acceptance catalog isolation: checkout is unavailable." };
  const invoice = (await c.query(`SELECT ${invoiceColumns} FROM qxlayer_commerce.invoices WHERE order_id=$1`, [row.id])).rows[0] ?? null;
  if (invoice) return { invoice, methods: [], purchasable: false, blockedReason: null };
  const available = (await c.query(`SELECT ${methodColumns} FROM qxlayer_commerce.methods WHERE enabled AND approved ORDER BY name,id`)).rows;
  let price: ReturnType<typeof invoicePricing> | null = null, blockedReason: string | null = null;
  try {
    price = (await livePricing(c, row)).price;
    const period = (await c.query(`SELECT monthly,yearly FROM ${catalogTable("offer_settings")} WHERE plan_id=$1`,
      [row.approved_configuration?.plan?.id ?? row.configuration.requestedPlanId])).rows[0];
    if (period && !period[price.billingPeriod]) blockedReason = "This billing period is disabled for the plan.";
  } catch (error) { if (!(error instanceof HttpError)) throw error; blockedReason = error.message; }
  const eligible = available.filter(m => m.currency === price?.currency);
  if (!blockedReason && !eligible.length) blockedReason = "No approved payment method is configured for this currency.";
  if (["rejected", "cancelled", "delivered"].includes(row.status)) blockedReason = "This order is closed.";
  return { invoice, methods: eligible, purchasable: !blockedReason, blockedReason };
}
async function livePricing(c: DatabaseClient, row: any) {
  const quoted = row.status === "quote_ready" ? row.approved_configuration : null;
  const selection = await catalogSelection(c, quoted?.plan?.id ?? row.configuration.requestedPlanId,
    quoted?.addons?.map((a: { id: string }) => a.id) ?? row.configuration.requestedAddonIds ?? [],!!quoted);
  const quotation = row.status === "quote_ready" ? { status: row.status, monthlyPrice: row.monthly_price, setupPrice: row.setup_price,
    customizationPrice: row.customization_price, customDesignDecision: row.custom_design_decision, currency: row.currency } : undefined;
  return { selection, price: invoicePricing({ ...row.configuration, catalogSnapshot: selection }, quotation) };
}
export function orderBilling(p: Principal, id: string) {
  // Row locks deliberately use a write-capable transaction, but no data is changed.
  return withDatabase(requestContext(p, true), async c => billing(c, await owned(c, p, id)));
}
export function checkout(p: Principal, id: string, methodId: string) {
  assertCatalogOperationAllowed("checkout");
  return withDatabase(requestContext(p, true), async c => {
    const row = await owned(c, p, id);
    if (row.customer_user_id !== p.userId) throw new HttpError(403, "Only the customer can initiate this invoice.");
    const before = await billing(c, row);
    if (before.invoice) return before;
    // Revalidate live approval/availability; never reprice an existing invoice.
    const { selection, price } = await livePricing(c, row);
    const periods = (await c.query(`SELECT monthly,yearly FROM ${catalogTable("offer_settings")} WHERE plan_id=$1`, [selection.plan!.id])).rows[0];
    if (periods && !periods[price.billingPeriod]) throw new HttpError(409, "This billing period is disabled for the plan.");
    // Row-share locks require UPDATE-policy visibility, which customers must not
    // have on operator configuration. Pair this advisory read lock with writes.
    await catalogLock(c, `commerce-method:${methodId}`, false);
    const m = (await c.query(`SELECT ${methodColumns} FROM qxlayer_commerce.methods WHERE id=$1 AND enabled AND approved`, [methodId])).rows[0];
    if (!m || m.currency !== price.currency) throw new HttpError(409, "Choose an approved payment method in the invoice currency.");
    if (["rejected", "cancelled", "delivered"].includes(row.status)) throw new HttpError(409, "This order is closed.");
    await c.query(`INSERT INTO qxlayer_commerce.invoices(order_id,customer_user_id,method_id,amount,currency,method_name,instructions,pricing_snapshot)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [id, p.userId, methodId, price.amount, price.currency, m.name, m.instructions, JSON.stringify({ ...price, selection })]);
    await c.query(`UPDATE white_label_requests SET monthly_price=$2,setup_price=$3,currency=$4,customization_price=$6,
      configuration=jsonb_set(configuration,'{catalogSnapshot}',$5::jsonb),updated_at=now() WHERE id=$1`,
      [id, price.recurring, price.setup, price.currency, JSON.stringify(selection), price.customization]);
    await event(c, p, id, "note", `Payment invoice issued: ${price.amount} ${price.currency}. Customer reports are unverified until an operator confirms actual settlement.`);
    return billing(c, row);
  });
}
export function reportPayment(p: Principal, id: string, reference: string) {
  assertCatalogOperationAllowed("payment reporting");
  return withDatabase(requestContext(p, true), async c => {
    const row = await owned(c, p, id);
    if (row.customer_user_id !== p.userId) throw new HttpError(403, "Only the customer can report payment.");
    if (["rejected", "cancelled", "delivered"].includes(row.status)) throw new HttpError(409, "This order is closed. Contact support to reconcile a transfer.");
    const changed = await c.query(`UPDATE qxlayer_commerce.invoices SET status='reported',reference=$2
      WHERE order_id=$1 AND status IN ('pending','reported') RETURNING id`, [id, reference]);
    if (!changed.rowCount) throw new HttpError(409, "No pending invoice is available.");
    await event(c, p, id, "note", "Customer reported a payment reference. Payment is NOT yet verified.");
    return billing(c, row);
  });
}
export function settle(p: Principal, invoiceId: string, raw: unknown, reject = false) {
  assertCatalogOperationAllowed("payment settlement");
  requireSuperAdmin(p);
  const v = z.object({ receivedAmount: z.string().optional(), currency: z.string().optional(), reference: z.string().trim().max(200).optional(), evidence: z.string().trim().min(10).max(2000) }).parse(raw);
  return withDatabase(requestContext(p, true), async c => {
    const find = await c.query("SELECT order_id FROM qxlayer_commerce.invoices WHERE id=$1", [invoiceId]);
    if (!find.rowCount) throw new HttpError(404, "Invoice not found.");
    const row = await owned(c, p, find.rows[0].order_id); // Consistent order -> invoice lock order.
    const invoice = (await c.query("SELECT * FROM qxlayer_commerce.invoices WHERE id=$1 FOR UPDATE", [invoiceId])).rows[0];
    if (invoice.status === "paid") throw new HttpError(409, "Verified payment is immutable.");
    if (["cancelled", "rejected", "delivered"].includes(row.status)) throw new HttpError(409, "This order is closed.");
    if (!reject) assertSettlement(invoice, { receivedAmount: v.receivedAmount ?? "", currency: v.currency ?? "", reference: v.reference ?? "", evidence: v.evidence });
    if (!reject) {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`payment:${invoice.method_id}:${v.reference!.trim().toUpperCase()}`]);
      if ((await c.query("SELECT id FROM qxlayer_commerce.invoices WHERE method_id=$1 AND upper(btrim(reference))=upper(btrim($2)) AND status='paid' AND id<>$3",
        [invoice.method_id, v.reference, invoiceId])).rowCount) throw new HttpError(409, "This transfer reference already confirmed another invoice.");
    }
    await c.query(`UPDATE qxlayer_commerce.invoices SET status=$2,evidence=$3,reference=$4,confirmed_by=$5,confirmed_at=now() WHERE id=$1`,
      [invoiceId, reject ? "rejected" : "paid", v.evidence, v.reference ?? invoice.reference, p.userId]);
    await event(c, p, row.id, "note", reject ? "Payment report rejected. Contact support to reconcile the payment." : "Payment verified by an operator against the exact invoice amount and currency. Your order awaits administrative review.");
    await audit(c, p, null, reject ? "commerce.payment.rejected" : "commerce.payment.confirmed", "Recorded manual settlement decision", { invoiceId, orderId: row.id, reference: v.reference, evidence: v.evidence });
    return billing(c, row);
  });
}
export async function assertPaid(c: DatabaseClient, orderId: string, quotation?: any, selection?: any) {
  const request = await c.query("SELECT configuration FROM white_label_requests WHERE id=$1", [orderId]);
  if (isSandboxRequest(request.rows[0]?.configuration)) throw new HttpError(404, "Order not found.");
  const q = await c.query("SELECT status,pricing_snapshot FROM qxlayer_commerce.invoices WHERE order_id=$1", [orderId]);
  const paid = q.rows[0];
  if (paid?.status !== "paid") throw new HttpError(409, "Verified payment is required before approval, setup or delivery.");
  if (quotation) {
    const price = paid.pricing_snapshot;
    if (quotation.currency !== price.currency || cents(quotation.monthlyPrice) !== cents(price.recurring) ||
      cents(quotation.setupPrice) !== cents(price.setup) || cents(quotation.customizationPrice ?? "0") !== cents(price.customization ?? "0"))
      throw new HttpError(409, "The reviewed quotation must match the paid invoice. Reconcile changes before approval.");
    if (selection && (selection.plan?.id !== price.selection.plan?.id ||
      JSON.stringify(selection.addons.map((a: any) => a.id).sort()) !== JSON.stringify(price.selection.addons.map((a: any) => a.id).sort())))
      throw new HttpError(409, "The reviewed plan and add-ons must match the paid invoice.");
  }
}
export async function publicOffers() {
  return withDatabase({actorId:"public:published-offers"}, async c => {
    const offer = await publishedOffers(c);
    if (acceptanceCatalog()) return { ...offer, methods: [], purchaseAvailable: false };
    const methods = (await c.query("SELECT id,name,kind,currency FROM qxlayer_commerce.methods WHERE enabled AND approved ORDER BY name,id")).rows;
    return { ...offer, methods, purchaseAvailable: offer.plans.some((p: any) => methods.some(m => m.currency === p.currency)) };
  });
}
