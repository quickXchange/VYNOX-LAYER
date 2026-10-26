import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { prepareSecurityFixtures, cleanSecurityFixtures, type SecurityFixture } from "./security-fixtures";
import { resolvePrincipal, type Principal } from "../modules/authentication/service";
import * as tenant from "../modules/tenants/service";
import * as administrators from "../modules/tenants/administrators";
import * as resource from "../modules/entitlements/resources";
import * as catalog from "../modules/entitlements/catalog";
import * as subscription from "../modules/entitlements/subscriptions";
import * as customer from "../modules/customer/service";
import * as exchange from "../products/exchange/service";
import { getSubscription } from "../modules/entitlements/resolver";
import { productConfiguration } from "../modules/product-registry/configuration";
import { getDomainVerification, verifyTenantDomain } from "../modules/domains/service";
import { attachmentFor } from "../modules/customer/order-files";
import { activity } from "../routes/platform";

if (process.env.NODE_ENV === "production") throw new Error("Development-only authorization verification.");
const suffix = randomUUID().replaceAll("-", "");
const actors = [`user_auditA${suffix}`, `user_auditB${suffix}`, `user_auditOp${suffix}`];
let f: SecurityFixture | undefined, checks = 0;
const check = async (name: string, run: () => unknown) => { await run(); checks++; console.log(`PASS ${name}`); };
const denied = async (run: () => unknown, status = 403) =>
  assert.rejects(async () => await run(), (e: any) => e.status === status);

