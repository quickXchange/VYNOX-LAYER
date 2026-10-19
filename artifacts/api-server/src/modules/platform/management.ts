import { withDatabase } from "@workspace/db";
import type { PlatformCustomer, PlatformProject } from "@workspace/api-zod";
import { contextFor, requireSuperAdmin, type Principal } from "../authentication/service";
import { PROVIDER_CATALOG } from "../../products/exchange/providers";
import { supabaseDirectory } from "../supabase-auth/directory";

type IdentityLink = { user_id: string; tenant_id: string | null; name: string | null; created_at: Date };
const iso = (value: Date | string) => new Date(value).toISOString();

/** Owner-only read model. No lifecycle, entitlement or customer record writes. */
export async function platformManagement(principal: Principal) {
  requireSuperAdmin(principal);
  const snapshot = await withDatabase(contextFor(principal), async (client) => {
    const admins = await client.query<{ clerk_user_id: string }>("SELECT clerk_user_id FROM platform_admins");
    const staff = await client.query<{ clerk_user_id: string }>("SELECT DISTINCT clerk_user_id FROM tenant_memberships WHERE role='staff'");
    const links = await client.query<IdentityLink>(`
      SELECT customer_user_id AS user_id,tenant_id,configuration->>'companyName' AS name,created_at
      FROM white_label_requests
      UNION ALL
      SELECT clerk_user_id AS user_id,tenant_id,NULL AS name,created_at
      FROM tenant_memberships WHERE role='client_admin'`);
    const projects = await client.query(`
      SELECT t.id AS tenant_id,t.updated_at,b.logo_url,s.plan_id,p.name AS plan_name,
        ARRAY(SELECT a.addon_id::text FROM tenant_addons a WHERE a.tenant_id=t.id ORDER BY a.addon_id) AS addon_ids
      FROM tenants t LEFT JOIN tenant_branding b ON b.tenant_id=t.id
      LEFT JOIN tenant_subscriptions s ON s.tenant_id=t.id
      LEFT JOIN public.plans p ON p.id=s.plan_id ORDER BY t.created_at DESC`);
    const audit = await client.query(`
      SELECT id,tenant_id,actor_id,event_type,description,metadata,created_at
      FROM audit_events ORDER BY created_at DESC,id DESC LIMIT 500`);
    return { admins: admins.rows, staff: staff.rows, links: links.rows, projects: projects.rows, audit: audit.rows };
  });
  const operators = new Set(snapshot.admins.map(a => a.clerk_user_id));
  const staff = new Set(snapshot.staff.map(a => a.clerk_user_id));
  const linked = new Map<string, PlatformCustomer>();
  for (const row of snapshot.links) {
    if (operators.has(row.user_id)) continue;
    const customer = linked.get(row.user_id) ?? {
      id: row.user_id, name: row.name || "Customer account", email: null,
      status: "unavailable", createdAt: null, tenantIds: [],
    };
    if (row.tenant_id && !customer.tenantIds.includes(row.tenant_id)) customer.tenantIds.push(row.tenant_id);
    if (row.name) customer.name = row.name;
    linked.set(row.user_id, customer);
  }
  let directoryAvailable = true;
  let directoryError: string | null = null;
  const registeredCustomers = new Set<string>();
  try {
    // Include registered customers who have not ordered yet. Exclude platform
    // operators and staff-only identities; customer/staff dual roles remain.
    const pageSize = 100;
    const ownUsers = await supabaseDirectory();
    for (let offset = 0; ; offset += pageSize) {
      const page = { data: ownUsers.slice(offset, offset + pageSize), totalCount: ownUsers.length };
      for (const user of page.data) {
        const id = user.id;
        if (!id || operators.has(id) || (staff.has(id) && !linked.has(id))) continue;
        registeredCustomers.add(id);
        const email = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)?.emailAddress ?? null;
        const old = linked.get(id);
        linked.set(id, {
          id, name: [user.firstName, user.lastName].filter(Boolean).join(" ") || old?.name || email || "Customer account",
          email, status: user.banned ? "banned" : user.locked ? "locked" : "active",
          createdAt: new Date(user.createdAt).toISOString(), tenantIds: old?.tenantIds ?? [],
        });
      }
      if (offset + page.data.length >= page.totalCount || page.data.length === 0) break;
    }
  } catch {
    // Not a silent substitute for a complete account directory. The UI must
    // distinguish linked records from a verified total of registered accounts.
    directoryAvailable = false;
    directoryError = "The identity directory could not be loaded. Linked customer records remain visible; a complete customer total and missing account details are unavailable.";
  }
  const customers = [...linked.values()].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const projects: PlatformProject[] = snapshot.projects.map(p => ({
    tenantId: p.tenant_id, customerIds: customers.filter(c => c.tenantIds.includes(p.tenant_id)).map(c => c.id),
    planId: p.plan_id ?? null, planName: p.plan_name ?? null, addonIds: p.addon_ids,
    logoUrl: p.logo_url ?? null, updatedAt: iso(p.updated_at),
  }));
  return {
    customers, customerTotal: directoryAvailable ? registeredCustomers.size : null, projects, directoryAvailable, directoryError,
    audit: snapshot.audit.map(e => ({
      id: e.id, tenantId: e.tenant_id ?? null, actorId: e.actor_id, eventType: e.event_type,
      description: e.description, createdAt: iso(e.created_at),
      resource: typeof e.metadata?.resource === "string" ? e.metadata.resource
        : typeof e.metadata?.resourceId === "string" ? e.metadata.resourceId
        : typeof e.metadata?.requestId === "string" ? e.metadata.requestId : null,
      result: typeof e.metadata?.result === "string" ? e.metadata.result : null,
    })),
    providers: PROVIDER_CATALOG.map(p => ({
      id: p.id, name: p.name, category: p.category, capabilities: p.capabilities,
      status: p.status, implemented: p.functional, logoUrl: null,
    })),
  };
}
