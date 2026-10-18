import type { Request } from "express";
import { contextFor, resolvePrincipal, type Principal } from "../authentication/service";
import { getTenant } from "../tenants/service";
import { signProof, readProof } from "../../lib/scoped-proof";
import { readSession, businessId } from "../supabase-auth/session";
import { applicationMfaSatisfied } from "../supabase-auth/development-email-mfa";
import { HttpError } from "../../lib/errors";
import type { WebsitePreview } from "./operator-preview";

const PURPOSE = "tenant-release-draft-preview";
export async function tenantDraftPreview(p: Principal, tenantId: string) {
  contextFor(p, tenantId);
  if (p.demo || p.role !== "super_admin" && p.memberships.find(m => m.tenantId === tenantId)?.role !== "client_admin")
    throw new HttpError(403, "Draft preview requires this tenant's administrator.");
  const tenant = await getTenant(p, tenantId);
  const grant: WebsitePreview = { tenantId, slug: tenant.slug, actorId: p.userId, expiresAt: Date.now() + 5 * 60_000 };
  return { url: `/private-label-website/${tenant.slug}?release_preview=${encodeURIComponent(signProof(PURPOSE, grant))}`, expiresAt: new Date(grant.expiresAt).toISOString() };
}
export function verifyDraftPreview(token: string, slug: string, actorId: string): WebsitePreview | null {
  const proof = readProof(PURPOSE, token) as unknown as WebsitePreview | null;
  return proof && proof.actorId === actorId && proof.slug === slug && proof.expiresAt > Date.now() &&
    proof.expiresAt <= Date.now() + 5 * 60_000 && /^[a-f0-9-]{36}$/.test(proof.tenantId) ? proof : null;
}
export async function releasePreviewFor(req: Request, slug: string): Promise<WebsitePreview> {
  const s = await readSession(req);
  if (!s || s.payload.recovery) throw new HttpError(401, "Sign in as this tenant's administrator to preview its draft.");
  const actorId = await businessId(s.user.id);
  const grant = verifyDraftPreview(req.get("X-QX-Release-Preview") ?? "", slug, actorId);
  if (!grant) throw new HttpError(403, "Draft preview has expired or belongs to another administrator.");
  const p = await resolvePrincipal(actorId);
  contextFor(p, grant.tenantId);
  if (p.demo || p.role !== "super_admin" && p.memberships.find(m => m.tenantId === grant.tenantId)?.role !== "client_admin")
    throw new HttpError(403, "Draft preview permission was revoked.");
  if ((s.user.factors?.some(f => f.status === "verified") || p.role === "super_admin") && !await applicationMfaSatisfied(s))
    throw new HttpError(403, "Complete existing MFA before previewing this draft.");
  return grant;
}
