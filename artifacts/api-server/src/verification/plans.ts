import assert from "node:assert/strict";
import { pool, withDatabase } from "@workspace/db";
import { GetTenantSubscriptionResponse, GetPublicSiteResponse } from "@workspace/api-zod";
import { contextFor, type Principal } from "../modules/authentication/service";
import { saveAssets, saveBrand, saveDomain, saveConfiguration, saveWebsiteSettings, activateTenant } from "../modules/tenants/service";
import { savePlan, saveAddon, duplicatePlan, changePlanStatus, getPlan, type PlanInput, type Entry } from "../modules/entitlements/catalog";
import { changeTenantPlan, setTenantAddons, setTenantOverrides, setTenantSuspension } from "../modules/entitlements/subscriptions";
import { consumeMonthlyUsage, getSubscription, requireFeature, resolveEntitlements } from "../modules/entitlements/resolver";
import { createResource, removeResource, listResources, type ResourceType } from "../modules/entitlements/resources";
import { getPublicSite } from "../modules/website/service";
import { websiteSettings } from "../modules/website/settings";

export function planFixture(name: string, features: Record<string, boolean>): PlanInput {
  const quotas: Record<string, string> = {
    max_supported_assets: "1", max_supported_networks: "1", max_payment_methods: "1",
    max_staff: "1", max_api_keys: "1", max_webhooks: "1", max_monthly_transactions: "2", max_monthly_volume: "0.30",
  };
  return { name, description: "Temporary verification fixture", monthlyPrice: "0", yearlyPrice: "0", setupFee: "0", currency: "USD", billingLabel: "Metadata only", displayOrder: 0, status: "enabled",
    entitlements: [...Object.entries(features).map(([key, value]) => ({ key, value })), ...Object.entries(quotas).map(([key, value]) => ({ key, value }))] };
}
async function denied(work: () => Promise<unknown>, status: number | string) {
  await assert.rejects(async () => work(), (e: unknown) => (e as { status?: number }).status === status || (e as { code?: string }).code === status);
}
type Tenant = { id: string; slug: string };
type Plan = Awaited<ReturnType<typeof savePlan>>;
export async function verifyPlans(f: { admin: Principal; clientAdmin: Principal; a: Tenant; b: Tenant; pa: Plan; pb: Plan; suffix: string; planIds: string[]; addonIds: string[] }) {
  const { admin, clientAdmin, a, b, pa, pb, suffix } = f;
  const bAdmin: Principal = { userId: `user_verifyB${suffix}`, role: "client_admin", memberships: [{ tenantId: b.id, role: "client_admin" }] };
  await pool.query("INSERT INTO tenant_memberships (tenant_id,clerk_user_id,role) VALUES ($1,$2,'client_admin')", [b.id, bAdmin.userId]);
  const effectiveA = GetTenantSubscriptionResponse.parse(await getSubscription(clientAdmin, a.id));
  assert.equal(effectiveA.features.crypto_payments, true);
  assert.equal(effectiveA.features.crypto_exchange, false); // omitted = DENY
  assert.equal(effectiveA.features.api_keys, false);
  await denied(() => changeTenantPlan(clientAdmin, a.id, pb.id), 403);
  await denied(() => setTenantOverrides(clientAdmin, a.id, [{ key: "website", value: true, reason: "denied" }]), 403);
  await denied(() => setTenantAddons(clientAdmin, a.id, []), 403);
  await denied(() => setTenantSuspension(clientAdmin, a.id, true, "denied"), 403);
  await denied(() => createResource(clientAdmin, a.id, "api_keys", { label: "Denied key", reference: null }), 403);
  await denied(() => createResource(clientAdmin, a.id, "webhooks", { label: "Denied webhook", reference: "https://hooks.example.com/test" }), 403);
  await denied(() => saveAssets(clientAdmin, a.id, ["eth:ethereum-sepolia", "usdt:ethereum-sepolia"]), 409);
  await denied(() => saveAssets(clientAdmin, a.id, ["usdt:ethereum-sepolia", "usdt:bsc-testnet"]), 409);

  // Every resource-count quota is enforced on actual tenant configuration writes.
  await denied(() => createResource(clientAdmin, a.id, "staff", { label: "Extra staff", reference: `user_extra${suffix}` }), 409);
  const resources: [ResourceType, string | null][] = [
    ["staff", `user_staffB${suffix}`], ["api_keys", null],
    ["webhooks", "https://hooks.example.com/verification"], ["payment_methods", null],
  ];
  for (const [type, reference] of resources) {
    const r = await createResource(bAdmin, b.id, type, { label: `Verification ${type}`, reference });
    assert.ok(r.item?.id);
    if (type === "api_keys") {
      assert.ok(r.issuedKey?.startsWith("pl_sandbox_"));
      const stored = await pool.query("SELECT key_hash FROM api_keys WHERE id=$1", [r.item.id]);
      assert.notEqual(stored.rows[0].key_hash, r.issuedKey);
      assert.equal(JSON.stringify(await listResources(bAdmin, b.id, type)).includes(r.issuedKey!), false);
    }
    await denied(() => createResource(bAdmin, b.id, type, { label: "Quota overflow", reference: type === "staff" ? `user_overflow${suffix}` : reference }), 409);
  }
  await saveAssets(bAdmin, b.id, ["btc:bitcoin-testnet"]);
  const addon = await saveAddon(admin, { name: "Verification quota add-on", description: "Temporary fixture", enabled: true, entitlements: [{ key: "max_api_keys", value: "2" }, { key: "swap", value: true }] });
  f.addonIds.push(addon.id);
  await setTenantAddons(admin, b.id, [addon.id]);
  assert.equal((await getSubscription(bAdmin, b.id)).limits.max_api_keys, "3");
  assert.equal((await getSubscription(bAdmin, b.id)).features.swap, true);
  assert.equal((await getSubscription(clientAdmin, a.id)).features.swap, false);
  await setTenantOverrides(admin, b.id, [{ key: "max_api_keys", value: "1", reason: "Tenant-only replacement, not increment" }]);
  assert.equal((await getSubscription(bAdmin, b.id)).limits.max_api_keys, "1");
  assert.equal((await getSubscription(clientAdmin, a.id)).limits.max_api_keys, "1");
  await denied(() => createResource(bAdmin, b.id, "api_keys", { label: "Still denied", reference: null }), 409);
  await setTenantOverrides(admin, b.id, [{ key: "max_webhooks", value: "2", reason: "Race test" }]);
  const race = await Promise.allSettled([
    createResource(bAdmin, b.id, "webhooks", { label: "Concurrent A", reference: "https://hooks.example.com/a" }),
    createResource(bAdmin, b.id, "webhooks", { label: "Concurrent B", reference: "https://hooks.example.com/b" }),
  ]);
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await getSubscription(bAdmin, b.id)).usage.find((u) => u.key === "max_webhooks")?.used, "2");
  await setTenantOverrides(admin, b.id, [{ key: "max_webhooks", value: "1", reason: "Downgrade without deleting data" }]);
  assert.equal((await getSubscription(bAdmin, b.id)).overLimit, true);
  const hook = (await listResources(admin, b.id, "webhooks"))[0];
  await removeResource(admin, b.id, "webhooks", hook.id);
  assert.equal((await getSubscription(bAdmin, b.id)).overLimit, false);

  // Decimal boundaries and current-month admission are exact and atomic.
  await pool.query("INSERT INTO tenant_usage_counters (tenant_id,key,period,used) VALUES ($1,'max_monthly_transactions','2000-01',9999)", [b.id]);
  for (let i = 0; i < 2; i++) await withDatabase(contextFor(bAdmin, b.id, true), (db) => consumeMonthlyUsage(db, b.id, "crypto_payments", "0.10"));
  await denied(() => withDatabase(contextFor(bAdmin, b.id, true), (db) => consumeMonthlyUsage(db, b.id, "crypto_payments", "0.01")), 409);
  await setTenantOverrides(admin, b.id, [{ key: "max_monthly_transactions", value: "10", reason: "Isolate volume limit" }]);
  await withDatabase(contextFor(bAdmin, b.id, true), (db) => consumeMonthlyUsage(db, b.id, "crypto_payments", "0.10"));
  await denied(() => withDatabase(contextFor(bAdmin, b.id, true), (db) => consumeMonthlyUsage(db, b.id, "crypto_payments", "0.000000000000000001")), 409);
  const usageB = await getSubscription(bAdmin, b.id);
  assert.equal(Number(usageB.usage.find((u) => u.key === "max_monthly_transactions")?.used), 3);
  assert.equal(Number(usageB.usage.find((u) => u.key === "max_monthly_volume")?.used), 0.3);
  assert.equal(Number((await getSubscription(clientAdmin, a.id)).usage.find((u) => u.key === "max_monthly_volume")?.used), 0);

  // New keys are registered and resolved WITHOUT a schema migration.
  const futureKey = `future_feature_${suffix}`;
  await withDatabase(contextFor(admin, undefined, true), (db) => db.query("INSERT INTO entitlement_definitions (key,label,kind,value_type) VALUES ($1,'Future verification feature','feature','boolean')", [futureKey]));
  const updated = await savePlan(admin, { ...pb, monthlyPrice: "12.50", yearlyPrice: "120.00", setupFee: "5.00", entitlements: [...pb.entitlements, { key: futureKey, value: true }], expectedRevision: pb.revision }, pb.id);
  assert.equal(updated.monthlyPrice, "12.50");
  assert.equal((await getSubscription(bAdmin, b.id)).features[futureKey], true);
  assert.equal((await getSubscription(clientAdmin, a.id)).features[futureKey], false);
  await denied(() => savePlan(admin, { ...pb, entitlements: [{ key: "max_staff", value: true }] }), 400);
  const copy = await duplicatePlan(admin, pb.id);
  f.planIds.push(copy.id);
  assert.equal(copy.status, "disabled");
  assert.deepEqual(copy.entitlements, updated.entitlements);
  await changePlanStatus(admin, copy.id, "archived", (await getPlan(admin, copy.id)).revision);
  await changePlanStatus(admin, pb.id, "disabled", (await getPlan(admin, pb.id)).revision);
  assert.equal((await getSubscription(bAdmin, b.id)).features.merchant_api, true);
  await denied(() => changeTenantPlan(admin, a.id, pb.id), 400);
  await changePlanStatus(admin, pb.id, "enabled", (await getPlan(admin, pb.id)).revision);
  await changeTenantPlan(admin, a.id, pb.id);
  await changeTenantPlan(admin, a.id, pa.id);
  await setTenantOverrides(admin, a.id, [{ key: "crypto_payments", value: false, reason: "Tenant-only revocation" }]);
  assert.equal((await getSubscription(clientAdmin, a.id)).features.crypto_payments, false);
  assert.equal((await getSubscription(bAdmin, b.id)).features.crypto_payments, true);
  await setTenantOverrides(admin, a.id, []);

  await saveBrand(bAdmin, b.id, { brandName: "Distinct Verification B", logoUrl: null, primaryColor: "#653AAB", accentColor: "#F0AB45", themeMode: "light", defaultLanguage: "en", supportedLanguages: ["en"] });
  await saveDomain(bAdmin, b.id, null);
  await saveWebsiteSettings(bAdmin, b.id, { ...websiteSettings("Distinct Verification B", {}), secondaryColor: "#271A43", fontKey: "manrope", heroTitle: "A separate sandbox identity", supportDetails: "Tenant B support", termsContent: "Tenant B sandbox terms", privacyContent: "Tenant B sandbox privacy" });
  await saveConfiguration(bAdmin, b.id, { environment: "sandbox", exchangeEnabled: true, paymentsEnabled: true, allowGuestCheckout: true });
  await denied(() => activateTenant(bAdmin, b.id), 403);
  await activateTenant(admin, b.id);
  const siteA = GetPublicSiteResponse.parse(await getPublicSite(a.slug));
  const siteB = GetPublicSiteResponse.parse(await getPublicSite(b.slug));
  assert.notEqual(siteA.brandName, siteB.brandName);
  assert.notEqual(siteA.primaryColor, siteB.primaryColor);
  assert.notEqual(siteA.websiteSettings.fontKey, siteB.websiteSettings.fontKey);
  assert.equal(siteA.features.merchant_api, false);
  assert.equal(siteB.features.merchant_api, true);
  assert.equal("plan" in siteB || "tenantId" in siteB || "overrides" in siteB || "usage" in siteB, false);
  await denied(() => getPublicSite(a.slug, "merchant_api"), 403);
  await denied(() => getPublicSite("does-not-exist"), 404);
  await setTenantSuspension(admin, a.id, true, "Verify full suspension");
  await denied(() => getPublicSite(a.slug), 404);
  await denied(() => activateTenant(clientAdmin, a.id), 403);
  await denied(() => activateTenant(admin, a.id), 403);
  await denied(() => saveDomain(admin, a.id, null), 403);
  await denied(() => saveAssets(admin, a.id, []), 403);
  await denied(() => saveConfiguration(admin, a.id, { environment: "sandbox", exchangeEnabled: false, paymentsEnabled: false, allowGuestCheckout: false }), 403);
  await denied(() => createResource(admin, a.id, "staff", { label: "Suspension bypass denied", reference: `user_newStaff${suffix}` }), 403);
  await denied(() => removeResource(admin, a.id, "staff", `user_verifyStaff${suffix}`), 403);
  await denied(() => withDatabase(contextFor(clientAdmin, a.id), async (db) => requireFeature(await resolveEntitlements(db, a.id), "website")), 403);
  await setTenantSuspension(admin, a.id, false, "Resume prior active state");
  assert.equal((await getSubscription(clientAdmin, a.id)).tenantStatus, "active");
  await denied(() => setTenantOverrides(admin, a.id, [{ key: "max_staff", value: "1.5", reason: "Invalid integer" }]), 400);
  await denied(() => getSubscription(clientAdmin, b.id), 403);
  await denied(() => changeTenantPlan(clientAdmin, a.id, pb.id), 403);
  await denied(() => savePlan(clientAdmin, { ...pb, name: "Unauthorized" }, pb.id), 403);
  await denied(() => setTenantOverrides(clientAdmin, a.id, [{ key: "website", value: true, reason: "Denied" }]), 403);
  await denied(() => listResources(clientAdmin, b.id, "staff"), 403);
  const events = await pool.query("SELECT DISTINCT event_type FROM audit_events WHERE actor_id=$1", [admin.userId]);
  for (const event of ["plan.created", "plan.updated", "plan.duplicated", "plan.disabled", "plan.archived", "subscription.plan_changed", "subscription.addons_changed", "subscription.overrides_changed", "tenant.suspended", "tenant.unsuspended"]) assert.ok(events.rows.some((r) => r.event_type === event), event);
  const secured = await pool.query("SELECT count(*)::int AS total FROM pg_class WHERE (relrowsecurity OR relforcerowsecurity) AND relnamespace='public'::regnamespace");
  assert.equal(secured.rows[0].total, 0, "Database RLS must remain disabled.");
  const runtimeRole = await pool.query("SELECT 1 FROM pg_roles WHERE rolname='private_label_runtime'");
  assert.equal(runtimeRole.rowCount, 0, "Retired custom role must not be recreated.");
  process.stdout.write("PASS: two distinct plans/tenants; fail-closed features; all eight quota boundaries; concurrent admission; exact decimals/current-month usage; catalog lifecycle/duplication; add-ons/override precedence; suspension; application tenant isolation; audited changes; no RLS/custom-role dependency.\n");
}