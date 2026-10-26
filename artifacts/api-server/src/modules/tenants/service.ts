import { freezeContract } from "../plan-management/contracts";
import { customerHostname } from "../domains/hostname";
import { withDatabase, type DatabaseClient } from "@workspace/db";
import { HttpError } from "../../lib/errors";
import { contextFor, requireSuperAdmin, type Principal } from "../authentication/service";
import {
  CreateTenantBody, UpdateTenantBrandBody, UpdateTenantConfigurationBody,
} from "@workspace/api-zod";
import type { z } from "zod";
import { audit } from "../../lib/audit";
import { readPlan } from "../entitlements/catalog";
import { assertCatalogOperationAllowed } from "../../lib/catalog-scope";
import { assertOperational, enforceLimit, requireFeature, resolveEntitlements } from "../entitlements/resolver";
import { safeHttps, validateSettings, websiteSettings, type WebsiteSettings } from "../website/settings";
import { readRegistry } from "../product-registry/service";
import { newDomainChallenge } from "../domains/service";
import { exchangeProjection, writeExchangeCompatibility } from "../../products/exchange/compatibility";
import { exchangeActivationBlockers } from "../../products/exchange/readiness";
export { audit } from "../../lib/audit";

const steps = ["brand", "domain", "modules", "assets_networks", "configuration"] as const;
type Step = typeof steps[number];

export async function readTenant(client: DatabaseClient, tenantId: string) {
  const result = await client.query(
    `SELECT t.*, b.brand_name, b.logo_url, b.primary_color, b.accent_color, b.theme_mode,
            b.default_language, b.supported_languages, b.website_settings, d.domain,
            c.exchange_enabled, c.payments_enabled, c.allow_guest_checkout
     FROM tenants t JOIN tenant_branding b ON b.tenant_id = t.id
     JOIN tenant_configuration c ON c.tenant_id = t.id
     LEFT JOIN tenant_domains d ON d.tenant_id = t.id WHERE t.id = $1`, [tenantId],
  );
  const row = result.rows[0];
  if (!row) throw new HttpError(404, "Tenant not found.");
  const effective = await resolveEntitlements(client, tenantId);
  const assets = await client.query("SELECT asset_network_id FROM tenant_asset_networks WHERE tenant_id = $1 ORDER BY asset_network_id", [tenantId]);
  const completed = row.completed_steps as string[];
  const enabledModules = effective.enabledModules;
  const assetNetworkIds = assets.rows.map((a) => a.asset_network_id as string);
  const financial = (await readRegistry(client)).some((m) => enabledModules.includes(m.key) && m.requiresAssetNetworks);
  const activationBlockers = await exchangeActivationBlockers(client, tenantId, effective, row.exchange_enabled);
  const complete = steps.every((s) => completed.includes(s)) && enabledModules.length > 0 && (!financial || assetNetworkIds.length > 0) && activationBlockers.length === 0;
  return {
    id: row.id as string, name: row.name as string, slug: row.slug as string,
    brandName: row.brand_name as string, domain: row.domain ?? null,
    status: row.status as string, environment: "sandbox" as const,
    enabledModules, provisioningStep: steps.find((s) => !completed.includes(s)) ?? (activationBlockers.length ? "configuration" : "ready"),
    createdAt: row.created_at as Date, logoUrl: row.logo_url ?? null,
    primaryColor: row.primary_color as string, accentColor: row.accent_color as string,
    themeMode: row.theme_mode as string, defaultLanguage: row.default_language as string,
    supportedLanguages: row.supported_languages as string[],
     assetNetworkIds, ...exchangeProjection(row, effective),
     paymentsEnabled: Boolean(row.payments_enabled && effective.features.crypto_payments),
     allowGuestCheckout: Boolean(row.allow_guest_checkout && effective.features.crypto_payments), configurationComplete: complete, activationBlockers,
     exchangeProvisioned: completed.includes("exchange_provisioned"),
     websiteSettings: websiteSettings(row.brand_name, row.website_settings),
  };
}

export async function getTenant(principal: Principal, tenantId: string) {
  return withDatabase(contextFor(principal, tenantId), (client) => readTenant(client, tenantId));
}