async function fingerprint(tenantId: string) {
  const snapshots = [];
  for (const table of ["tenants", "tenant_branding", "tenant_domains", "tenant_configuration", "tenant_product_configuration",
    "tenant_asset_networks", "tenant_memberships", "tenant_subscriptions", "tenant_addons", "tenant_entitlement_overrides",
    "tenant_usage_counters", "api_keys", "webhook_endpoints", "tenant_payment_methods", "pricing_rules", "exchange_orders", "audit_events"]) {
    const r = await pool.query(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),'')) AS fingerprint FROM ${table} t WHERE ${table === "tenants" ? "id" : "tenant_id"}=$1`, [tenantId]);
    snapshots.push([table, r.rows[0].fingerprint]);
  }
  return snapshots;
}

try {
  f = await prepareSecurityFixtures(actors);
  const [a, b, op] = await Promise.all(actors.map(resolvePrincipal));
  const outsiders = await resolvePrincipal(`user_outside${suffix}`);
  const staff = await resolvePrincipal(f.members[0]);
  const original = await Promise.all(f.data.map(d => fingerprint(d.tenant.id)));
  for (const [i, principal] of [a, b].entries()) {
    const own = f.data[i], foreign = f.data[1 - i], id = foreign.tenant.id, ownId = own.tenant.id;
    const reads: [string, (p: Principal, id: string) => unknown][] = [
      ["tenant", tenant.getTenant], ["subscription/usage/addons", getSubscription], ["domains", getDomainVerification],
      ["exchange-settings/assets/networks/routes/payment-methods", exchange.exchangeConfiguration],
      ["exchange-dashboard", exchange.exchangeDashboard], ["exchange-orders", (p, t) => exchange.tenantOrders(p, t, {})],
      ["exchange-audit", exchange.exchangeAudit], ["product-config", (p, t) => productConfiguration(p, t, "crypto_exchange")],
      ["administrator-list", administrators.listTenantAdministrators],
    ];
    for (const [name, read] of reads) {
      await check(`${i} foreign ${name}`, () => denied(() => read(principal, id)));
      await check(`${i} legitimate ${name}`, () => read(principal, ownId));
      await check(`${i} Super ${name}`, () => read(op, ownId));
      await check(`${i} unassigned ${name}`, () => denied(() => read(outsiders, ownId)));
    }
    const brand = { brandName: own.tenant.brandName, logoUrl: own.tenant.logoUrl, primaryColor: own.tenant.primaryColor,
      accentColor: own.tenant.accentColor, themeMode: own.tenant.themeMode, defaultLanguage: own.tenant.defaultLanguage,
      supportedLanguages: own.tenant.supportedLanguages };
    const writes: [string, () => unknown][] = [
      ["brand", () => tenant.saveBrand(principal, id, brand)],
      ["domain", () => tenant.saveDomain(principal, id, null)],
      ["assets/networks", () => tenant.saveAssets(principal, id, own.config.networks.map((n: any) => n.assetNetworkId))],
      ["configuration", () => tenant.saveConfiguration(principal, id, { environment: "sandbox", exchangeEnabled: true, paymentsEnabled: false, allowGuestCheckout: true })],
      ["website-settings", () => tenant.saveWebsiteSettings(principal, id, own.tenant.websiteSettings)],
      ["exchange/pricing/payment config", () => exchange.exchangeConfiguration(principal, id, own.config)],
      ["domain verification", () => verifyTenantDomain(principal, id, async () => [])],
      ["product config", () => productConfiguration(principal, id, "crypto_exchange", own.config)],
      ["staff permissions", () => resource.setStaffPermissions(principal, id, foreign.resources.staff, [])],
      ["order status", () => exchange.tenantOrder(principal, id, foreign.exchangeOrderId, { status: "processing", note: "Forbidden" })],
      ["activate", () => tenant.activateTenant(principal, id)],
    ];
    for (const [name, write] of writes) await check(`${i} foreign write ${name}`, () => denied(write));
    for (const type of ["staff", "api_keys", "webhooks", "payment_methods"] as const) {
      await check(`${i} foreign resource read ${type}`, () => denied(() => resource.listResources(principal, id, type)));
      await check(`${i} own resource ${type}`, async () => assert.ok((await resource.listResources(principal, ownId, type)).some(r => r.id === own.resources[type])));
      await check(`${i} foreign resource create ${type}`, () => denied(() => resource.createResource(principal, id, type,
        { label: "Forbidden resource", reference: type === "staff" ? `user_unused${suffix}` : type === "webhooks" ? "https://example.invalid/unused" : null })));
      await check(`${i} foreign resource delete ${type}`, () => denied(() => resource.removeResource(principal, id, type, foreign.resources[type])));
      await check(`${i} own URL foreign resource ID ${type}`, () => denied(() => resource.removeResource(principal, ownId, type, foreign.resources[type]), 404));
    }
    await check(`${i} foreign staff ID grant`, () => denied(() => resource.setStaffPermissions(principal, ownId, foreign.resources.staff, ["branding.manage"]), 404));
    await check(`${i} own URL foreign order ID read`, () => denied(() => exchange.tenantOrder(principal, ownId, foreign.exchangeOrderId), 404));
    await check(`${i} own URL foreign order ID update`, () => denied(() => exchange.tenantOrder(principal, ownId, foreign.exchangeOrderId, { status: "processing", note: "Forbidden" }), 404));
    await check(`${i} customer request IDOR`, () => denied(() => customer.orderDetail(principal, foreign.requestId), 404));
    await check(`${i} download IDOR`, () => denied(() => attachmentFor(principal, foreign.attachmentId), 404));
    await check(`${i} owner private download`, async () => assert.match((await (await attachmentFor(principal, own.attachmentId)).file.download())[0].toString(), /Private security audit/));
    await check(`${i} Super submitted file download`, () => attachmentFor(op, own.attachmentId));
    await check(`${i} owner request internal-history filter`, async () => {
      const detail = await customer.orderDetail(principal, own.requestId);
      assert.ok(!JSON.stringify(detail).includes("INTERNAL SECURITY FIXTURE"));
      assert.ok(JSON.stringify(await customer.orderDetail(op, own.requestId, true)).includes("INTERNAL SECURITY FIXTURE"));
    });
    await check(`${i} customer list isolation`, async () => assert.deepEqual((await customer.listRequests(principal)).map(r => r.id), [own.requestId]));
    await check(`${i} Admin Panel isolation`, async () => assert.deepEqual((await customer.myAdminPanels(principal)).map(r => r.tenantId), [ownId]));
    await check(`${i} tenant list isolation`, async () => assert.deepEqual((await tenant.listTenants(principal)).map(r => r.id), [ownId]));
    await check(`${i} activity isolation`, async () => assert.ok((await activity(principal)).every(r => r.tenantId === ownId)));
    const operatorOnly: [string, () => unknown][] = [
      ["operator request list", () => customer.listRequests(principal, true)],
      ["operator request detail", () => customer.orderDetail(principal, own.requestId, true)],
      ["operator notes", () => customer.appendNote(principal, own.requestId, { message: "Forbidden note", visibility: "internal" })],
      ["provision", () => customer.deliverRequest(principal, own.requestId, ownId)],
      ["plans list", () => catalog.listPlans(principal)], ["plan detail", () => catalog.getPlan(principal, f!.planId)],
      ["plan create/update", () => catalog.savePlan(principal, f!.plan, f!.planId)],
      ["plan duplicate", () => catalog.duplicatePlan(principal, f!.planId)],
      ["plan archive", () => catalog.changePlanStatus(principal, f!.planId, "archived", 0)],
      ["addons list", () => catalog.listAddons(principal)],
      ["addon update", () => catalog.saveAddon(principal, { name: "Forbidden", description: "", enabled: true, entitlements: [] }, f!.addonId)],
      ["tenant create", () => tenant.createTenant(principal, { name: "Forbidden", slug: `forbidden-${suffix.slice(0, 8)}`, planId: f!.planId })],
      ["plan assignment", () => subscription.changeTenantPlan(principal, ownId, f!.planId)],
      ["addon assignments", () => subscription.setTenantAddons(principal, ownId, [])],
      ["override assignment", () => subscription.setTenantOverrides(principal, ownId, [])],
      ["suspension", () => subscription.setTenantSuspension(principal, ownId, true, "Forbidden suspension")],
      ["administrator assignment", () => administrators.assignTenantAdministrator(principal, ownId, `user_unused${suffix}`, "Forbidden")],
      ["administrator revoke", () => administrators.setTenantAdministratorStatus(principal, ownId, principal.userId, false)],
    ];
    for (const [name, run] of operatorOnly) await check(`${i} customer denied ${name}`, () => denied(run));
    const badPayment = structuredClone(own.config);
    badPayment.paymentMethods[0].id = foreign.config.paymentMethods[0].id;
    badPayment.routes.forEach((r: any) => { r.paymentMethodIds = r.paymentMethodIds.map((m: string) => m === own.config.paymentMethods[0].id ? foreign.config.paymentMethods[0].id : m); });
    await check(`${i} foreign payment UUID upsert`, () => denied(() => exchange.exchangeConfiguration(principal, ownId, badPayment), 400));
    const badRoute = structuredClone(own.config);
    badRoute.routes[0].id = foreign.config.routes[0].id;
    await check(`${i} foreign pricing/route UUID upsert`, () => denied(() => exchange.exchangeConfiguration(principal, ownId, badRoute), 400));
    await check(`${i} public UUID alone does not authorize`, () => denied(() => exchange.trackOrder(own.tenant.slug, own.exchangeOrderId, ""), 404));
    await check(`${i} fake public tracking token`, () => denied(() => exchange.trackOrder(own.tenant.slug, own.exchangeOrderId, "not-valid"), 404));
    const quote = await exchange.sandboxQuote(own.tenant.slug, own.quoteInput);
    await check(`${i} public quote tenant replay`, () => denied(() => exchange.sandboxOrder(foreign.tenant.slug, { quoteToken: quote.token, idempotencyKey: randomUUID() }), 404));
  }
  await check("unauthorized changes leave both tenant contents unchanged", async () => assert.deepEqual(await Promise.all(f!.data.map(d => fingerprint(d.tenant.id))), original));
  await check("read-only staff cannot modify brand", () => denied(() => tenant.saveBrand(staff, f!.data[0].tenant.id, {
    brandName: "Forbidden", logoUrl: null, primaryColor: "#000000", accentColor: "#ffffff", themeMode: "system", defaultLanguage: "en", supportedLanguages: ["en"],
  })));
  await check("staff cannot grant own administrator access", () => denied(() => resource.setStaffPermissions(staff, f!.data[0].tenant.id, staff.userId, ["resources.manage"])));
  await check("fresh principal observes revoked membership", async () => {
    await pool.query("UPDATE tenant_memberships SET active=false WHERE tenant_id=$1 AND clerk_user_id=$2", [f!.data[0].tenant.id, staff.userId]);
    const revoked = await resolvePrincipal(staff.userId);
    await denied(() => tenant.getTenant(revoked, f!.data[0].tenant.id));
  });
  console.log(`AUTHORIZATION SERVICE REGRESSION: ${checks} checks passed.`);
} finally {
  if (f) await cleanSecurityFixtures(f);
  await pool.end();
}
