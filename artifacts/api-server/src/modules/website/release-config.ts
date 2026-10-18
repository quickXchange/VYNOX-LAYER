import { createHash } from "node:crypto";
import { withDatabase, type DatabaseClient } from "@workspace/db";
import { GetPublicSiteResponse, GetPublicExchangeResponse, SiteSnapshot, migrateSiteSnapshot, type SiteSnapshotConfig } from "@workspace/api-zod";
import { HttpError } from "../../lib/errors";
import { readTenant } from "../tenants/service";
import { resolveEntitlements } from "../entitlements/resolver";
import { publicExchangeConfiguration } from "../../products/exchange/public-configuration";
import { readExchange } from "../../products/exchange/settings";
import { definitions } from "../integrations/definitions";
import { publicTenantId } from "./service";
import { logger } from "../../lib/logger";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(v => canonical(v ?? null)).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).filter(k => (value as Record<string, unknown>)[k] !== undefined).sort().map(k =>
    `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const configChecksum = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
export function changedFields(before: unknown, after: unknown, prefix = ""): string[] {
  if (canonical(before ?? null) === canonical(after ?? null)) return [];
  if (!before || !after || typeof before !== "object" || typeof after !== "object" || Array.isArray(before) || Array.isArray(after)) return [prefix || "configuration"];
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap(key =>
    changedFields((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key));
}
export async function draftConfig(c: DatabaseClient, tenantId: string): Promise<SiteSnapshotConfig> {
  const t = await readTenant(c, tenantId), e = await resolveEntitlements(c, tenantId);
  const exchange = e.features.crypto_exchange ? GetPublicExchangeResponse.parse(await publicExchangeConfiguration(c, tenantId, e)) : null;
  const addons = await c.query(`SELECT a.id::text AS key,a.name FROM tenant_addons ta JOIN addons a ON a.id=ta.addon_id WHERE ta.tenant_id=$1 ORDER BY a.id`, [tenantId]);
  const integrations = await c.query("SELECT provider_key,encrypted_credentials,credential_management FROM tenant_integrations WHERE tenant_id=$1 AND enabled=true ORDER BY provider_key", [tenantId]);
  const features = { ...e.features };
  if (exchange) for (const action of ["swap", "convert"]) features[action] = exchange.actions.includes(action as "swap" | "convert");
  const assets = exchange?.assets ?? (await c.query(`SELECT c.asset_id AS "assetId",a.symbol,a.name,c.network_id AS "networkId",n.name AS "networkName",n.testnet
    FROM tenant_asset_networks t JOIN asset_network_catalog c ON c.id=t.asset_network_id JOIN asset_catalog a ON a.id=c.asset_id
    JOIN network_catalog n ON n.id=c.network_id WHERE t.tenant_id=$1 ORDER BY a.symbol,n.name`, [tenantId])).rows;
  return SiteSnapshot.parse({ schema_version: 1,
    site: GetPublicSiteResponse.parse({ tenantSlug: t.slug, brandName: t.brandName, logoUrl: t.logoUrl,
      primaryColor: t.primaryColor, accentColor: t.accentColor, themeMode: t.themeMode, domain: t.domain,
      defaultLanguage: t.defaultLanguage, supportedLanguages: t.supportedLanguages,
      sandboxOnly: true, websiteSettings: t.websiteSettings, features, assets }),
    exchange, addons: addons.rows,
    displayLimits: Object.fromEntries(Object.entries(e.limits).filter(([key]) => ["max_supported_assets", "max_supported_networks"].includes(key))),
    // Centrally-managed infrastructure and its credentials are never tenant website config.
    providers: integrations.rows.filter(r => r.credential_management === "customer").map(r => ({ provider: r.provider_key, configured: !!r.encrypted_credentials })),
  });
}
export interface ChecklistItem { key: string; label: string; ready: boolean; message: string }
export function contrast(a: string, b: string) {
  const luminance = (color: string) => {
    if (!/^#[a-f0-9]{6}$/i.test(color)) return NaN;
    const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
export async function releaseChecklist(c: DatabaseClient, tenantId: string, config: SiteSnapshotConfig): Promise<ChecklistItem[]> {
  const items: ChecklistItem[] = [];
  const add = (key: string, label: string, ready: boolean, message: string) => items.push({ key, label, ready, message });
  add("brand.name", "Brand name", !!config.site.brandName.trim(), "A brand name is required.");
  add("brand.logo", "Brand logo", !!config.site.logoUrl, "Upload or select a brand logo.");
  const pair = [config.site.primaryColor, config.site.accentColor];
  // The master uses white foreground on primary buttons; accent also appears as
  // text on a light surface. Validate actual independent foreground/background pairs.
  add("brand.contrast", "Accessible colors", pair.every(color => contrast(color, "#ffffff") >= 4.5),
    "Primary/white and accent/white color pairs must each meet 4.5:1 contrast.");
  const { configuration } = await readExchange(c, tenantId);
  const publicRoutes = new Set(config.exchange?.routes.map(r => r.id) ?? []);
  const enabledMethods = new Set(configuration.paymentMethods.filter(m => m.enabled).map(m => m.id));
  const invalidRoutes = configuration.routes.filter(r => r.enabled &&
    (!publicRoutes.has(r.id) || r.paymentMethodIds.some(id => !enabledMethods.has(id))));
  add("routes", "Enabled routes", !invalidRoutes.length, invalidRoutes.length ?
    `${invalidRoutes.length} enabled route(s) use a disabled action, asset, network or payment method.` : "All enabled routes reference enabled resources.");
  const connections = await c.query("SELECT provider_key,encrypted_credentials,health FROM tenant_integrations WHERE tenant_id=$1 AND enabled=true", [tenantId]);
  for (const row of connections.rows) {
    const d = definitions.find(d => d.key === row.provider_key);
    const verified = ["connected", "ready"].includes(row.health?.state);
    add(`provider.${row.provider_key}`, `${d?.name ?? row.provider_key} connection`,
      !!d && (!d.secretFields.length || !!row.encrypted_credentials) && verified,
      "Save required credentials and run a successful read-only Test for the current revision. Credential edits invalidate prior verification.");
  }
  // No payment gateway adapter exists in this product. Never fabricate a test or
  // let presentation publication activate payments.
  if (config.site.features.crypto_payments)
    add("gateway", "Payment gateway", false, "No approved payment gateway adapter is connected. Disable this capability before releasing; financial activation is not authorized.");
  for (const key of ["telegram_bot", "telegram_mini_app"]) if (config.site.features[key] && !connections.rows.some(r => r.provider_key === key))
    add(`addon.${key}`, `${key.replaceAll("_", " ")} add-on`, false, "This enabled add-on requires an independently configured and successfully tested tenant connection.");
  return items;
}
export async function releasedConfig(slug: string) {
  const tenantId = await publicTenantId(slug);
  return withDatabase({ actorId: "released-site", tenantId }, async c => {
    const entitlement = await resolveEntitlements(c, tenantId);
    if (entitlement.status !== "active" || !entitlement.features.website) throw new HttpError(404, "Site not found.");
    const state = await c.query(`SELECT r.config,r.checksum,r.id FROM tenants t JOIN tenant_releases r ON r.id=t.live_release_id AND r.tenant_id=t.id WHERE t.id=$1`, [tenantId]);
    if (!state.rowCount) {
      logger.warn({ tenantId, code: "SITE_NOT_RELEASED" }, "Public site has no reviewed release");
      throw new HttpError(404, "Site not found: no reviewed configuration has been released.");
    }
    const row = state.rows[0];
    try {
      if (configChecksum(row.config) !== row.checksum) throw new Error("Checksum mismatch");
      const config = migrateSiteSnapshot(row.config);
      if (config.site.tenantSlug !== slug) throw new Error("Tenant mismatch");
      return { config, checksum: row.checksum as string, tenantId, id: row.id as string };
    } catch {
      logger.error({ tenantId, releaseId: row.id, code: "SITE_RELEASE_INVALID" }, "Released site configuration is invalid");
      throw new HttpError(503, "The released site configuration is invalid. Contact the operator.");
    }
  });
}