export async function listTenants(principal: Principal) {
  if (principal.role === "super_admin") return withDatabase(contextFor(principal), async (client) => {
    const rows = await client.query("SELECT id FROM tenants ORDER BY created_at DESC");
    // This transaction owns one pg client. Keep its queries sequential instead
    // of concurrently reusing that client across multiple tenant readbacks.
    const tenants = [];
    for (const row of rows.rows) tenants.push(await readTenant(client, row.id));
    return tenants;
  });
  if (!principal.memberships.length) throw new HttpError(403, "Administrator access has not been assigned.");
  const tenants = await Promise.all(principal.memberships.map((m) => getTenant(principal, m.tenantId)));
  return tenants.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function prepareTenant(client: DatabaseClient, principal: Principal, input: z.infer<typeof CreateTenantBody>, addonIds: string[] = []) {
  assertCatalogOperationAllowed("tenant preparation");
  requireSuperAdmin(principal);
  if (input.name.trim().length < 2) throw new HttpError(400, "Client name must contain at least two non-whitespace characters.");
  const plan = await readPlan(client, input.planId);
  if (plan.status !== "enabled") throw new HttpError(400, "Choose an enabled plan for the new tenant.");
  const result = await client.query("INSERT INTO tenants (name,slug) VALUES ($1,$2) RETURNING id", [input.name.trim(), input.slug]);
  const id = result.rows[0].id as string;
  await client.query("INSERT INTO tenant_branding (tenant_id,brand_name) VALUES ($1,$2)", [id, input.name.trim()]);
  await client.query("INSERT INTO tenant_configuration (tenant_id) VALUES ($1)", [id]);
  await client.query("INSERT INTO tenant_subscriptions (tenant_id,plan_id) VALUES ($1,$2)", [id, plan.id]);
  await freezeContract(client, id, plan, "tenant-creation");
  for (const addonId of new Set(addonIds)) await client.query("INSERT INTO tenant_addons (tenant_id,addon_id) VALUES ($1,$2)", [id, addonId]);
  await client.query("UPDATE tenants SET completed_steps=ARRAY['modules']::text[] WHERE id=$1", [id]);
  await audit(client, principal, id, "tenant.created", `Created sandbox client ${input.name.trim()}`, { planId: plan.id });
  return readTenant(client, id);
}

export async function createTenant(principal: Principal, input: z.infer<typeof CreateTenantBody>) {
  assertCatalogOperationAllowed("tenant creation");
  requireSuperAdmin(principal);
  return withDatabase(contextFor(principal, undefined, true), client => prepareTenant(client, principal, input));
}

async function saveStep(principal: Principal, tenantId: string, step: Step, work: (client: DatabaseClient) => Promise<void>) {
  return withDatabase(contextFor(principal, tenantId, true, step === "brand" ? "branding.manage" : step === "domain" ? "domains.manage" : "configuration.manage"), async (client) => {
    await client.query("SELECT id FROM tenants WHERE id = $1 FOR UPDATE", [tenantId]);
    const before = await readTenant(client, tenantId);
    assertOperational(await resolveEntitlements(client, tenantId));
    await work(client);
    await client.query(
      "UPDATE tenants SET completed_steps = ARRAY(SELECT DISTINCT unnest(completed_steps || $2::text[])), updated_at = now() WHERE id = $1",
      [tenantId, [step]],
    );
    const after = await readTenant(client, tenantId);
    await audit(client, principal, tenantId, `tenant.${step}.saved`, `Saved ${step.replaceAll("_", " ")} configuration`, { before, after });
    return after;
  });
}

export function saveBrand(principal: Principal, tenantId: string, input: z.infer<typeof UpdateTenantBrandBody>) {
  if (input.brandName.trim().length < 2) throw new HttpError(400, "Brand name must contain at least two non-whitespace characters.");
  if (!input.supportedLanguages.includes(input.defaultLanguage)) throw new HttpError(400, "Default language must be included in supported languages.");
  safeHttps(input.logoUrl);
  return saveStep(principal, tenantId, "brand", async (client) => {
    // Plan-contract gates (absent for legacy contracts): theme modes and site languages.
    const effective = await resolveEntitlements(client, tenantId);
    const modes = input.themeMode === "system" ? ["light", "dark"] : [input.themeMode];
    if (effective.status === "active") for (const m of modes) if (effective.features[`theme_${m}`] === false) throw new HttpError(403, `Theme mode '${input.themeMode}' is not included in this tenant's plan.`);
    if (effective.status === "active" && "max_languages" in effective.limits) enforceLimit(effective, "max_languages", String(new Set(input.supportedLanguages).size));
    await client.query(
      `UPDATE tenant_branding SET brand_name=$2,logo_url=$3,primary_color=$4,accent_color=$5,
       theme_mode=$6,default_language=$7,supported_languages=$8 WHERE tenant_id=$1`,
      [tenantId, input.brandName.trim(), input.logoUrl, input.primaryColor, input.accentColor, input.themeMode, input.defaultLanguage, [...new Set(input.supportedLanguages)]],
    );
  });
}

export function saveDomain(principal: Principal, tenantId: string, raw: string | null) {
  let domain: string | null = null;
  if (raw) {
    domain = customerHostname(raw);
  }
  return saveStep(principal, tenantId, "domain", async (client) => {
    if (domain) await client.query("INSERT INTO tenant_domains (tenant_id,domain,verification_token) VALUES ($1,$2,$3) ON CONFLICT (tenant_id) DO UPDATE SET domain=EXCLUDED.domain,status=CASE WHEN tenant_domains.domain=EXCLUDED.domain THEN tenant_domains.status ELSE 'unverified' END,verified_at=CASE WHEN tenant_domains.domain=EXCLUDED.domain THEN tenant_domains.verified_at ELSE NULL END,verification_token=CASE WHEN tenant_domains.domain=EXCLUDED.domain THEN tenant_domains.verification_token ELSE EXCLUDED.verification_token END", [tenantId, domain, newDomainChallenge()]);
    else await client.query("DELETE FROM tenant_domains WHERE tenant_id=$1", [tenantId]);
  });
}

export async function saveModules(principal: Principal, _tenantId: string, _keys: string[]) {
  requireSuperAdmin(principal);
  throw new HttpError(409, "Module rights are resolved from the plan, add-ons and tenant overrides. Use subscription controls; legacy direct module writes are disabled.");
}

export function saveAssets(principal: Principal, tenantId: string, ids: string[]) {
  return saveStep(principal, tenantId, "assets_networks", async (client) => {
    const effective = await resolveEntitlements(client, tenantId);
    if (ids.length && !(await readRegistry(client)).some((m) => effective.features[m.key] && m.requiresAssetNetworks)) throw new HttpError(403, "No asset-configurable module is enabled for this tenant.");
    const catalog = await client.query<{ id: string; asset_id: string; network_id: string }>(
      "SELECT id,asset_id,network_id FROM asset_network_catalog WHERE id = ANY($1::text[]) OR asset_id || ':' || network_id = ANY($1::text[])", [ids]);
    // Older clients send assetId:networkId; resolve it only against existing catalog pairs.
    // Persist canonical IDs, preferring an exact ID if it also resembles another pair's alias.
    const selected = [...new Set(ids)].map(id => catalog.rows.find(r => r.id === id) ??
      catalog.rows.find(r => `${r.asset_id}:${r.network_id}` === id));
    if (selected.some(r => !r)) throw new HttpError(400, "Only configured sandbox asset/network pairs are supported.");
    const pairs = selected.filter((r): r is NonNullable<typeof r> => !!r);
    const previous = (await client.query("SELECT asset_network_id FROM tenant_asset_networks WHERE tenant_id=$1",[tenantId])).rows.map(r=>r.asset_network_id);
    const supported = (await client.query(`SELECT l.metadata->>'legacyAssetNetworkId' AS id
      FROM global_exchange_catalog_links l JOIN global_exchange_catalog a ON a.kind='assets' AND a.id=l.source_id
      JOIN global_exchange_catalog n ON n.kind='networks' AND n.id=l.target_id
      WHERE l.kind='asset_network' AND l.enabled AND l.verified AND a.status='enabled' AND n.status='enabled'`)).rows.map(r=>r.id);
    if (pairs.some(p=>!previous.includes(p.id) && !supported.includes(p.id)))
      throw new HttpError(400,"New asset/network selections must have an enabled verified global mapping.");
    enforceLimit(effective, "max_supported_assets", String(new Set(pairs.map((r) => r.asset_id)).size));
    enforceLimit(effective, "max_supported_networks", String(new Set(pairs.map((r) => r.network_id)).size));
    await client.query("DELETE FROM tenant_asset_networks WHERE tenant_id=$1", [tenantId]);
    for (const id of new Set(pairs.map(r => r.id))) await client.query("INSERT INTO tenant_asset_networks (tenant_id,asset_network_id) VALUES ($1,$2)", [tenantId, id]);
  });
}

export function saveConfiguration(principal: Principal, tenantId: string, input: z.infer<typeof UpdateTenantConfigurationBody>) {
  return saveStep(principal, tenantId, "configuration", async (client) => {
    const effective = await resolveEntitlements(client, tenantId);
    await writeExchangeCompatibility(client, tenantId, input.exchangeEnabled, effective);
    if (input.paymentsEnabled || input.allowGuestCheckout) requireFeature(effective, "crypto_payments");
    await client.query("UPDATE tenant_configuration SET environment='sandbox',payments_enabled=$2,allow_guest_checkout=$3 WHERE tenant_id=$1", [tenantId, input.paymentsEnabled, input.allowGuestCheckout]);
  });
}

export function activateTenant(principal: Principal, tenantId: string) {
  requireSuperAdmin(principal);
  return withDatabase(contextFor(principal, tenantId, true), async (client) => {
    // Lock in request -> tenant order, matching review/manual delivery.
    await client.query("SELECT id FROM white_label_requests WHERE tenant_id=$1 FOR UPDATE", [tenantId]);
    await client.query("SELECT id FROM tenants WHERE id = $1 FOR UPDATE", [tenantId]);
    const effective = await resolveEntitlements(client, tenantId);
    assertOperational(effective);
    if (effective.overLimit) throw new HttpError(409, "Resolve over-limit resource usage before sandbox activation.");
    const tenant = await readTenant(client, tenantId);
    if (!tenant.configurationComplete) throw new HttpError(400, tenant.activationBlockers.join(" ") || "Complete provisioning, select at least one module, and select sandbox assets for financial modules.");
    const exchange = await client.query("SELECT configuration FROM tenant_product_configuration WHERE tenant_id=$1 AND module_key='crypto_exchange'", [tenantId]);
    const exchangeReady = exchange.rows[0]?.configuration.enabled === true;
    await client.query(`UPDATE tenants SET status='active',updated_at=now(),
      completed_steps=CASE WHEN $2 AND NOT 'exchange_provisioned'=ANY(completed_steps)
        THEN array_append(completed_steps,'exchange_provisioned') ELSE completed_steps END WHERE id=$1`, [tenantId, exchangeReady]);
    await audit(client, principal, tenantId, "tenant.sandbox_activated", "Activated configuration in sandbox only; no domain or financial execution launched");
    // Sandbox activation is independent of delivery. Access stays withheld until
    // the Super Admin explicitly delivers the reviewed Ready request.
    return readTenant(client, tenantId);
  });
}

export function saveWebsiteSettings(principal: Principal, tenantId: string, input: WebsiteSettings) {
  validateSettings(input);
  return saveStep(principal, tenantId, "brand", async (client) => {
    requireFeature(await resolveEntitlements(client, tenantId), "website");
    // Optional newer branding fields survive saves from the unchanged admin form.
    // Explicit empty arrays still clear configuration; omitted keys stay intact.
    await client.query("UPDATE tenant_branding SET website_settings=COALESCE(website_settings,'{}'::jsonb) || $2::jsonb WHERE tenant_id=$1", [tenantId, JSON.stringify(input)]);
  });
}