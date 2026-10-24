import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pool, withDatabase } from "@workspace/db";
import { resolvePrincipal } from "../modules/authentication/service";
import { myAdminPanels, listRequests, submitRequest, reviewRequest, deliverRequest, assertDeliveredExchangeAccess, orderDetail, appendNote } from "../modules/customer/service";
import { whiteLabelCatalog } from "../modules/customer/order-catalog";
import { activateTenant, createTenant, getTenant, saveBrand, saveDomain, saveAssets, saveConfiguration, saveWebsiteSettings } from "../modules/tenants/service";
import { GetTenantResponse } from "@workspace/api-zod";
import { getPublicSite } from "../modules/website/service";
import { emptyPreviewSettings, previewIntegrations } from "../products/exchange/preview-integrations";
import { exchangeConfiguration, publicExchange, sandboxQuote, sandboxOrder, tenantOrder, trackOrder, exchangeCustomers, tenantOrders } from "../products/exchange/service";
import { customerIdForEmail, updateCustomer, notifications } from "../products/exchange/customer-management";
import { sandboxInvoice } from "../products/exchange/invoice";
import { getDomainVerification, verifyTenantDomain, resolvePublicDomain } from "../modules/domains/service";
import { integrationBundle, saveIntegration } from "../modules/integrations/service";
import { setTenantOverrides } from "../modules/entitlements/subscriptions";
import { resolveEntitlements } from "../modules/entitlements/resolver";
import { saveMethod, checkout, reportPayment, settle } from "../modules/commerce/service";
import { prepareCustomerFixtures, finishCustomerTenant, cleanCustomerFixtures } from "./customer-fixtures";
if (process.env.NODE_ENV === "production") throw new Error("Development verification refused in production.");
const suffix = randomUUID().slice(0, 8);
const actors = [`user_workflowOperator${suffix}`, `user_workflowCustomer${suffix}`, `user_workflowOther${suffix}`];
const browserQa = process.env.QXLAYER_CUSTOMER_BROWSER_QA === "true";
const manifestPath = "../../.local/customer-delivery-qa-scope.json";
if (browserQa) {
  const native = JSON.parse(await readFile("../../.local/development-auth-qa-scope.json", "utf8"));
  if (!native.subject || !native.email.endsWith("@example.test")) throw Error("Disposable native QA subject is required.");
  actors[1] = `supabase:${native.subject}`;
}
let fixture: Awaited<ReturnType<typeof prepareCustomerFixtures>> | undefined;
let draftId: string | undefined;
let methodId: string | undefined;
const autoTenantIds: string[] = [];
const denied = (fn: () => Promise<unknown>, status: number | string) => assert.rejects(async () => fn(), (e: any) => e.status === status || e.code === status);
try {
  await pool.query("INSERT INTO platform_admins (clerk_user_id) VALUES ($1)", [actors[0]]);
  const op = await resolvePrincipal(actors[0]), a = await resolvePrincipal(actors[1]), b = await resolvePrincipal(actors[2]);
  assert.equal(a.role, "unassigned");
  assert.deepEqual(await myAdminPanels(a), []);
  const input = { projectName: "Meridian Exchange QA", brandName: "Meridian Exchange", preferredDomain: "meridian.example.test", actions: ["swap", "convert", "buy", "sell"] as ("swap" | "convert" | "buy" | "sell")[], details: "Sandbox only", idempotencyKey: randomUUID() };
  const submitted = await submitRequest(a, input);
  assert.match(submitted.orderReference, /^WL-\d{6,}$/);
  assert.equal(submitted.status, "new");
  assert.equal((await submitRequest(a, input)).id, submitted.id);
  assert.equal((await listRequests(a)).length, 1);
  assert.equal((await listRequests(b)).length, 0);
  await denied(() => listRequests(a, true), 403);
  const price = { status: "approved" as const, monthlyPrice: "149", setupPrice: "299", currency: "EUR" as const, operatorNote: "Sandbox preparation" };
  await denied(() => reviewRequest(a, submitted.id, price), 403);
  await denied(() => orderDetail(b, submitted.id), 404);
  await denied(() => appendNote(a, submitted.id, { message: "Escalation", visibility: "internal" }), 403);
  await appendNote(op, submitted.id, { message: "PRIVATE WORKFLOW VERIFICATION", visibility: "internal" });
  await appendNote(op, submitted.id, { message: "We are reviewing your project.", visibility: "customer" });
  assert.ok((await orderDetail(op, submitted.id, true)).history.some(n => n.visibility === "internal"));
  assert.ok(!(await orderDetail(a, submitted.id)).history.some(n => n.visibility === "internal" || n.message.includes("PRIVATE WORKFLOW")));
  await denied(() => reviewRequest(op, submitted.id, { ...price, status: "ready" }), 409);
   assert.equal((await orderDetail(a, submitted.id)).order.status, "new");
   assert.equal((await orderDetail(a, submitted.id)).order.monthlyPrice, null);
   await denied(() => orderDetail(a, submitted.id, true), 403);
  fixture = await prepareCustomerFixtures(op, suffix);
  assert.ok(!(await whiteLabelCatalog(a)).plans.some(p => p.id === fixture!.planId), "Private QA plan must never be published.");
  methodId = (await saveMethod(op, undefined, { name: `QA only ${suffix}`, kind: "manual", currency: "EUR",
    instructions: "Synthetic Development fixture only. Do not transfer money.", enabled: true, approved: true })).id;
  const paidReview = async (customer: typeof a, requestId: string, customizationPrice?: string) => {
    const quote = { ...price, status: "quote_ready" as const, approvedPlanId: fixture!.planId, approvedAddonIds: [],
      ...(customizationPrice ? { customizationPrice, customDesignDecision: "approved" as const } : {}) };
    await reviewRequest(op, requestId, quote);
    const billing = await checkout(customer, requestId, methodId!);
    await reportPayment(customer, requestId, `QA-${randomUUID()}`);
    await settle(op, billing.invoice.id, { receivedAmount: billing.invoice.amount, currency: "EUR",
      reference: `QA-${randomUUID()}`, evidence: "Synthetic Development fixture. No real payment received or represented." });
    return reviewRequest(op, requestId, { ...quote, status: "approved" });
  };
  const markReady = (requestId: string, customizationPrice?: string) => reviewRequest(op, requestId, { ...price, status: "ready",
    ...(customizationPrice ? { customizationPrice, customDesignDecision: "approved" as const } : {}) });
  const custom = await submitRequest(a, { ...input, companyName: "Verification Company", requestedAddonIds: [], billingPeriod: "yearly", attachmentIds: [],
    details: "Requirements ".repeat(200), idempotencyKey: randomUUID() });
  // Seed only this disposable request's custom-design fixture. Do not publish the
  // isolated QA plan or change the public catalog to enable a service-level test.
  await pool.query("UPDATE white_label_requests SET configuration=jsonb_set(configuration,'{design}',$2::jsonb) WHERE id=$1 AND customer_user_id=$3",
    [custom.id, JSON.stringify({ type: "custom", styleName: "Custom verification", primaryColor: "#112233", accentColor: "#abcdef",
      themePreference: "both", description: "Operator-reviewed paid customization", referenceWebsiteUrl: "https://example.com",
      notes: "No automated implementation", logoAttachmentId: null, faviconAttachmentId: null, referenceAttachmentIds: [] }), a.userId]);
  assert.equal(custom.companyName, "Verification Company");
  assert.equal(custom.billingPeriod, "yearly");
   assert.equal(custom.requestedPlan, null);
  await denied(() => reviewRequest(op, custom.id, price), 409);
  const preparedCustom = await paidReview(a, custom.id, "500");
    assert.equal(preparedCustom.status, "in_setup");
  assert.ok(preparedCustom.tenantId);
  autoTenantIds.push(preparedCustom.tenantId!);
  assert.deepEqual(await myAdminPanels(a), []);
    await denied(() => reviewRequest(op, custom.id, { ...price, monthlyPrice: "175", customizationPrice: "600", customDesignDecision: "approved", status: "in_setup" }), 409);
  const customDetail = await orderDetail(a, custom.id);
   assert.equal(customDetail.order.monthlyPrice, "149");
   assert.equal(customDetail.order.customizationPrice, "500");
    assert.ok(customDetail.history.some(h => h.status === "in_setup"));
  const [first] = fixture.tenants;
  const draft = await createTenant(op, { name: "Not delivered", slug: `workflow-draft-${suffix}`, planId: fixture.planId }); draftId = draft.id;
  await pool.query("INSERT INTO tenant_memberships (tenant_id,clerk_user_id,role) VALUES ($1,$2,'client_admin')", [draft.id, a.userId]);
  const withDraft = await resolvePrincipal(a.userId);
   assert.ok(!(await myAdminPanels(withDraft)).some(panel => panel.tenantId === draft.id));
  await denied(() => assertDeliveredExchangeAccess(withDraft, draft.id), 403);
  await denied(() => activateTenant(withDraft, draft.id), 403);
  await saveBrand(op, draft.id, { brandName: draft.brandName, logoUrl: null, primaryColor: "#102C36", accentColor: "#44D7C4", themeMode: "system", defaultLanguage: "en", supportedLanguages: ["en"] });
  await saveDomain(op, draft.id, null);
  await saveAssets(op, draft.id, fixture.base.networks.map(network => network.assetNetworkId));
  await saveConfiguration(op, draft.id, { environment: "sandbox", exchangeEnabled: false, paymentsEnabled: false, allowGuestCheckout: false });
  await previewIntegrations(op, draft.id, { settings: emptyPreviewSettings() });
  const previewOnly = await activateTenant(op, draft.id);
  assert.equal(previewOnly.status, "active", "Inert optional settings must not block an unrelated visual preview.");
  assert.equal(previewOnly.exchangeProvisioned, false, "A metadata row must never mark an operational Exchange provisioned.");
  await denied(() => assertDeliveredExchangeAccess(withDraft, draft.id), 403);
   assert.ok(!(await myAdminPanels(withDraft)).some(panel => panel.tenantId === draft.id));
  await denied(() => deliverRequest(a, submitted.id, first.id), 403);
  await denied(() => deliverRequest(op, submitted.id, first.id), 409);
  await denied(() => reviewRequest(op, submitted.id, price), 409);
  const prepared = await paidReview(a, submitted.id);
    assert.equal(prepared.status, "in_setup");
  assert.ok(prepared.tenantId);
  autoTenantIds.push(prepared.tenantId!);
  assert.equal((await myAdminPanels(a)).length, 0);
  assert.deepEqual((await previewIntegrations(op, prepared.tenantId!)).settings, emptyPreviewSettings());
  await previewIntegrations(op, prepared.tenantId!, { settings: emptyPreviewSettings() });
  assert.equal((await getTenant(op, prepared.tenantId!)).configurationComplete, false, "Preview settings never count as operational provisioning.");
  // Reproduce the reported case: every legacy step is complete, but no Exchange was saved.
  await saveBrand(op, prepared.tenantId!, { brandName: prepared.brandName, logoUrl: null, primaryColor: "#102C36", accentColor: "#44D7C4", themeMode: "system", defaultLanguage: "en", supportedLanguages: ["en"] });
  await saveDomain(op, prepared.tenantId!, null);
  await saveAssets(op, prepared.tenantId!, fixture.base.networks.map(network => network.assetNetworkId));
  await saveConfiguration(op, prepared.tenantId!, { environment: "sandbox", exchangeEnabled: true, paymentsEnabled: false, allowGuestCheckout: false });
  const blocked = GetTenantResponse.parse(await getTenant(op, prepared.tenantId!));
  assert.equal(blocked.configurationComplete, false, "Legacy completed steps must not falsely report an Exchange Ready.");
  assert.equal(blocked.provisioningStep, "configuration");
  assert.ok(blocked.activationBlockers?.some(message => message.includes("Save the Exchange setup")));
  await denied(() => activateTenant(op, prepared.tenantId!), 400);
    assert.equal((await getTenant(op, prepared.tenantId!)).status, "draft");
    assert.equal((await orderDetail(a, submitted.id)).order.status, "in_setup");
    assert.ok(!(await myAdminPanels(await resolvePrincipal(a.userId))).some(panel => panel.tenantId === prepared.tenantId), "Approval must not grant access to an unfinished website.");
  await denied(() => deliverRequest(op, submitted.id, draft.id), 409);
  await denied(() => deliverRequest(op, submitted.id, first.id), 409);
  await finishCustomerTenant(op, { id: prepared.tenantId!, name: prepared.brandName }, fixture.base);
  const readyConfiguration = (await exchangeConfiguration(op, prepared.tenantId!)).configuration;
  await exchangeConfiguration(op, prepared.tenantId!, { ...readyConfiguration, routes: readyConfiguration.routes.filter(route => route.action !== "sell") });
  const missingAction = await getTenant(op, prepared.tenantId!);
  assert.equal(missingAction.configurationComplete, false);
  assert.ok(missingAction.activationBlockers.some(message => message.includes("requested sell")));
  await denied(() => activateTenant(op, prepared.tenantId!), 400);
  await exchangeConfiguration(op, prepared.tenantId!, readyConfiguration);
  assert.equal((await getTenant(op, prepared.tenantId!)).configurationComplete, true);
  await activateTenant(op, prepared.tenantId!);
  assert.equal((await orderDetail(a, submitted.id)).order.status, "in_setup", "Activation must never deliver.");
  await denied(() => getPublicSite(`wl-${submitted.id}`), 404);
  await denied(() => deliverRequest(op, submitted.id, prepared.tenantId!), 409);
  await markReady(submitted.id);
  assert.equal((await orderDetail(a, submitted.id)).order.status, "ready", "Ready must never deliver.");
  await denied(() => getPublicSite(`wl-${submitted.id}`), 404);
  await deliverRequest(op, submitted.id, prepared.tenantId!);
  const owner = await resolvePrincipal(a.userId);
    assert.equal((await myAdminPanels(owner)).length, 1);
  await assertDeliveredExchangeAccess(owner, prepared.tenantId!);
  // Durable scope contains only exact disposable IDs, never login/tracking secrets.
  if (browserQa) {
    await mkdir("../../.local", { recursive: true });
    await writeFile(manifestPath, JSON.stringify({ actors, planId: fixture.planId, methodId, tenantIds: [...fixture.tenants.map(t => t.id), ...autoTenantIds, draftId] }));
  }
  await denied(() => assertDeliveredExchangeAccess(b, prepared.tenantId!), 403);
  assert.deepEqual((await previewIntegrations(owner, prepared.tenantId!)).settings, emptyPreviewSettings(), "Optional previews do not prevent explicit Sandbox delivery.");
  const privatePreview = {
    api: { enabled: true, label: "Private API preview", baseUrl: "https://api.preview.example" },
    webhooks: { enabled: true, label: "Private webhook preview", endpointUrl: "https://hooks.preview.example/events", events: ["order.created", "order.status_changed"] },
    rpc: { enabled: true, label: "Private RPC preview", endpointUrl: "https://rpc.preview.example", networkName: "Sandbox network" },
  };
  const entitlementBefore = await withDatabase({ actorId: op.userId, tenantId: prepared.tenantId!, isSuperAdmin: true }, c => resolveEntitlements(c, prepared.tenantId!));
  assert.equal(entitlementBefore.features.webhooks, false);
  assert.deepEqual((await previewIntegrations(owner, prepared.tenantId!, { settings: privatePreview })).settings, privatePreview);
  const apiOnly = { ...emptyPreviewSettings(), api: { ...privatePreview.api, label: "Updated API preview" } };
  const merged = await previewIntegrations(owner, prepared.tenantId!, { settings: apiOnly, modules: ["api"] });
  privatePreview.api.label = "Updated API preview";
  assert.deepEqual(merged.settings, privatePreview, "Saving one module must not overwrite settings from other tabs or sessions.");
  await denied(() => previewIntegrations(b, prepared.tenantId!), 403);
  await denied(() => previewIntegrations(b, prepared.tenantId!, { settings: privatePreview }), 403);
  await denied(() => previewIntegrations(owner, prepared.tenantId!, { settings: { ...privatePreview, api: { ...privatePreview.api, secret: "DO_NOT_STORE" } } }), 400);
  await denied(() => previewIntegrations(owner, prepared.tenantId!, { settings: { ...privatePreview, api: { ...privatePreview.api, baseUrl: "https://api.preview.example?token=DO_NOT_STORE" } } }), 400);
  await denied(() => previewIntegrations(owner, prepared.tenantId!, { settings: { ...privatePreview, rpc: { ...privatePreview.rpc, networkName: "" } } }), 400);
  const entitlementAfter = await withDatabase({ actorId: op.userId, tenantId: prepared.tenantId!, isSuperAdmin: true }, c => resolveEntitlements(c, prepared.tenantId!));
  assert.deepEqual(entitlementAfter.features, entitlementBefore.features, "Preview switches never grant live module entitlements.");
  const publicBefore = await publicExchange(`wl-${submitted.id}`);
  assert.ok(!JSON.stringify(publicBefore).includes("preview.example"), "Private preview URLs never reach public Exchange responses.");
  const operational = (await exchangeConfiguration(owner, prepared.tenantId!)).configuration;
  await exchangeConfiguration(owner, prepared.tenantId!, operational);
  assert.deepEqual((await previewIntegrations(owner, prepared.tenantId!)).settings, privatePreview, "Operational saves preserve independently edited preview settings.");
  assert.deepEqual(await publicExchange(`wl-${submitted.id}`), publicBefore, "Optional settings never alter public sandbox behavior.");
  await previewIntegrations(owner, prepared.tenantId!, { settings: emptyPreviewSettings() });
  assert.deepEqual((await previewIntegrations(owner, prepared.tenantId!)).settings, emptyPreviewSettings());
  assert.equal((await listRequests(a)).find(r => r.id === submitted.id)?.status, "delivered");
  await finishCustomerTenant(op, { id: preparedCustom.tenantId!, name: preparedCustom.brandName }, fixture.base);
   await pool.query("INSERT INTO tenant_memberships (tenant_id,clerk_user_id,role) VALUES ($1,$2,'client_admin') ON CONFLICT(tenant_id,clerk_user_id) DO NOTHING", [preparedCustom.tenantId, a.userId]);
  await activateTenant(op, preparedCustom.tenantId!);
   assert.equal((await orderDetail(a, custom.id)).order.status, "in_setup");
   await markReady(custom.id, "500");
   await deliverRequest(op, custom.id, preparedCustom.tenantId!);
   assert.equal((await orderDetail(a, custom.id)).order.status, "delivered");
   assert.equal((await myAdminPanels(await resolvePrincipal(a.userId))).length, 2);
   assert.equal((await getPublicSite(`wl-${custom.id}`)).tenantSlug, `wl-${custom.id}`);
   await denied(() => reviewRequest(op, custom.id, { ...price, monthlyPrice: "175", customizationPrice: "600", customDesignDecision: "approved", status: "ready" }), 409);
  assert.equal((await orderDetail(a, custom.id)).order.status, "delivered");
  assert.equal((await getPublicSite(`wl-${custom.id}`)).tenantSlug, `wl-${custom.id}`);
  const foreign = await submitRequest(b, { ...input, projectName: "Other customer", idempotencyKey: randomUUID() });
  const foreignPrepared = await paidReview(b, foreign.id);
  autoTenantIds.push(foreignPrepared.tenantId!);
  await denied(() => deliverRequest(op, foreign.id, first.id), 409);
  const additional = await submitRequest(owner, { ...input, projectName: "My Exchange B", idempotencyKey: randomUUID() });
  const extraPrepared = await paidReview(owner, additional.id);
  autoTenantIds.push(extraPrepared.tenantId!);
  await finishCustomerTenant(op, { id: extraPrepared.tenantId!, name: extraPrepared.brandName }, fixture.base);
  await activateTenant(op, extraPrepared.tenantId!);
  await markReady(additional.id);
  await deliverRequest(op, additional.id, extraPrepared.tenantId!);
  assert.equal((await myAdminPanels(await resolvePrincipal(a.userId))).length, 3);
  assert.equal((await myAdminPanels(await resolvePrincipal(b.userId))).length, 0);
  const tenantId = prepared.tenantId!, slug = `wl-${submitted.id}`;
  const tenant = await getTenant(owner, tenantId);
  await saveWebsiteSettings(owner, tenantId, { ...tenant.websiteSettings, reviewLinks: [{ label: "Meridian review", url: "https://example.com/meridian-review" }] });
  assert.equal((await getPublicSite(slug)).websiteSettings?.reviewLinks?.[0].label, "Meridian review");
  await saveDomain(owner, tenantId, `meridian-${suffix}.example`);
  const challenge = await getDomainVerification(owner, tenantId);
  await denied(() => verifyTenantDomain(owner, tenantId, async () => [["not-the-challenge"]]), 400);
  const domain = await verifyTenantDomain(owner, tenantId, async () => [[challenge.txtValue!]]);
  assert.equal(domain.status, "verified");
  assert.equal(domain.hostingConnected, false, "Synthetic DNS proof never establishes real hosting.");
  assert.equal((await resolvePublicDomain(challenge.domain!)).tenantSlug, slug, "Verified hostname maps only to its delivered tenant; DNS/HTTPS is independently unconnected.");
  await denied(() => getTenant(b, tenantId), 403);
  // Raw SQL bypasses the service-level fence: the restricted DB role must still
  // hide foreign rows and deny cross-tenant writes.
  await withDatabase({ actorId: owner.userId, tenantId, canWrite: true }, async c => {
    const role = (await c.query("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
    assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false);
    assert.equal((await c.query("SELECT id FROM tenants WHERE id=$1", [first.id])).rowCount, 0);
    assert.equal((await c.query("SELECT tenant_id FROM tenant_branding WHERE tenant_id=$1", [first.id])).rowCount, 0);
    assert.equal((await c.query("UPDATE tenant_branding SET brand_name='DENIED' WHERE tenant_id=$1", [first.id])).rowCount, 0);
  });
  await denied(() => saveIntegration(owner, tenantId, "quickex", { enabled: false, settings: {}, reason: "QA denial" }), 403);
  await setTenantOverrides(op, tenantId, [{ key: "quickex", value: true, reason: "Isolated QA" },
    { key: "quickex_customer_credentials", value: true, reason: "Isolated QA" }]);
  await saveIntegration(op, tenantId, "quickex", { enabled: false, credentialManagement: "customer", settings: {}, reason: "QA metadata only" });
  await saveIntegration(owner, tenantId, "quickex", { enabled: false, settings: {}, reason: "Customer metadata save" });
  assert.equal((await integrationBundle(owner, tenantId)).connections.find(c => c.providerKey === "quickex")?.canManageCredentials, true);
  await denied(() => integrationBundle(b, tenantId), 403);
  await denied(() => saveIntegration(owner, tenantId, "rpc", { enabled: false, settings: {}, reason: "Forbidden infrastructure" }), 403);
  const operationalSettings = (await exchangeConfiguration(owner, tenantId)).configuration;
  const walletAsset = (await exchangeConfiguration(owner, tenantId)).catalog.find(c => c.symbol === "ETH");
  if (walletAsset) {
    operationalSettings.wallets = [{ id: randomUUID(), purpose: "customer", label: "Meridian public address", assetNetworkId: walletAsset.assetNetworkId,
      address: "0x0000000000000000000000000000000000000001", enabled: false, adapterKind: "evm", kind: "native", providerKey: "rpc" }];
    await exchangeConfiguration(owner, tenantId, operationalSettings);
    assert.equal((await exchangeConfiguration(owner, tenantId)).configuration.wallets?.[0].purpose, "customer");
  }
  const created: { action: string; id: string; token: string }[] = [];
  for (const action of ["swap", "convert", "buy", "sell"] as const) {
    const cfg = (await exchangeConfiguration(owner, tenantId)).configuration;
    const route = cfg.routes.find(r => r.action === action && r.enabled)!;
    const quote = await sandboxQuote(slug, { action, source: route.source, destination: route.destination,
      amount: action === "buy" ? "250" : "0.025",
      ...(route.paymentMethodIds.length ? { paymentMethodId: route.paymentMethodIds[0] } : {}) });
    const idempotencyKey = randomUUID();
    const orderInput = { quoteToken: quote.token, idempotencyKey, customerName: "Fictional Meridian Visitor",
      customerEmail: `meridian-visitor-${suffix}@example.test`, contactConsent: true };
    const placed = await sandboxOrder(slug, orderInput);
    assert.equal((await sandboxOrder(slug, orderInput)).order.id, placed.order.id);
    await denied(() => sandboxOrder(slug, { ...orderInput, customerName: "Different" }), 409);
    await denied(() => trackOrder(first.slug, placed.order.id, placed.trackingToken), 404);
    await denied(() => sandboxInvoice(first.slug, placed.order.id, placed.trackingToken), 404);
    await denied(() => trackOrder(slug, placed.order.id, "not-a-capability"), 404);
    await denied(() => tenantOrder(b, tenantId, placed.order.id), 403);
    await tenantOrder(owner, tenantId, placed.order.id, { status: "processing", expectedStatus: "pending", note: "QA simulated processing" });
    const status = action === "buy" ? "cancelled" : action === "sell" ? "failed" : "completed";
    await tenantOrder(owner, tenantId, placed.order.id, { status, expectedStatus: "processing", note: "QA simulation, no funds" });
    assert.equal((await trackOrder(slug, placed.order.id, placed.trackingToken)).status, status);
    await denied(() => tenantOrder(owner, tenantId, placed.order.id, { status: "pending", expectedStatus: status, note: "Forbidden reset" }), 409);
    if (status === "completed") assert.equal(Buffer.from(await sandboxInvoice(slug, placed.order.id, placed.trackingToken)).subarray(0, 5).toString(), "%PDF-");
    created.push({ action, id: placed.order.id, token: placed.trackingToken });
  }
  const contactId = customerIdForEmail(`meridian-visitor-${suffix}@example.test`);
  assert.equal((await exchangeCustomers(owner, tenantId)).find(c => c.id === contactId)?.orders, 4);
  await updateCustomer(owner, tenantId, contactId, { name: "Meridian QA contact", notes: "Persisted isolated note", archived: true });
  await denied(() => updateCustomer(b, tenantId, contactId, { name: "Foreign", notes: "", archived: false }), 403);
  assert.equal((await tenantOrders(owner, tenantId, { customer: contactId })).total, 4);
  const initialInbox = await notifications(owner, tenantId);
  assert.ok(initialInbox.events.length >= 12);
  await notifications(owner, tenantId, { orderCreated: true, orderStatusChanged: true, markAllRead: true });
  await exchangeConfiguration(owner, tenantId, (await exchangeConfiguration(owner, tenantId)).configuration);
  assert.equal((await exchangeCustomers(owner, tenantId)).find(c => c.id === contactId)?.notes, "Persisted isolated note");
  assert.ok((await notifications(owner, tenantId)).readThrough);
  await denied(() => notifications(b, tenantId), 403);
  assert.ok(!JSON.stringify(await publicExchange(slug)).includes("meridian-visitor"), "Anonymous configuration must never expose contact data.");
  if (browserQa) {
    await writeFile(manifestPath, JSON.stringify({ actors, planId: fixture.planId, methodId, tenantIds: [...fixture.tenants.map(t => t.id), ...autoTenantIds, draftId] }));
    const fixtureData = { tenantId, slug, otherTenantId: first.id, contactId, orders: created };
    console.log("Customer delivery service checks passed. Native browser fixture ready on loopback 9386.");
    await new Promise<void>(resolve => {
      const server = http.createServer((req, res) => {
        res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
        if (req.url === "/fixture") res.end(JSON.stringify(fixtureData));
        else if (req.url === "/finish" && req.method === "POST") { res.end('{"finished":true}'); server.close(() => resolve()); }
        else { res.statusCode = 404; res.end("{}"); }
      });
      server.listen(9386, "127.0.0.1");
    });
  }
  await pool.query("UPDATE tenant_memberships SET active=false WHERE clerk_user_id=$1", [a.userId]);
  assert.deepEqual(await myAdminPanels(await resolvePrincipal(a.userId)), []);
  console.log("PASS: paid review, draft-only approval, missing-config/action rejection, private preview independence, explicit Ready and delivery, same-account access, optional settings privacy/save/off, unchanged entitlements and sandbox behavior, idempotency and revocation.");
} finally {
  if (fixture) await cleanCustomerFixtures([...fixture.tenants.map(t => t.id), ...autoTenantIds, ...(draftId ? [draftId] : [])], fixture.planId, actors);
  else { await pool.query("DELETE FROM white_label_requests WHERE customer_user_id=ANY($1::text[])", [actors]); await pool.query("DELETE FROM platform_admins WHERE clerk_user_id=ANY($1::text[])", [actors]); }
  if (methodId) await pool.query("DELETE FROM qxlayer_commerce.methods WHERE id=$1 AND name=$2", [methodId, `QA only ${suffix}`]);
  await pool.end();
}