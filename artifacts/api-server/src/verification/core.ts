import assert from "node:assert/strict";
import { pool, withDatabase } from "@workspace/db";
import { contextFor, resolvePrincipal, type Principal } from "../modules/authentication/service";
import { registerProductModule, readRegistry } from "../modules/product-registry/service";
import { productConfiguration } from "../modules/product-registry/configuration";
import { getSubscription, recordMonthlyUsage } from "../modules/entitlements/resolver";
import { setTenantOverrides, setTenantSuspension } from "../modules/entitlements/subscriptions";
import { setStaffPermissions, createResource } from "../modules/entitlements/resources";
import { getDomainVerification, verifyTenantDomain, resolvePublicDomain } from "../modules/domains/service";
import { activateTenant, getTenant, saveDomain, saveWebsiteSettings } from "../modules/tenants/service";
import { assignTenantAdministrator, setTenantAdministratorStatus } from "../modules/tenants/administrators";
import { validateSettings } from "../modules/website/settings";

export async function verifyCore(f: { admin: Principal; clientAdmin: Principal; staffId: string; aId: string; bId: string; suffix: string }) {
  const { admin, clientAdmin, staffId, aId, bId, suffix } = f;
  const key = `registry_${suffix}`, child = `${key}_child`, limit = `max_${key}`;
  const denied = async (run: () => Promise<unknown>, status?: number | string) => assert.rejects(async () => run(), (e: unknown) => status === undefined || (e as { status?: number; code?: string }).status === status || (e as { code?: string }).code === status);
  const manifest = { key, name: "Verification product", description: "Isolated test fixture", category: "Verification", lifecycle: "deferred" as const, sandboxAvailable: false, requiresAssetNetworks: false, features: [{ key: child, label: "Child", dependsOn: [key] }], limits: [{ key: limit, label: "Meter", valueType: "integer" as const }] };
  try {
    const catalog = await withDatabase(contextFor(admin), readRegistry);
    for (const k of ["crypto_exchange", "crypto_card", "staking", "earn", "dex", "whatsapp_bot", "ios_app", "android_app", "crypto_engine", "rpc_nodes", "cloud_mining", "kolo", "articles"]) assert.ok(catalog.some((m) => m.key === k));
    assert.equal(catalog.find((m) => m.key === "staking")?.lifecycle, "deferred");
    await denied(() => registerProductModule(clientAdmin, manifest), 403);
    await denied(() => registerProductModule(admin, { ...manifest, lifecycle: "core_ready" }), 400);
    await denied(() => registerProductModule(admin, { ...manifest, features: [{ key: child, label: "Child", dependsOn: [key, child] }] }), 400);
    await denied(() => registerProductModule(admin, { ...manifest, features: [{ key: child, label: "Child", dependsOn: [key, "max_staff"] }] }), 400);
    await registerProductModule(admin, manifest);
    await denied(() => registerProductModule(admin, manifest), 409);
    await setTenantSuspension(admin, aId, false, "Verification core phase");
    await setTenantOverrides(admin, aId, [
      { key: "website", value: true, reason: "Verification" },
      { key, value: true, reason: "Verification" }, { key: child, value: true, reason: "Verification" },
      { key: limit, value: "2", reason: "Verification" },
    ]);
    let sub = await getSubscription(clientAdmin, aId);
    assert.equal(sub.features[child], true); assert.ok(sub.enabledModules.includes(key));
    await productConfiguration(clientAdmin, aId, key, { displayName: "Saved fixture" });
    assert.deepEqual((await productConfiguration(clientAdmin, aId, key)).configuration, { displayName: "Saved fixture" });
    await denied(() => productConfiguration(clientAdmin, bId, key), 403);
    await denied(() => productConfiguration(clientAdmin, aId, key, { nested: { privateKey: "not-a-real-secret" } }), 400);
    await denied(() => productConfiguration(clientAdmin, bId, key, { displayName: "Denied cross-tenant write" }), 403);
    await withDatabase(contextFor(admin, aId, true), (c) => recordMonthlyUsage(c, aId, key, limit, "2"));
    await denied(() => withDatabase(contextFor(admin, aId, true), (c) => recordMonthlyUsage(c, aId, key, limit, "1")), 409);
    await denied(() => withDatabase(contextFor(admin, aId, true), (c) => recordMonthlyUsage(c, aId, key, limit, "0.5")), 400);
    await setTenantOverrides(admin, aId, [{ key, value: false, reason: "Deny parent" }, { key: child, value: true, reason: "Try child" }, { key: "website", value: true, reason: "Keep website" }]);
    sub = await getSubscription(clientAdmin, aId);
    assert.equal(sub.features[child], false);
    await denied(() => productConfiguration(clientAdmin, aId, key), 403);
    await setStaffPermissions(clientAdmin, aId, staffId, ["branding.manage"]);
    const staff = await resolvePrincipal(staffId);
    const t = await getTenant(clientAdmin, aId);
    await saveWebsiteSettings(staff, aId, { ...t.websiteSettings, heroTitle: "Permitted staff brand edit", navigation: [{ key: "about", label: "Our brand", visible: true }] });
    await denied(() => saveDomain(staff, aId, "denied.example"), 403);
    await denied(() => setStaffPermissions(staff, aId, staffId, ["resources.manage"]), 403);
    assert.deepEqual((await resolvePrincipal(staffId)).memberships.find(m => m.tenantId === aId)?.permissions, ["branding.manage"]);
    await setStaffPermissions(clientAdmin, aId, staffId, ["resources.manage"]);
    await denied(async () => createResource(await resolvePrincipal(staffId), aId, "staff", { label: "Denied escalation", reference: `user_extra${suffix}` }), 403);
    await setStaffPermissions(clientAdmin, aId, staffId, ["configuration.manage"]);
    await denied(async () => activateTenant(await resolvePrincipal(staffId), aId), 403);
    await setStaffPermissions(clientAdmin, aId, staffId, []);
    await denied(async () => saveWebsiteSettings(await resolvePrincipal(staffId), aId, t.websiteSettings), 403);
    assert.throws(() => validateSettings({ ...t.websiteSettings, navigation: [{ key: "about", label: "A", visible: true }, { key: "about", label: "B", visible: false }] }));
    await saveDomain(clientAdmin, aId, `core-${suffix}.example`);
    const challenge = await getDomainVerification(clientAdmin, aId);
    await denied(() => resolvePublicDomain(challenge.domain!), 404);
    await denied(() => verifyTenantDomain(clientAdmin, aId, async () => [["wrong"]] ), 400);
    await verifyTenantDomain(clientAdmin, aId, async () => [[challenge.txtValue!]]);
    await denied(() => resolvePublicDomain(challenge.domain!), 404);
    await setTenantSuspension(admin, aId, true, "Verify public isolation");
    await denied(() => resolvePublicDomain(challenge.domain!), 404);
    await setTenantSuspension(admin, aId, false, "Restore fixture");
    await saveDomain(clientAdmin, aId, `changed-${suffix}.example`);
    assert.equal((await getDomainVerification(clientAdmin, aId)).status, "unverified");
    await denied(() => resolvePublicDomain(challenge.domain!), 404);
    const adminFixture = `user_coreClient${suffix}`;
    await denied(() => assignTenantAdministrator(clientAdmin, aId, adminFixture, "Denied"), 403);
    await assignTenantAdministrator(admin, aId, adminFixture, "Fixture Client Admin");
    assert.equal((await resolvePrincipal(adminFixture)).memberships[0].role, "client_admin");
    await setTenantAdministratorStatus(admin, aId, adminFixture, false);
    assert.equal((await resolvePrincipal(adminFixture)).role, "unassigned");
    const policies = await pool.query("SELECT count(*)::int AS count FROM pg_class WHERE oid=ANY(ARRAY['module_catalog'::regclass,'tenant_product_configuration'::regclass]) AND relrowsecurity AND relforcerowsecurity");
    assert.equal(policies.rows[0].count, 0);
    process.stdout.write("PASS: generic registry/extension/dependencies; inert configuration persistence; application-scoped configuration; staff grants/revocation/escalation denial; Client Admin assignment; DNS challenge/reset/public suspension; generic monthly quota rollback. DNS lookup mocked only for isolated ownership tests; no external domain connected.\n");
  } finally {
    await pool.query("DELETE FROM tenant_product_configuration WHERE tenant_id=$1 AND module_key=$2", [aId, key]);
    await pool.query("DELETE FROM tenant_entitlement_overrides WHERE key=ANY($1::text[])", [[key, child, limit]]);
    await pool.query("DELETE FROM tenant_usage_counters WHERE key=$1", [limit]);
    await pool.query("DELETE FROM entitlement_definitions WHERE key=ANY($1::text[])", [[key, child, limit]]);
    await pool.query("DELETE FROM landing_products WHERE key=$1", [key]);
    await pool.query("DELETE FROM module_catalog WHERE key=$1", [key]);
  }
}