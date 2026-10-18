/** Isolated Development fixtures. No Auth identities, customer copies or public pricing edits. */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { CreateTenantBody, SaveExchangeConfigurationBody } from "@workspace/api-zod";
import type { Principal } from "../modules/authentication/service";
import { createTenant, saveAssets, saveBrand, saveDomain, saveWebsiteSettings, activateTenant } from "../modules/tenants/service";
import { exchangeConfiguration } from "../products/exchange/service";
import { masterExchangeDefaults, masterWebsiteDefaults } from "../products/exchange/master-template";
import { uploadDraftAsset } from "../modules/website/release-assets";
import { releaseTenant } from "../modules/website/releases";
import { privateFile } from "../modules/customer/order-files";

export const admin: Principal = { userId: "qa-site-release-service", role: "super_admin", memberships: [] };
export const scopePath = process.env.NODE_ENV === "test" ? ".local/qa/site-release-ci-fixtures.json" : ".local/qa/site-release-fixtures.json";
export type Scope = { planId: string; addonId: string; tenants: { id: string; slug: string; name: string }[]; initialReleases: string[] };
export function developmentOnly() {
  if (process.env.NODE_ENV === "test" && process.env.QXLAYER_MIGRATION_TEST === "true" &&
      ["127.0.0.1", "localhost"].includes(new URL(process.env.DATABASE_URL!).hostname)) return;
  if (process.env.NODE_ENV !== "development" || process.env.QXLAYER_DATABASE_PROVIDER === "supabase")
    throw new Error("Refusing fixture writes outside the managed Development database.");
}
export async function savedScope(): Promise<Scope> { developmentOnly(); return JSON.parse(await readFile(scopePath, "utf8")); }
export async function setupFixtures(): Promise<Scope> {
  developmentOnly();
  const suffix = randomUUID().slice(0, 8);
  const scope: Scope = { planId: randomUUID(), addonId: randomUUID(), tenants: [], initialReleases: [] };
  await mkdir(".local/qa", { recursive: true });
  const save = () => writeFile(scopePath, JSON.stringify(scope, null, 2));
  await save(); // Persist exact cleanup IDs before any writes.
  await pool.query("INSERT INTO plans(id,name,status) VALUES($1,$2,'enabled')", [scope.planId, `Private release QA ${suffix}`]);
  await pool.query(`INSERT INTO plan_entitlements(plan_id,key,value)
    SELECT $1,key,CASE WHEN kind='feature' THEN to_jsonb(key=ANY($2::text[])) ELSE to_jsonb('1000000'::text) END FROM entitlement_definitions`,
    [scope.planId, ["website", "crypto_exchange", "swap", "convert"]]);
  await pool.query("INSERT INTO addons(id,name,enabled) VALUES($1,'Release Sync Add-on',true)", [scope.addonId]);
  for (const label of ["A", "B"]) {
    const tenant = await createTenant(admin, CreateTenantBody.parse({ name: `Release ${label} ${suffix}`, slug: `release-${label.toLowerCase()}-${suffix}`, planId: scope.planId }));
    scope.tenants.push({ id: tenant.id, slug: tenant.slug, name: tenant.name }); await save();
    const ids = (await pool.query(`SELECT l.metadata->>'legacyAssetNetworkId' AS id
      FROM global_exchange_catalog_links l JOIN global_exchange_catalog a ON a.kind='assets' AND a.id=l.source_id
      JOIN global_exchange_catalog n ON n.kind='networks' AND n.id=l.target_id
      WHERE l.kind='asset_network' AND l.enabled AND l.verified AND a.status='enabled' AND n.status='enabled'
      ORDER BY l.metadata->>'legacyAssetNetworkId' LIMIT 4`)).rows.map(r => r.id as string);
    await saveAssets(admin, tenant.id, ids);
    const current = await exchangeConfiguration(admin, tenant.id);
    const config = masterExchangeDefaults(current.catalog, ["convert"], "USD");
    config.enabled = true;
    await exchangeConfiguration(admin, tenant.id, SaveExchangeConfigurationBody.parse(config));
    const logo = await uploadDraftAsset(admin, tenant.id, Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60"><rect width="60" height="60" fill="${label === "A" ? "#153f6b" : "#4b246b"}"/><path d="M15 45 L30 15 L45 45 Z" fill="white"/></svg>`), "image/svg+xml");
    await saveBrand(admin, tenant.id, { brandName: tenant.name, logoUrl: logo.url, primaryColor: label === "A" ? "#153F6B" : "#4B246B", accentColor: "#146747", themeMode: "light", defaultLanguage: "en", supportedLanguages: ["en"] });
    await saveWebsiteSettings(admin, tenant.id, masterWebsiteDefaults(tenant.name));
    await saveDomain(admin, tenant.id, null);
    await activateTenant(admin, tenant.id);
    const release = await releaseTenant(admin, tenant.id);
    scope.initialReleases.push(release.id); await save();
  }
  return scope;
}
export async function changeDraft(scope: Scope) {
  const a = scope.tenants[0];
  const t = await (await import("../modules/tenants/service")).getTenant(admin, a.id);
  const logo = await uploadDraftAsset(admin, a.id, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60"><circle cx="30" cy="30" r="30" fill="#663399"/><path d="M15 30 L27 42 L45 18" stroke="white" stroke-width="6" fill="none"/></svg>'), "image/svg+xml");
  await saveBrand(admin, a.id, { brandName: `${a.name} Updated`, logoUrl: logo.url, primaryColor: "#663399", accentColor: "#146747", themeMode: "light", defaultLanguage: "en", supportedLanguages: ["en"] });
  // These are independently authored fields, not aliases of brandName. Update
  // the fixture's website/hero texts too; production must not overwrite them.
  await saveWebsiteSettings(admin, a.id, masterWebsiteDefaults(`${a.name} Updated`));
  const config = (await exchangeConfiguration(admin, a.id)).configuration;
  if (!config.routes.length) throw new Error("Fixture must exercise an actual route.");
  config.routes[0].rate = config.routes[0].rate === "2" ? "3" : "2";
  await exchangeConfiguration(admin, a.id, config);
  await pool.query("INSERT INTO tenant_addons(tenant_id,addon_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [a.id, scope.addonId]);
  return { previousName: t.brandName };
}
export async function cleanupFixtures(scope: Scope) {
  developmentOnly();
  const ids = scope.tenants.map(t => t.id);
  const files = (await pool.query("SELECT object_key,tenant_id,checksum,extension,published_at FROM tenant_release_assets WHERE tenant_id=ANY($1::uuid[])", [ids])).rows;
  await pool.query("DELETE FROM tenant_addons WHERE tenant_id=ANY($1::uuid[])", [ids]);
  // Release rows are deleted only by the parent tenant cascade, never independently.
  for (const table of ["tenant_telegram_receipts", "tenant_integrations", "exchange_orders", "pricing_rules", "audit_events", "tenant_usage_counters", "tenant_payment_methods", "tenant_product_configuration", "tenant_entitlement_overrides", "tenant_subscriptions", "tenant_memberships", "tenant_asset_networks", "tenant_configuration", "tenant_branding", "tenant_domains"])
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=ANY($1::uuid[])`, [ids]);
  await pool.query("DELETE FROM tenants WHERE id=ANY($1::uuid[])", [ids]);
  await pool.query("DELETE FROM plan_entitlements WHERE plan_id=$1", [scope.planId]);
  await pool.query("DELETE FROM plans WHERE id=$1", [scope.planId]);
  await pool.query("DELETE FROM audit_events WHERE actor_id=$1", [admin.userId]);
  await pool.query("DELETE FROM addons WHERE id=$1", [scope.addonId]);
  for (const f of files) {
    await privateFile(f.object_key).delete({ ignoreNotFound: true });
    if (f.published_at) await privateFile(`public-assets/${f.tenant_id}/${f.checksum}.${f.extension}`).delete({ ignoreNotFound: true });
  }
}
