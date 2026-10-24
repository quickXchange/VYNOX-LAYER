/** Disposable Development-only real-service regression. Never a startup or migration hook. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { pool } from "@workspace/db";
import { resolvePrincipal, type Principal } from "../modules/authentication/service";
import { submitRequest, reviewRequest, orderDetail, myAdminPanels } from "../modules/customer/service";
import { getProvisioning, retryProvisioning } from "../modules/customer/provisioning";
import { savePlan } from "../modules/entitlements/catalog";
import { planFixture } from "./plans";
import { getTenant, saveBrand, saveDomain, saveAssets } from "../modules/tenants/service";
import { exchangeConfiguration } from "../products/exchange/service";
import { masterExchangeDefaults } from "../products/exchange/master-template";
import { getPublicSite } from "../modules/website/service";
import { getDomainVerification, verifyTenantDomain, resolvePublicDomain } from "../modules/domains/service";
import { checkHosting, hostingProof } from "../modules/domains/hosting";
import { cleanupServiceQa } from "./white-label-qa-cleanup";

assert.equal(process.env.NODE_ENV, "test", "This regression requires an explicit Development test run.");
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const actors = [`qa_wl_owner_${suffix}`, `qa_wl_customer_${suffix}`, `qa_wl_other_${suffix}`];
const admin: Principal = { userId: actors[0], role: "super_admin", memberships: [] };
const customer: Principal = { userId: actors[1], role: "unassigned", memberships: [] };
const other: Principal = { userId: actors[2], role: "unassigned", memberships: [] };
const ids: string[] = [];
let planId: string | undefined;
const results: { test: string; result: string }[] = [];
const pass = (test: string) => { results.push({ test, result: "PASS" }); console.log(`PASS: ${test}`); };
const reportDir = "reports/white-label-platform-completion";
mkdirSync(reportDir, { recursive: true });
mkdirSync(".local", { recursive: true });
const saveScope = () => writeFileSync(".local/white-label-platform-service-qa.json", JSON.stringify({ developmentOnly: true, actors, orderIds: ids, planId }, null, 2));
const denied = (work: () => Promise<unknown>, status: number) =>
  assert.rejects(async () => work(), (e: unknown) => (e as { status: number }).status === status);
try {
  await pool.query("INSERT INTO platform_admins(clerk_user_id) VALUES($1)", [admin.userId]);
  const input = planFixture(`Disposable WL regression ${suffix}`, { website: true, crypto_exchange: true, swap: true, convert: true });
  input.entitlements = input.entitlements.map(e => e.key === "max_supported_assets" || e.key === "max_supported_networks"
    ? { ...e, value: "50" } : e.key === "max_monthly_volume" ? { ...e, value: "100000" } : e);
  const plan = await savePlan(admin, input);
  planId = plan.id; saveScope();
  const order = await submitRequest(customer, {
    idempotencyKey: randomUUID(), projectName: `QA isolated ${suffix}`, brandName: `QA Alpha ${suffix}`,
    preferredDomain: "alpha.example.test", actions: ["swap"], details: "Disposable Development regression; explicit manual fixture rates only.",
    requestedPlanId: plan.id,
  });
  ids.push(order.id); saveScope();
  await denied(() => getProvisioning(customer, order.id), 403);
  await denied(() => retryProvisioning(other, order.id), 403);
  await denied(() => orderDetail(other, order.id), 404);
  await denied(() => retryProvisioning(admin, order.id), 409);
  assert.equal((await getProvisioning(admin, order.id)).completedCount, 0);
  assert.equal(order.websiteUrl, null);
  pass("unapproved orders expose no links; customer/operator/order isolation");
  await denied(() => reviewRequest(admin, order.id, { status: "approved", monthlyPrice: null, setupPrice: null,
    currency: "USD", operatorNote: "", approvedPlanId: plan.id }), 409);
  const failed = await getProvisioning(admin, order.id);
  assert.match(failed.lastError!, /pricing/i);
  assert.equal(failed.tenantId, null);
  pass("failed approval rolls back preparation and persists safe operator-only diagnostics");
  const prepared = await reviewRequest(admin, order.id, { status: "approved", monthlyPrice: "1", setupPrice: "1",
    currency: "USD", operatorNote: "Explicit QA fixture pricing; no billing.", approvedPlanId: plan.id });
  const tenantId = prepared.tenantId!;
  assert(tenantId);
  const tenant = await getTenant(admin, tenantId);
  assert.equal(tenant.brandName, `QA Alpha ${suffix}`);
  assert.match(tenant.websiteSettings.heroTitle, /exchange/i);
  assert.equal(tenant.status, "draft");
  assert.equal(prepared.websiteUrl, null);
  assert.equal((await myAdminPanels(customer)).length, 0);
  await denied(() => getTenant(customer, tenantId), 403);
  await denied(() => getPublicSite(tenant.slug), 404);
  const progress = await getProvisioning(admin, order.id);
  assert.equal(progress.completedCount, 3);
  assert(progress.blockers.length > 0);
  pass("approval atomically creates isolated NovaX master while draft/public/Admin access stays closed");
  await Promise.all([retryProvisioning(admin, order.id), retryProvisioning(admin, order.id)]);
  assert.equal((await orderDetail(customer, order.id)).order.tenantId, tenantId);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM tenants WHERE slug=$1", [tenant.slug])).rows[0].n, 1);
  assert.equal((await getTenant(admin, tenantId)).status, "draft");
  pass("concurrent incomplete-setup retries are idempotent and cannot invent configuration or activate");
  const selected = await pool.query(`SELECT DISTINCT ON(a.symbol) an.id FROM asset_network_catalog an
    JOIN asset_catalog a ON a.id=an.asset_id JOIN network_catalog n ON n.id=an.network_id
    WHERE n.testnet AND a.symbol IN ('ETH','USDC') ORDER BY a.symbol,n.name`);
  assert.equal(selected.rows.length, 2, "The ETH/USDC test-network catalog is required.");
  await saveAssets(admin, tenantId, selected.rows.map(r => r.id));
  const base = await exchangeConfiguration(admin, tenantId);
  assert(base.catalog.length >= 2, "Two enabled global asset-network catalogue entries are required.");
  const config = masterExchangeDefaults(base.catalog.slice(0, 2), ["swap"], "USD");
  config.enabled = true;
  for (const n of config.networks) { n.minimum = "0.01"; n.maximum = "100"; }
  await saveAssets(admin, tenantId, config.networks.map(n => n.assetNetworkId));
  await exchangeConfiguration(admin, tenantId, config);
  const beforeConfig = JSON.stringify((await exchangeConfiguration(admin, tenantId)).configuration);
  const done = await retryProvisioning(admin, order.id);
  assert.equal(done.completedCount, 6);
  assert.equal((await orderDetail(customer, order.id)).order.status, "delivered");
  assert.match(done.websiteUrl!, new RegExp(`/private-label-website/${tenant.slug}$`));
  const principal = await resolvePrincipal(customer.userId);
  assert.equal(principal.role, "client_admin");
  assert.equal((await myAdminPanels(principal)).length, 1);
  assert.equal((await getPublicSite(tenant.slug)).brandName, `QA Alpha ${suffix}`);
  assert.equal((await retryProvisioning(admin, order.id)).completedCount, 6);
  assert.equal(JSON.stringify((await exchangeConfiguration(admin, tenantId)).configuration), beforeConfig);
  pass("valid retry activates and delivers to the same account; repeat delivery preserves settings");
  await saveBrand(principal, tenantId, { brandName: `QA customer update ${suffix}`, logoUrl: "https://example.com/qa-logo.png",
    primaryColor: "#123456", accentColor: "#abcdef", themeMode: "dark", defaultLanguage: "en", supportedLanguages: ["en"] });
  assert.equal((await getPublicSite(tenant.slug)).primaryColor, "#123456");
  assert.equal((await getPublicSite(tenant.slug)).brandName, `QA customer update ${suffix}`);
  await denied(() => getTenant(other, tenantId), 403);
  await denied(() => saveBrand(other, tenantId, { brandName: "No access", logoUrl: null, primaryColor: "#123456",
    accentColor: "#abcdef", themeMode: "dark", defaultLanguage: "en", supportedLanguages: ["en"] }), 403);
  pass("delivered owner can change logo/colors/branding; unrelated customer cannot read or mutate tenant");
  const domain = `qa-${suffix}.example.com`;
  await saveDomain(principal, tenantId, domain);
  await denied(() => checkHosting(principal, tenantId), 409);
  const challenge = await getDomainVerification(principal, tenantId);
  await denied(() => verifyTenantDomain(principal, tenantId, async () => [["wrong-token"]]), 400);
  await verifyTenantDomain(principal, tenantId, async () => [[challenge.txtValue!.slice(0, 10), challenge.txtValue!.slice(10)]]);
  assert.equal((await getDomainVerification(principal, tenantId)).hostingConnected, false);
  assert.equal((await resolvePublicDomain(domain)).tenantSlug, tenant.slug);
  pass("DNS token checks and split TXT handling; ownership alone never means connected hosting");
  await checkHosting(principal, tenantId, async (_domain, nonce) => hostingProof(domain, "wrong-tenant", nonce));
  assert.equal((await getDomainVerification(principal, tenantId)).hostingConnected, false);
  await checkHosting(principal, tenantId, async (_domain, nonce) => hostingProof(domain, tenant.slug, nonce));
  const connected = await getDomainVerification(principal, tenantId);
  assert.equal(connected.hostingConnected, true);
  assert.equal(connected.httpsReady, true);
  assert.equal((await orderDetail(principal, order.id)).order.websiteUrl, `https://${domain}`);
  await denied(() => checkHosting(other, tenantId), 403);
  await checkHosting(principal, tenantId, async () => { throw new Error("fixture connection timeout"); });
  assert.equal((await getDomainVerification(principal, tenantId)).hostingConnected, false);
  assert.match((await orderDetail(principal, order.id)).order.websiteUrl!, /private-label-website/);
  pass("nonce-bound hosting proof, wrong-tenant denial, persisted errors, retry recovery and default URL fallback (injected probe; not real DNS/TLS)");
  await saveDomain(principal, tenantId, `changed-${suffix}.example.com`);
  assert.equal((await getDomainVerification(principal, tenantId)).hostingConnected, false);
  await denied(() => resolvePublicDomain(domain), 404);
  pass("domain changes revoke old challenges, hosting observations and public mappings");
  const second = await submitRequest(other, { idempotencyKey: randomUUID(), projectName: `QA second ${suffix}`,
    brandName: `QA Beta ${suffix}`, preferredDomain: "beta.example.test", actions: ["swap"], details: "Separate customer; no copied settings.",
    requestedPlanId: plan.id });
  ids.push(second.id); saveScope();
  const secondPrepared = await reviewRequest(admin, second.id, { status: "approved", monthlyPrice: "1", setupPrice: "1",
    currency: "USD", operatorNote: "", approvedPlanId: plan.id });
  assert.notEqual(secondPrepared.tenantId, tenantId);
  const secondTenant = await getTenant(admin, secondPrepared.tenantId!);
  assert.notEqual(secondTenant.slug, tenant.slug);
  assert.equal(secondTenant.brandName, `QA Beta ${suffix}`);
  assert.notEqual(secondTenant.primaryColor, "#123456");
  assert.equal(secondTenant.assetNetworkIds.length, 0);
  await denied(() => getTenant(principal, secondTenant.id), 403);
  pass("second customer receives distinct master website; no branding/assets/data copied across tenants");
} finally {
  try {
    await cleanupServiceQa({ developmentOnly: true, actors, orderIds: ids, planId });
  }
  finally {
    writeFileSync(`${reportDir}/service-tests.json`, JSON.stringify(results, null, 2));
    await pool.end();
  }
}
