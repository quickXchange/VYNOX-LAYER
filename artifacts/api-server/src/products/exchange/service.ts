import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { withDatabase, type DatabaseClient } from "@workspace/db";
import { CreateSandboxQuoteBody, SaveExchangeConfigurationBody, type ExchangeQuoteInput, type ExchangeSettings, type ExchangeOrderInput, type ExchangeStatusInput, type ExchangeOrder } from "@workspace/api-zod";
import { HttpError } from "../../lib/errors";
import { audit } from "../../lib/audit";
import { contextFor, type Principal } from "../../modules/authentication/service";
import { consumeMonthlyUsage, enforceLimit, lockTenant, requireFeature, resolveEntitlements, type EffectiveEntitlements } from "../../modules/entitlements/resolver";
import { decimal, decimalString } from "../../modules/entitlements/decimal";
import { publicTenantId } from "../../modules/website/service";
import type { WebsitePreview } from "../../modules/website/operator-preview";
import { ACTIONS, emptySettings, readExchange, validateExchange } from "./settings";
import { calculateQuote } from "./calculation";
import { validateTenantCatalog, validActionPair } from "./global-catalog";
import { publicExchangeConfiguration } from "./public-configuration";
import { statusesForOrderView } from "./order-views";
import { paymentInstructionsSnapshot,fundingWalletSnapshot } from "./payment-snapshot";
import { assertTelegramTransaction } from "../../modules/integrations/channel";
import { applyPricing, sandboxPricing, assertPricingSnapshot, type PricingSnapshot } from "./provider-pricing";
import { customerExchangeConfiguration, mergeCustomerExchangeConfiguration } from "./customer-configuration";
import { customerList, orderContact } from "./customer-management";
import { publicHistory, validatedCustomerDetails } from "./order-workflow";

