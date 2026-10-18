import { withDatabase, type DatabaseContext } from "@workspace/db";
import { HttpError } from "../../lib/errors";

export interface Membership {
  tenantId: string;
  role: "client_admin" | "staff";
  permissions?: string[];
}
export interface Principal {
  authenticationProvider?: "supabase";
  demo?: boolean;
  verifiedEmailSha256?: string;
  userId: string;
  role: "super_admin" | "client_admin" | "staff" | "unassigned";
  memberships: Membership[];
}

export async function resolvePrincipal(userId: string): Promise<Principal> {
  return withDatabase({ actorId: userId }, async (client) => {
    const admins = await client.query("SELECT clerk_user_id FROM platform_admins WHERE clerk_user_id = $1 AND active = true", [userId]);
    const memberships = await client.query<{ tenant_id: string; role: "client_admin" | "staff"; permissions: string[] }>(
      `SELECT m.tenant_id, m.role, m.permissions FROM tenant_memberships m
       WHERE m.clerk_user_id=$1 AND m.active=true
         AND NOT EXISTS (SELECT 1 FROM white_label_requests w WHERE w.tenant_id=m.tenant_id AND w.status<>'delivered')
         AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id=m.tenant_id AND t.status='suspended')
       ORDER BY m.created_at`, [userId],
    );
    const mapped = memberships.rows.map((m) => ({ tenantId: m.tenant_id, role: m.role, permissions: m.permissions }));
    return {
      userId,
      role: admins.rowCount ? "super_admin" : mapped.some((m) => m.role === "client_admin") ? "client_admin" : mapped.length ? "staff" : "unassigned",
      memberships: mapped,
    };
  });
}

export function contextFor(principal: Principal, tenantId?: string, write = false, permission = "configuration.manage"): DatabaseContext {
  if (principal.demo && (write || tenantId !== principal.memberships[0]?.tenantId || principal.role !== "staff")) {
    throw new HttpError(403, "The demo is restricted to read-only NovaX access.");
  }
  const isSuperAdmin = principal.role === "super_admin";
  if (principal.role === "unassigned") throw new HttpError(403, "An operator must explicitly assign administrator access.");
  const membership = principal.memberships.find((m) => m.tenantId === tenantId);
  if (!isSuperAdmin && (!tenantId || !membership)) throw new HttpError(403, "Tenant access denied.");
  if (write && !isSuperAdmin && membership?.role !== "client_admin" && !membership?.permissions?.includes(permission)) throw new HttpError(403, "This role lacks the required permission.");
  return { actorId: principal.userId, tenantId, isSuperAdmin, canWrite: write, canManageStaff: isSuperAdmin || membership?.role === "client_admin" };
}

export function requireSuperAdmin(principal: Principal) {
  if (principal.demo || principal.role !== "super_admin") throw new HttpError(403, "Super administrator access required.");
}