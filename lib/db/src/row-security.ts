import { sql } from "drizzle-orm";
import { pgPolicy, pgTable as baseTable, type PgColumnBuilderBase } from "drizzle-orm/pg-core";

const setting = (key: string) => `coalesce(current_setting('app.${key}',true),'')`;
const actor = setting("actor_id"), tenant = setting("tenant_id");
const root = `${setting("is_super_admin")}='true'`;
const writable = `${setting("can_write")}='true'`;
const slug = setting("public_slug"), domain = setting("public_domain");
const scope = `tenant_id::text=${tenant} AND ${tenant}<>''`;
const publicTenant = `${tenant}='' AND tenant_id IN (SELECT id FROM public.tenants WHERE
 (${slug}<>'' AND slug=${slug}) OR
 (${domain}<>'' AND id IN (SELECT tenant_id FROM public.tenant_domains WHERE domain=${domain} AND status='verified')))`;
const globals = new Set(["addon_entitlements", "addons", "asset_catalog", "asset_network_catalog",
  "global_exchange_catalog", "global_exchange_catalog_links",
  "entitlement_definitions", "landing_products", "module_catalog", "network_catalog",
  "plan_entitlements", "plans", "provider_catalog"]);

/** Predicates share one source of truth between Drizzle and Development-only setup. */
export function rowPolicies(name: string, tenantOwned: boolean) {
  let read: string, write: string;
  if (name === "pricing_rules") {
    read = "true";
    // Public pricing reads do not grant write access or bypass trusted context.
    write = `${root} OR (${scope})`;
  } else if (name === "tenants") {
    read = `${root} OR (id::text=${tenant} AND ${tenant}<>'') OR
      (${tenant}='' AND id IN (SELECT tenant_id FROM public.tenant_memberships WHERE clerk_user_id=${actor} AND active)) OR
      (${slug}<>'' AND slug=${slug} AND status='active') OR
      (${domain}<>'' AND status='active' AND id IN (SELECT tenant_id FROM public.tenant_domains WHERE domain=${domain} AND status='verified'))`;
    write = `${root} OR (id::text=${tenant} AND ${tenant}<>'')`;
  } else if (name === "platform_admins") {
    read = `${root} OR clerk_user_id=${actor}`;
    write = root;
  } else if (name === "tenant_memberships") {
    read = `${root} OR (${scope}) OR (${tenant}='' AND clerk_user_id=${actor})`;
    write = `${root} OR ((${scope}) AND ${setting("can_manage_staff")}='true')`;
  } else if (name === "tenant_releases" || name === "tenant_release_assets") {
    // No public-slug predicate: the server exposes only an explicitly curated
    // snapshot/asset. An anon browser cannot inspect drafts, history or object keys.
    read = `${root} OR (${scope})`;
    write = `${root} OR (${scope})`;
  } else if (name === "tenant_domains") {
    // No tenants subquery here: tenants' domain lookup must remain acyclic.
    read = `${root} OR (${scope}) OR (${domain}<>'' AND domain=${domain} AND status='verified')`;
    write = `${root} OR (${scope})`;
  } else if (name === "white_label_requests") {
    read = `${root} OR customer_user_id=${actor} OR (${scope}) OR (${publicTenant})`;
    write = `${root} OR customer_user_id=${actor}`;
  } else if (name === "white_label_attachments") {
    read = `${root} OR owner_user_id=${actor}`;
    write = read;
  } else if (name === "white_label_events") {
    const ownRequest = `request_id IN (SELECT id FROM public.white_label_requests WHERE customer_user_id=${actor})`;
    read = `${root} OR (visibility='customer' AND ${ownRequest})`;
    write = `${root} OR (${ownRequest} AND author_user_id=${actor} AND visibility='customer')`;
  } else if (name === "customer_notification_reads") {
    read = `${root} OR customer_user_id=${actor}`;
    write = read;
  } else if (tenantOwned) {
    read = `${root} OR (${scope}) OR (${publicTenant})`;
    write = `${root} OR (${scope})`;
    if (name === "tenant_telegram_receipts")
      write = `(${write}) AND EXISTS (SELECT 1 FROM public.tenant_integrations i WHERE i.id=integration_id AND i.tenant_id=tenant_telegram_receipts.tenant_id)`;
  } else if (globals.has(name)) {
    read = "true"; write = root;
  } else throw new Error(`Missing row-security classification for ${name}`);
  return { read: `(${read})`, write: `((${write}) AND ${writable})` };
}

// Preserve pgTable's overloads/inferred column types while adding policies to every
// declaration. The narrowly typed bridge also accepts Drizzle's old object config.
export const pgTable: typeof baseTable = ((name: string, columns: Record<string, unknown>, extra?: (t: unknown) => unknown) => {
  const p = rowPolicies(name, "tenantId" in columns);
  return baseTable(name, columns as Record<string, PgColumnBuilderBase>, t => {
    const configured = extra?.(t);
    const entries = Array.isArray(configured) ? configured : configured ? Object.values(configured) : [];
    return [...entries, pgPolicy("qx_read", { for: "select", using: sql.raw(p.read) }),
      pgPolicy("qx_write", { for: "all", using: sql.raw(p.write), withCheck: sql.raw(p.write) })];
  }).enableRLS();
}) as typeof baseTable;