const hash = (v: string) => createHash("sha256").update(v).digest("hex");
function sign(v: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) throw new HttpError(503, "Sandbox quote signing is not configured.");
  return createHmac("sha256", secret).update(`exchange-sandbox-v1:${v}`).digest("base64url");
}
function equal(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function issue(tenantId: string, input: ExchangeQuoteInput, s: ExchangeSettings, planCurrency: string, pricing?: PricingSnapshot) {
  const expiresAt = new Date(Math.min(Date.now() + 90000,pricing?.validUntil??Infinity)).toISOString();
  const body = Buffer.from(JSON.stringify({ tenantId, input, settingsHash: hash(JSON.stringify(s)), planCurrency, expiresAt, pricing })).toString("base64url");
  return { token: `${body}.${sign(body)}`, expiresAt };
}
function verify(token: string, tenantId: string, settings: ExchangeSettings, planCurrency: string) {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra || !equal(signature, sign(body))) throw new HttpError(400, "Invalid sandbox quote.");
  let value;
  try { value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { throw new HttpError(400, "Invalid sandbox quote."); }
  if (value.tenantId !== tenantId) throw new HttpError(404, "Sandbox quote not found.");
  if (value.planCurrency !== planCurrency) throw new HttpError(409, "Plan currency changed. Request a fresh sandbox quote.");
  if (!Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) throw new HttpError(409, "Quote expired. Request a fresh quote.");
  if (value.settingsHash !== hash(JSON.stringify(settings))) throw new HttpError(409, "Exchange configuration changed. Request a fresh quote.");
  return { ...CreateSandboxQuoteBody.parse(value.input), pricing: value.pricing as PricingSnapshot | undefined };
}
function guard(e: EffectiveEntitlements, action?: string, readOnlyPreview = false) {
  if (e.tenantStatus !== "active" && !(readOnlyPreview && e.tenantStatus === "draft")) throw new HttpError(404, "Exchange website is not active.");
  requireFeature(e, "website");
  requireFeature(e, "crypto_exchange");
  if (action) requireFeature(e, action);
}
export function exchangeConfiguration(principal: Principal, tenantId: string, input?: ExchangeSettings) {
  return withDatabase(contextFor(principal, tenantId, input !== undefined, "configuration.manage"), async client => {
    if (input) await lockTenant(client, tenantId);
    const e = await resolveEntitlements(client, tenantId);
    const result = await readExchange(client, tenantId);
    if (principal.role !== "super_admin") requireFeature(e, "crypto_exchange");
    if (input) {
      if (principal.role !== "super_admin") {
        input = mergeCustomerExchangeConfiguration(input, result.configuration, e);
      }
      requireFeature(e, "crypto_exchange");
      const s = validateExchange(input, e, result.catalog);
      await validateTenantCatalog(client,s);
      const previousIds = result.configuration.paymentMethods.map(m => m.id);
      const existing = await client.query("SELECT id,label FROM tenant_payment_methods WHERE tenant_id=$1", [tenantId]);
      const total = new Set([...existing.rows.map(m => m.id).filter(id => !previousIds.includes(id) || s.paymentMethods.some(m => m.id === id)), ...s.paymentMethods.map(m => m.id)]).size;
      enforceLimit(e, "max_payment_methods", String(total));
      // Only exchange-owned labels are reconciled; other product configuration is untouched.
      for (const m of s.paymentMethods) {
        const saved = await client.query("INSERT INTO tenant_payment_methods (id,tenant_id,label) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET label=EXCLUDED.label WHERE tenant_payment_methods.tenant_id=EXCLUDED.tenant_id", [m.id, tenantId, m.label.trim()]);
        if (!saved.rowCount) throw new HttpError(400, "Payment method identifier belongs to another tenant.");
      }
      const removed = previousIds.filter(id => !s.paymentMethods.some(m => m.id === id));
      if (removed.length) await client.query("DELETE FROM tenant_payment_methods WHERE tenant_id=$1 AND id=ANY($2::uuid[])", [tenantId, removed]);
      // Materialize the existing pricing-rule foundation. Historical rule rows stay
      // available for existing orders; each order also keeps immutable quote values.
      for (const r of s.routes) {
        const saved = await client.query(
          "INSERT INTO pricing_rules (id,tenant_id,name,fee_bps) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,fee_bps=EXCLUDED.fee_bps WHERE pricing_rules.tenant_id=EXCLUDED.tenant_id",
          [r.id, tenantId, `Sandbox ${r.action}: ${r.source} → ${r.destination}`, r.feeBps.toString()]);
        if (!saved.rowCount) throw new HttpError(400, "Route identifier belongs to another tenant.");
      }
      await client.query(`INSERT INTO tenant_product_configuration (tenant_id,module_key,configuration) VALUES ($1,'crypto_exchange',$2)
        ON CONFLICT (tenant_id,module_key) DO UPDATE SET configuration=EXCLUDED.configuration ||
          jsonb_build_object('_customerDirectory',COALESCE(tenant_product_configuration.configuration->'_customerDirectory','{}'::jsonb),
            '_notificationInbox',COALESCE(tenant_product_configuration.configuration->'_notificationInbox','{}'::jsonb)) ||
          CASE WHEN tenant_product_configuration.configuration ? 'optionalIntegrations'
            THEN jsonb_build_object('optionalIntegrations',tenant_product_configuration.configuration->'optionalIntegrations')
            ELSE '{}'::jsonb END,updated_at=now()`, [tenantId, JSON.stringify({ ...s, referenceCurrency: e.plan?.currency })]);
      await client.query("UPDATE tenant_configuration SET exchange_enabled=$2 WHERE tenant_id=$1", [tenantId, s.enabled]);
      await client.query("UPDATE tenants SET completed_steps=CASE WHEN 'configuration'=ANY(completed_steps) THEN completed_steps ELSE array_append(completed_steps,'configuration') END,updated_at=now() WHERE id=$1", [tenantId]);
      await audit(client, principal, tenantId, "exchange.configuration.saved", "Updated White Label Exchange sandbox settings", { routes: s.routes.length, enabled: s.enabled });
      for (const key of ["assets", "networks", "routes", "paymentMethods", "providers", "pricingRules", "wallets"] as const) {
        const before = (result.configuration[key] ?? []) as unknown as Record<string, unknown>[], after = (s[key] ?? []) as unknown as Record<string, unknown>[];
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          const identify = (v: Record<string, unknown>) => v.id ?? v.assetId ?? v.assetNetworkId ?? v.providerId;
          const prior = new Map(before.map(v => [identify(v), v]));
          const changed = after.filter(v => JSON.stringify(prior.get(identify(v))) !== JSON.stringify(v)).length +
            before.filter(v => !after.some(a => identify(a) === identify(v))).length;
          await audit(client, principal, tenantId, `exchange.${key}.changed`, `Updated sandbox exchange ${key}`, { beforeCount: before.length, afterCount: after.length, changedCount: changed });
          if (changed > 1) await audit(client, principal, tenantId, "exchange.bulk.changed", `Applied changes to ${changed} ${key}`, { section: key, changedCount: changed });
        }
      }
      const price = (r: ExchangeSettings["routes"][number]) => [r.id, r.rate, r.feeBps, r.fixedFee, r.spreadBps, r.minimum, r.maximum];
      if (JSON.stringify(result.configuration.routes.map(price)) !== JSON.stringify(s.routes.map(price))) await audit(client, principal, tenantId, "exchange.pricing.changed", "Updated sandbox route pricing, fees or limits", {});
      result.configuration = s;
    }
    const legacy = await client.query("SELECT exchange_enabled FROM tenant_configuration WHERE tenant_id=$1", [tenantId]);
    return { ...result, providerCatalog: principal.role === "super_admin" ? result.providerCatalog : [],
      configuration: principal.role === "super_admin" ? result.configuration : customerExchangeConfiguration(result.configuration,e), effectiveEnabled: result.configuration.enabled && legacy.rows[0]?.exchange_enabled === true && e.features.crypto_exchange === true && e.features.website === true && e.tenantStatus === "active" && e.status === "active" && !e.overLimit };
  });
}
export async function publicExchange(slug: string, preview?: WebsitePreview) {
  if (!preview) {
    const { releasedConfig } = await import("../../modules/website/release-config");
    const live = await releasedConfig(slug);
    if (!live.config.exchange) throw new HttpError(404, "Exchange is not included in the released site.");
    return live.config.exchange;
  }
  const tenantId = await publicTenantId(slug, preview);
  return withDatabase({ actorId: "sandbox-visitor", tenantId, isSuperAdmin: !!preview }, async client => {
    const e = await resolveEntitlements(client, tenantId); guard(e, undefined, !!preview);
    return publicExchangeConfiguration(client, tenantId, e);
  });
}
function quoteAdmission(e: EffectiveEntitlements, volume: string) {
  const used = Object.fromEntries(e.usage.map(u => [u.key, u.used]));
  enforceLimit(e, "max_monthly_transactions", decimalString(decimal(used.max_monthly_transactions ?? "0") + decimal("1")));
  enforceLimit(e, "max_monthly_volume", decimalString(decimal(used.max_monthly_volume ?? "0") + decimal(volume)));
}
async function operationalExchange(client: DatabaseClient, tenantId: string, action?: string) {
  if (action && !["swap","convert"].includes(action)) throw new HttpError(400, "Buy and Sell are retired; select Swap or Convert.");
  const e = await resolveEntitlements(client, tenantId); guard(e, action);
  if (e.overLimit) throw new HttpError(409, "Resolve the tenant's over-limit resource usage before creating sandbox quotes or orders.");
  const legacy = await client.query("SELECT exchange_enabled FROM tenant_configuration WHERE tenant_id=$1", [tenantId]);
  if (!legacy.rows[0]?.exchange_enabled) throw new HttpError(409, "The tenant exchange is paused.");
  const reference = await client.query("SELECT configuration->>'referenceCurrency' AS currency FROM tenant_product_configuration WHERE tenant_id=$1 AND module_key='crypto_exchange'", [tenantId]);
  if (reference.rows[0]?.currency !== e.plan?.currency) throw new HttpError(409, "The plan currency changed. Review and save the sandbox reference rates in Exchange Admin before requesting quotes.");
  return e;
}
export async function sandboxQuote(slug: string, input: ExchangeQuoteInput, channel?: "telegram") {
  if (!validActionPair(input.action,input.source,input.destination))
    throw new HttpError(400,"Swap requires Crypto/Fiat; Convert requires Crypto/Crypto.");
  const tenantId = await publicTenantId(slug);
  return withDatabase({ actorId: "sandbox-visitor", tenantId }, async client => {
    const e = await operationalExchange(client, tenantId, input.action);
    if (channel) await assertTelegramTransaction(client, tenantId, input.action);
    const { configuration: s, catalog } = await readExchange(client, tenantId);
    const pricing = await sandboxPricing(client, tenantId, input, s, catalog,e.plan!.currency);
    const { quote, volume } = calculateQuote(applyPricing(s, pricing), catalog, input);
    quoteAdmission(e, volume);
    return { ...quote,rateProvider:pricing?.rateProvider??pricing?.providerKey??"Manual",rateUpdatedAt:pricing?.rateUpdatedAt,
      quoteKind:pricing?.quoteKind??(pricing&&["quickex","whitebit"].includes(pricing.providerKey)?"provider":"manual"),
      pricingSource: pricing ? (pricing.manualFallback ? `${pricing.providerKey}:manual_fallback` : pricing.providerKey) : "manual",
      ...issue(tenantId, input, s, e.plan!.currency, pricing) };
  });
}
type StoredRequest = Omit<ReturnType<typeof calculateQuote>["quote"],"rateUpdatedAt"> & {
  product: "crypto_exchange"; quoteHash: string; idempotencyHash: string;
  paymentMethod: string | null; paymentMethodId?: string | null; volume: string; history: { status: string; at: string; note: string }[];
  pricingSource?: string;
  paymentInstructions?: string | null;
  customerName?: string; customerEmail?: string; customerId?: string;
  customerDetails?: ExchangeOrderInput["customerDetails"]; workflowVersion?: number;
  internalNotes?:{status:string;at:string;note:string}[]; assigneeId?:string;
  paymentVerification?:"unverified"|"review"|"verified"; depositReference?:string; transactionHash?:string;
  payoutReference?:string; completedAt?:string; rateProvider?:string;rateUpdatedAt?:string;quoteKind?:"manual"|"indicative"|"provider";
  paymentAddress?:string;paymentMemo?:string;
};
interface OrderRow { id: string; status: string; request: StoredRequest; created_at: Date }
// JSONB reorders object keys. Replay comparison is semantic, not insertion-order
// JSON text; the same submitted details must not create a second order.
export function customerDetailsKey(details:ExchangeOrderInput["customerDetails"]){
  return JSON.stringify(Object.entries(details??{}).map(([k,v])=>[k,v?.trim()??""]).sort(([a],[b])=>a.localeCompare(b)));
}
export async function reviewOrder(slug:string,input:ExchangeOrderInput){
  orderContact(input);
  const tenantId=await publicTenantId(slug);
  return withDatabase({actorId:"sandbox-visitor",tenantId},async c=>{
    const e=await operationalExchange(c,tenantId);
    const {configuration:s,catalog}=await readExchange(c,tenantId);
    const request=verify(input.quoteToken,tenantId,s,e.plan!.currency);
    validatedCustomerDetails(input,request,s,catalog);
    guard(e,request.action);
    await assertPricingSnapshot(c,tenantId,request.pricing,request.action,e);
    const {quote}=calculateQuote(applyPricing(s,request.pricing),catalog,request);
    const payload=JSON.parse(Buffer.from(input.quoteToken.split(".")[0],"base64url").toString("utf8"));
    return {quote:{...quote,token:input.quoteToken,expiresAt:payload.expiresAt,
      rateProvider:request.pricing?.rateProvider??request.pricing?.providerKey??"Manual",
      rateUpdatedAt:request.pricing?.rateUpdatedAt,quoteKind:request.pricing?.quoteKind??"manual"},
      paymentInstructions:paymentInstructionsSnapshot(s,request),...fundingWalletSnapshot(s,request)};
  });
}
function serializeOrder(row: OrderRow,internal=false): ExchangeOrder {
  const r = row.request;
  return { id: row.id, status: row.status, action: r.action, source: r.source, destination: r.destination,
    sourceSymbol: r.sourceSymbol, destinationSymbol: r.destinationSymbol, inputAmount: r.inputAmount,
    outputAmount: r.outputAmount, rate: r.rate, fee: r.fee, destinationFee: r.destinationFee ?? "0", spreadBps: r.spreadBps,
    paymentMethod: r.paymentMethod, paymentMethodId: r.paymentMethodId ?? null, paymentInstructions: r.paymentInstructions ?? null, createdAt: row.created_at,
    updatedAt: new Date(r.history.at(-1)?.at ?? row.created_at), customerName: r.customerName ?? null, customerEmail: r.customerEmail ?? null,
    history: (internal?r.history:publicHistory(r.history)).map(h => ({ ...h, at: new Date(h.at) })), sandboxOnly: true, pricingSource: r.pricingSource ?? "manual",
    pricingRuleId: r.pricingRuleId ?? null,pricingRuleSnapshot:r.pricingRuleSnapshot,
    marketRate:r.marketRate,rateProvider:r.rateProvider,rateUpdatedAt:r.rateUpdatedAt?new Date(r.rateUpdatedAt):undefined,quoteKind:r.quoteKind,calculation:r.calculation,
    customerDetails:r.customerDetails,paymentVerification:r.paymentVerification??"unverified",
    depositReference:r.depositReference,transactionHash:r.transactionHash,payoutReference:r.payoutReference,
    completedAt:r.completedAt?new Date(r.completedAt):undefined,
    paymentAddress:r.paymentAddress,paymentMemo:r.paymentMemo,
    ...(internal?{assigneeId:r.assigneeId,internalNotes:r.internalNotes?.map(h=>({...h,at:new Date(h.at)}))}:{}) };
}
async function orderRow(client: DatabaseClient, tenantId: string, id: string, lock = false) {
  const r = await client.query<OrderRow>(`SELECT id,status,request,created_at FROM exchange_orders WHERE tenant_id=$1 AND id=$2 AND request->>'product'='crypto_exchange'${lock ? " FOR UPDATE" : ""}`, [tenantId, id]);
  if (!r.rowCount) throw new HttpError(404, "Sandbox order not found.");
  return r.rows[0];
}
export async function sandboxOrder(slug: string, input: ExchangeOrderInput, channel?: "telegram") {
  const contact = orderContact(input);
  const tenantId = await publicTenantId(slug);
  return withDatabase({ actorId: "sandbox-visitor", tenantId, canWrite: true }, async client => {
    await lockTenant(client, tenantId);
    const e = await operationalExchange(client, tenantId);
    const old = await client.query<OrderRow>("SELECT id,status,request,created_at FROM exchange_orders WHERE tenant_id=$1 AND request->>'product'='crypto_exchange' AND request->>'idempotencyHash'=$2", [tenantId, hash(input.idempotencyKey)]);
    if (old.rowCount) {
      if (channel) await assertTelegramTransaction(client, tenantId, old.rows[0].request.action);
      if (old.rows[0].request.quoteHash !== hash(input.quoteToken)) throw new HttpError(409, "This idempotency key belongs to another request.");
      if ((old.rows[0].request.customerEmail ?? null) !== (contact.customerEmail ?? null) ||
          (old.rows[0].request.customerName ?? null) !== (contact.customerName ?? null) ||
           customerDetailsKey(old.rows[0].request.customerDetails)!==customerDetailsKey(input.customerDetails))
        throw new HttpError(409, "This submission key belongs to another contact selection.");
      return { order: serializeOrder(old.rows[0]), trackingToken: sign(`track:${tenantId}:${old.rows[0].id}`) };
    }
    const { configuration: s, catalog } = await readExchange(client, tenantId);
    const request = verify(input.quoteToken, tenantId, s, e.plan!.currency);
    const customerDetails=validatedCustomerDetails(input,request,s,catalog);
    if (!validActionPair(request.action,request.source,request.destination))
      throw new HttpError(400,"This quote is for a retired or incompatible offering; request a new Swap or Convert quote.");
    await assertPricingSnapshot(client, tenantId, request.pricing, request.action, e);
    if (channel) await assertTelegramTransaction(client, tenantId, request.action);
    guard(e, request.action);
    const { quote, volume, paymentMethod } = calculateQuote(applyPricing(s, request.pricing), catalog, request);
    await consumeMonthlyUsage(client, tenantId, "crypto_exchange", volume);
    const id = randomUUID();
    const stored: StoredRequest = { ...quote, ...contact,customerDetails,workflowVersion:2,paymentVerification:"unverified",
      rateProvider:request.pricing?.rateProvider??request.pricing?.providerKey??"Manual",
      rateUpdatedAt:request.pricing?.rateUpdatedAt,quoteKind:request.pricing?.quoteKind??"manual",
      product: "crypto_exchange", paymentMethod, paymentMethodId: request.paymentMethodId ?? null, volume,
      paymentInstructions: paymentInstructionsSnapshot(s, request),...fundingWalletSnapshot(s,request),
      pricingSource: request.pricing ? (request.pricing.manualFallback ? `${request.pricing.providerKey}:manual_fallback` : request.pricing.providerKey) : "manual",
      quoteHash: hash(input.quoteToken), idempotencyHash: hash(input.idempotencyKey),
      history: [{ status: "pending", at: new Date().toISOString(), note: "Sandbox order created. No funds, wallets, deposit addresses or payments exist." }] };
    const result = await client.query<OrderRow>("INSERT INTO exchange_orders (id,tenant_id,pricing_rule_id,status,request) VALUES ($1,$2,$3,'pending',$4) RETURNING id,status,request,created_at", [id, tenantId, quote.routeId, JSON.stringify(stored)]);
    await audit(client, { userId: "sandbox-visitor", role: "unassigned", memberships: [] }, tenantId, "exchange.order.created", "Created a simulated exchange order", { orderId: id, action: request.action });
    return { order: serializeOrder(result.rows[0]), trackingToken: sign(`track:${tenantId}:${id}`) };
  });
}
export async function trackOrder(slug: string, id: string, token: string) {
  const tenantId = await publicTenantId(slug);
  if (!equal(token, sign(`track:${tenantId}:${id}`))) throw new HttpError(404, "Sandbox order not found.");
  return withDatabase({ actorId: "sandbox-visitor", tenantId }, async client => {
    // Pausing trading does not erase access to existing order tracking.
    guard(await resolveEntitlements(client, tenantId));
    return serializeOrder(await orderRow(client, tenantId, id));
  });
}
export function tenantOrder(principal: Principal, tenantId: string, id: string, input?: ExchangeStatusInput) {
  return withDatabase(contextFor(principal, tenantId, !!input, "configuration.manage"), async client => {
    if (input) {
      // A suspended customer's website/new orders/Admin are blocked. Super Admin
      // may still reconcile existing Sandbox orders without restoring access.
      if (principal.role === "super_admin") {
        const tenant = await client.query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE", [tenantId]);
        if (!tenant.rowCount) throw new HttpError(404, "Tenant not found.");
      } else {
        await lockTenant(client, tenantId);
        requireFeature(await resolveEntitlements(client, tenantId), "crypto_exchange");
      }
    }
    const row = await orderRow(client, tenantId, id, !!input);
    if (input) {
      if (input.expectedStatus !== undefined && input.expectedStatus !== row.status) throw new HttpError(409, "This order changed after review. Refresh its details and review again.");
      const operation=input.operation??"status";
      if(operation!=="status"){
        if(!input.note.trim())throw new HttpError(400,"An internal audit note is required.");
        row.request.internalNotes??=[];
        row.request.internalNotes.push({status:operation,at:new Date().toISOString(),note:input.note});
        if(operation==="assign"){
          const assigned=await client.query("SELECT 1 FROM tenant_memberships WHERE tenant_id=$1 AND clerk_user_id=$2 UNION ALL SELECT 1 FROM platform_admins WHERE clerk_user_id=$2",[tenantId,input.assigneeId??""]);
          if(!assigned.rowCount)throw new HttpError(400,"Assign an authorized operator belonging to this tenant.");
          row.request.assigneeId=input.assigneeId;
        }else if(operation==="review_payment"||operation==="verify_deposit"){
          if(!["pending","processing"].includes(row.status))throw new HttpError(409,"Payment review is unavailable on a terminal order.");
          if(operation==="verify_deposit"&&!(input.depositReference?.trim()||input.transactionHash?.trim()))throw new HttpError(400,"A Sandbox deposit reference or transaction hash is required.");
          if(operation==="verify_deposit"&&!/sandbox/i.test(input.note))throw new HttpError(400,"An explicit Sandbox acknowledgement is required; this does not verify real funds.");
          row.request.paymentVerification=operation==="verify_deposit"?"verified":"review";
          if(input.depositReference)row.request.depositReference=input.depositReference;
          if(input.transactionHash)row.request.transactionHash=input.transactionHash;
        }
        await client.query("UPDATE exchange_orders SET request=$3 WHERE tenant_id=$1 AND id=$2",[tenantId,id,JSON.stringify(row.request)]);
        await audit(client,principal,tenantId,`exchange.order.${operation}`,"Recorded authorized Sandbox operator action",{orderId:id});
        return serializeOrder(row,true);
      }
      const next: Record<string, string[]> = { pending: ["processing", "cancelled", "failed"], processing: ["completed", "cancelled", "failed"], completed: [], cancelled: [], failed: [] };
      if (!(next[row.status] ?? []).includes(input.status)) throw new HttpError(409, "This sandbox status transition is not allowed. Terminal orders cannot be reopened.");
      if(row.request.workflowVersion===2&&input.status==="processing"&&row.request.paymentVerification!=="verified")
        throw new HttpError(409,"Review and verify the Sandbox deposit before processing.");
      if(input.status==="completed"&&row.request.workflowVersion===2&&(!input.confirmCompletion||!input.payoutReference?.trim()))
        throw new HttpError(400,"Explicit Sandbox payout confirmation and reference are required.");
      if(input.status==="completed"){row.request.completedAt=new Date().toISOString();if(input.payoutReference)row.request.payoutReference=input.payoutReference;}
      row.request.internalNotes??=[];
      if(input.note)row.request.internalNotes.push({status:input.status,at:new Date().toISOString(),note:input.note});
      row.request.history.push({ status: input.status, at: new Date().toISOString(), note: "Status updated by authorized operator (Sandbox)." });
      await client.query("UPDATE exchange_orders SET status=$3,request=$4 WHERE tenant_id=$1 AND id=$2", [tenantId, id, input.status, JSON.stringify(row.request)]);
      await audit(client, principal, tenantId, "exchange.order.status_changed", "Changed simulated exchange order status", { orderId: id, from: row.status, to: input.status });
      if (input.note.startsWith("Bulk:")) await audit(client, principal, tenantId, "exchange.orders.bulk_item", "Applied bulk workflow to a simulated order", { orderId: id, from: row.status, to: input.status });
      row.status = input.status;
    }
    return serializeOrder(row,true);
  });
}
export function tenantOrders(principal: Principal, tenantId: string, query: { search?: string; status?: string; action?: string; view?: "active" | "archived"; page?: number; from?: string; to?: string; customer?: string }) {
  return withDatabase(contextFor(principal, tenantId), async client => {
    for (const date of [query.from, query.to]) if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new HttpError(400, "Use valid calendar dates in YYYY-MM-DD format.");
    if (query.from && query.to && query.from > query.to) throw new HttpError(400, "Start date must not be after end date.");
    if (query.customer && query.customer !== "anonymous" && !/^[a-f0-9]{64}$/.test(query.customer)) throw new HttpError(400, "Invalid customer filter.");
    const page = query.page ?? 1, pageSize = 25;
    const filter = "tenant_id=$1 AND request->>'product'='crypto_exchange' AND ($2='' OR status=$2) AND ($3='' OR request->>'action'=$3) AND ($4='' OR id::text ILIKE '%'||$4||'%' OR request->>'sourceSymbol' ILIKE '%'||$4||'%' OR request->>'destinationSymbol' ILIKE '%'||$4||'%') AND ($5::timestamptz IS NULL OR created_at >= $5::timestamptz) AND ($6::timestamptz IS NULL OR created_at < $6::timestamptz + interval '1 day') AND ($7::text[] IS NULL OR status=ANY($7::text[]))";
    const args = [tenantId, query.status ?? "", query.action ?? "", query.search ?? "", query.from ? `${query.from}T00:00:00Z` : null, query.to ? `${query.to}T00:00:00Z` : null, statusesForOrderView(query.view), query.customer ?? ""];
    const filtered = `${filter} AND ($8='' OR COALESCE(request->>'customerId','anonymous')=$8)`;
    const count = await client.query(`SELECT count(*)::int AS total FROM exchange_orders WHERE ${filtered}`, args);
    const rows = await client.query<OrderRow>(`SELECT id,status,request,created_at FROM exchange_orders WHERE ${filtered} ORDER BY created_at DESC,id DESC LIMIT $9 OFFSET $10`, [...args, pageSize, (page - 1) * pageSize]);
    return { orders: rows.rows.map(r=>serializeOrder(r,true)), total: count.rows[0].total as number, page, pageSize };
  });
}
export function exchangeDashboard(principal: Principal, tenantId: string) {
  return withDatabase(contextFor(principal, tenantId), async client => {
    const e = await resolveEntitlements(client, tenantId);
    const { configuration: s, catalog } = await readExchange(client, tenantId);
    const stats = await client.query("SELECT status,count(*)::int AS count FROM exchange_orders WHERE tenant_id=$1 AND request->>'product'='crypto_exchange' GROUP BY status", [tenantId]);
    const counts: Record<string, number> = Object.fromEntries(stats.rows.map(r => [r.status, r.count]));
    // Never sum different crypto units or claim simulated volume as real money.
    const volume = await client.query("SELECT request->>'sourceSymbol' AS symbol,sum((request->>'inputAmount')::numeric)::text AS amount FROM exchange_orders WHERE tenant_id=$1 AND request->>'product'='crypto_exchange' AND status NOT IN ('cancelled','failed') GROUP BY request->>'sourceSymbol'", [tenantId]);
    const recent = await client.query<OrderRow>("SELECT id,status,request,created_at FROM exchange_orders WHERE tenant_id=$1 AND request->>'product'='crypto_exchange' ORDER BY created_at DESC,id DESC LIMIT 8", [tenantId]);
    const enabledNetworks = s.networks.filter(n => n.enabled && n.available && catalog.some(c => c.assetNetworkId === n.assetNetworkId && s.assets.some(a => a.assetId === c.assetId && a.enabled)));
    const legacy = await client.query("SELECT exchange_enabled FROM tenant_configuration WHERE tenant_id=$1", [tenantId]);
    return { enabled: s.enabled && legacy.rows[0]?.exchange_enabled === true && e.features.crypto_exchange === true && e.features.website === true && e.tenantStatus === "active" && e.status === "active" && !e.overLimit, total: Object.values(counts).reduce((a, b) => a + b, 0),
      pending: counts.pending ?? 0, processing: counts.processing ?? 0, completed: counts.completed ?? 0, cancelled: counts.cancelled ?? 0, failed: counts.failed ?? 0,
      assets: s.assets.filter(a => a.enabled && catalog.some(c => c.assetId === a.assetId)).length,
      networks: new Set(enabledNetworks.map(n => catalog.find(c => c.assetNetworkId === n.assetNetworkId)!.networkId)).size,
      customers: (await customerList(client, tenantId)).filter(c => c.status !== "unidentified").length, paymentMethods: s.paymentMethods.filter(m => m.enabled && (m.buy || m.sell)).length,
      routes: s.routes.filter(r => r.enabled).length, volume: volume.rows, recentOrders: recent.rows.map(r=>serializeOrder(r,true)) };
  });
}
export function exchangeCustomers(principal: Principal, tenantId: string) {
  return withDatabase(contextFor(principal, tenantId), async client => {
    return customerList(client, tenantId);
  });
}
export function exchangeAudit(principal: Principal, tenantId: string, page = 1) {
  return withDatabase(contextFor(principal, tenantId), async client => {
    const total = await client.query("SELECT count(*)::int AS n FROM audit_events WHERE tenant_id=$1", [tenantId]);
    const result = await client.query(
      `SELECT id,tenant_id AS "tenantId",event_type AS "eventType",description,actor_id AS "actorId",created_at AS "createdAt"
       FROM audit_events WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET $2`, [tenantId, (page - 1) * 50]);
    return { events: result.rows, total: total.rows[0].n as number, page, pageSize: 50 };
  });
}